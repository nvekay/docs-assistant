import { ChatTurn, LlmProvider, TokenUsage } from '../llm/llm.types';

const SYSTEM = `You write search queries for a product documentation search engine.

Given a conversation and the user's latest message, reply with one search query that:
- stands on its own: replace "it", "that", "and on mobile?" with what they refer to in the conversation;
- is in English, whatever language the user wrote in (the documentation is in English);
- adds a few synonyms and related terms the documentation might use (for example "cost price plan billing").

Reply with the query only: a single line, no quotes, no explanation.`;

const MAX_QUERY_CHARS = 300;
/** Earlier messages shown to the rewriter, each cut short: it needs the topic, not the details */
const CONTEXT_MESSAGES = 6;
const CONTEXT_CHARS_PER_MESSAGE = 400;

export interface RewrittenQuery {
  /** null when the model gave nothing usable */
  query: string | null;
  usage: TokenUsage;
}

/** The conversation as plain text, so the rewriter sees one user turn instead of a role-alternating history */
export function rewritePrompt(history: ChatTurn[], message: string): string {
  const context = history
    .slice(-CONTEXT_MESSAGES)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, CONTEXT_CHARS_PER_MESSAGE)}`)
    .join('\n');
  return context ? `Conversation so far:\n${context}\n\nLatest message: ${message}` : `Latest message: ${message}`;
}

/**
 * Asks the model for a standalone English search query with synonyms. This is what lets
 * keyword search answer follow-ups, questions in other languages and different wording.
 * When the reply is empty (the fake model) or the call fails, the caller searches with the
 * original question instead: a weaker search is better than no answer.
 */
export async function rewriteQuery(
  llm: LlmProvider,
  history: ChatTurn[],
  message: string,
  signal?: AbortSignal,
): Promise<RewrittenQuery> {
  const result = await llm.complete({
    system: SYSTEM,
    messages: [{ role: 'user', content: rewritePrompt(history, message) }],
    maxTokens: 400,
    signal,
  });
  const query = result.text
    .split('\n')
    .find((line) => line.trim())
    ?.trim()
    .replace(/^"|"$/g, '');
  return { query: query ? query.slice(0, MAX_QUERY_CHARS) : null, usage: result.usage };
}
