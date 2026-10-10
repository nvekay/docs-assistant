import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  ChatLimitErrorBody,
  ChatMessageDto,
  ChatStreamEvent,
  Citation,
  ConversationSummaryDto,
} from '@docs-assistant/shared';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/config';
import { PG_POOL } from '../db/db.module';
import { calculateCostUsd } from '../llm/cost';
import { estimateTokens } from '../llm/fake.provider';
import { ChatTurn, LLM_PROVIDER, LlmProvider, LlmStreamEvent, TokenUsage } from '../llm/llm.types';
import { REDIS } from '../redis/redis.module';
import { UsageService } from '../usage/usage.service';
import { buildRetrievalQuery, buildSystemPrompt, extractCitations } from './prompt';
import { rewriteQuery } from './query-rewrite';
import { SlidingWindowRateLimiter } from './rate-limiter';
import { RetrievalService } from './retrieval.service';

/** Chat list titles are the first question, cut to this length */
const TITLE_CHARS = 80;

export function conversationTitle(question: string): string {
  const oneLine = question.replace(/\s+/g, ' ').trim();
  return oneLine.length > TITLE_CHARS ? `${oneLine.slice(0, TITLE_CHARS - 1).trimEnd()}…` : oneLine;
}

export interface LimitExceeded extends ChatLimitErrorBody {
  retryAfterSeconds?: number;
}

type FinalEvent = Extract<LlmStreamEvent, { type: 'final' }>;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly rateLimiter: SlidingWindowRateLimiter;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS) redis: Redis,
    private readonly retrieval: RetrievalService,
    private readonly usage: UsageService,
  ) {
    this.rateLimiter = new SlidingWindowRateLimiter(redis, config.CHAT_RATE_LIMIT_PER_MINUTE, 60_000);
  }

  /**
   * Checked before streaming starts, so a blocked request gets a plain HTTP 429.
   * Token budgets are checked against what was already spent; one request in flight
   * can go slightly over, which the per-minute rate limit keeps small.
   */
  async checkLimits(userId: string): Promise<LimitExceeded | null> {
    const rate = await this.rateLimiter.hit(userId);
    if (!rate.allowed) {
      const retryAfterSeconds = Math.ceil(rate.retryAfterMs / 1000);
      return {
        code: 'rate_limited',
        message: `Too many questions in a short time. Try again in ${retryAfterSeconds} s.`,
        retryAfterSeconds,
      };
    }

    const spent = await this.usage.tokensToday(userId);
    if (spent.user >= this.config.DAILY_TOKEN_LIMIT_PER_USER) {
      return { code: 'daily_limit', message: 'You have used today’s demo budget. It resets at 00:00 UTC.' };
    }
    if (spent.total >= this.config.DAILY_TOKEN_LIMIT_GLOBAL) {
      return { code: 'daily_limit', message: 'The demo has reached its daily budget. It resets at 00:00 UTC.' };
    }
    return null;
  }

  /** Continues the user's own conversation or starts a new one titled by its first question; someone else's id is a 404 */
  async openConversation(userId: string, conversationId: string | undefined, firstQuestion: string): Promise<string> {
    if (conversationId) {
      await this.assertOwner(userId, conversationId);
      return conversationId;
    }
    const { rows } = await this.pool.query<{ id: string }>(
      'INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id',
      [userId, conversationTitle(firstQuestion)],
    );
    return rows[0].id;
  }

  /**
   * One question -> stream of events: meta, delta*, then citations + done, or error.
   * Usage is recorded even when the answer fails or the browser disconnects,
   * because the provider bills for the tokens either way.
   */
  async *answer(
    userId: string,
    conversationId: string,
    message: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    const history = await this.loadHistory(conversationId);
    await this.pool.query(`INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', $2)`, [
      conversationId,
      message,
    ]);
    // Moves the chat to the top of the list
    await this.pool.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversationId]);

    // Sent before the search, so the browser learns the conversation id right away
    yield { type: 'meta', conversationId };

    const query = await this.searchQuery(history, message, signal);
    const sources = await this.retrieval.search(query.text);
    const system = buildSystemPrompt(sources);
    const messages: ChatTurn[] = [...history, { role: 'user', content: message }];

    let text = '';
    let final: FinalEvent | undefined;
    let failed = false;
    let usage: TokenUsage;
    let costUsd: number;
    try {
      for await (const event of this.llm.streamChat({ system, messages, signal })) {
        if (event.type === 'text') {
          text += event.text;
          yield { type: 'delta', text: event.text };
        } else {
          final = event;
        }
      }
    } catch (error) {
      failed = true;
      if (!signal?.aborted) {
        this.logger.error(JSON.stringify({ event: 'chat_failed', conversationId, error: (error as Error).message }));
      }
    } finally {
      // Without a final event (error or disconnect) the real numbers are unknown, so estimate them
      const answerUsage = final?.usage ?? {
        inputTokens: estimateTokens(system + messages.map((m) => m.content).join('\n')),
        outputTokens: estimateTokens(text),
      };
      // The query rewrite is a separate model call billed with this question
      usage = {
        inputTokens: answerUsage.inputTokens + query.usage.inputTokens,
        outputTokens: answerUsage.outputTokens + query.usage.outputTokens,
      };
      costUsd = calculateCostUsd(usage, {
        input: this.config.PRICE_INPUT_PER_MTOK,
        output: this.config.PRICE_OUTPUT_PER_MTOK,
      });
      await this.usage
        .record({ userId, provider: this.llm.name, model: final?.model ?? 'estimated', usage, costUsd })
        .catch((error: Error) => this.logger.error(`Failed to record usage: ${error.message}`));
    }

    if (failed || !final) {
      yield { type: 'error', code: 'internal', message: 'The assistant could not answer. Please try again.' };
      return;
    }
    if (final.stopReason === 'refusal') {
      yield { type: 'error', code: 'refused', message: 'The assistant declined to answer this question.' };
      return;
    }

    const citations = extractCitations(text, sources);
    await this.pool.query(
      `INSERT INTO messages (conversation_id, role, content, citations) VALUES ($1, 'assistant', $2, $3)`,
      [conversationId, text, JSON.stringify(citations)],
    );
    this.logger.log(
      JSON.stringify({
        event: 'chat_answered',
        conversationId,
        query: query.rewritten ? query.text : undefined,
        sources: sources.length,
        documents: new Set(sources.map((s) => s.documentId)).size,
        citations: citations.length,
        stopReason: final.stopReason,
        ...usage,
        costUsd,
      }),
    );

    yield { type: 'citations', citations };
    yield {
      type: 'done',
      usage: { ...usage, costUsd },
      stopReason: final.stopReason === 'max_tokens' ? 'max_tokens' : 'end',
    };
  }

  /**
   * What to search for: the model's standalone English rewrite of the question (handles
   * follow-ups, other languages and synonyms) plus the original wording. If rewriting is not
   * available (fake model) or fails, the short-follow-up heuristic is the fallback.
   */
  private async searchQuery(
    history: ChatTurn[],
    message: string,
    signal?: AbortSignal,
  ): Promise<{ text: string; rewritten: boolean; usage: TokenUsage }> {
    const previousQuestion = history.findLast((m) => m.role === 'user')?.content;
    const fallback = buildRetrievalQuery(message, previousQuestion);
    try {
      const rewrite = await rewriteQuery(this.llm, history, message, signal);
      return rewrite.query
        ? { text: `${rewrite.query}\n${message}`, rewritten: true, usage: rewrite.usage }
        : { text: fallback, rewritten: false, usage: rewrite.usage };
    } catch (error) {
      if (!signal?.aborted) {
        this.logger.warn(`Query rewrite failed, searching the original question: ${(error as Error).message}`);
      }
      return { text: fallback, rewritten: false, usage: { inputTokens: 0, outputTokens: 0 } };
    }
  }

  async listConversations(userId: string): Promise<ConversationSummaryDto[]> {
    const { rows } = await this.pool.query<{ id: string; title: string | null; updated_at: Date }>(
      `SELECT id, title, updated_at FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50`,
      [userId],
    );
    return rows.map((r) => ({ id: r.id, title: r.title ?? 'Untitled chat', updatedAt: r.updated_at.toISOString() }));
  }

  /** Deletes the user's own conversation with its messages (ON DELETE CASCADE); anything else is a 404 */
  async deleteConversation(userId: string, conversationId: string): Promise<void> {
    const { rowCount } = await this.pool.query('DELETE FROM conversations WHERE id = $1 AND user_id = $2', [
      conversationId,
      userId,
    ]);
    if (!rowCount) throw new NotFoundException('Conversation not found');
  }

  async messages(userId: string, conversationId: string): Promise<ChatMessageDto[]> {
    await this.assertOwner(userId, conversationId);
    const { rows } = await this.pool.query<{
      id: string;
      role: 'user' | 'assistant';
      content: string;
      citations: Citation[];
      created_at: Date;
    }>(`SELECT id, role, content, citations, created_at FROM messages WHERE conversation_id = $1 ORDER BY id`, [
      conversationId,
    ]);
    return rows.map((r) => ({
      id: Number(r.id),
      role: r.role,
      content: r.content,
      citations: r.citations,
      createdAt: r.created_at.toISOString(),
    }));
  }

  private async assertOwner(userId: string, conversationId: string): Promise<void> {
    const { rowCount } = await this.pool.query('SELECT 1 FROM conversations WHERE id = $1 AND user_id = $2', [
      conversationId,
      userId,
    ]);
    if (!rowCount) throw new NotFoundException('Conversation not found');
  }

  /** Last messages in chronological order, starting with a user turn as the chat APIs expect */
  private async loadHistory(conversationId: string): Promise<ChatTurn[]> {
    const { rows } = await this.pool.query<ChatTurn>(
      `SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT $2`,
      [conversationId, this.config.CHAT_HISTORY_MESSAGES],
    );
    const turns = rows.reverse();
    while (turns[0]?.role === 'assistant') turns.shift();
    return turns;
  }
}
