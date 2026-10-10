import OpenAI from 'openai';
import { ChatRequestOptions, EmbeddingProvider, EMBEDDING_DIMENSIONS, LlmProvider, LlmStreamEvent } from './llm.types';

export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;

  constructor(private readonly options: { apiKey: string; model: string; maxTokens: number }) {
    this.client = new OpenAI({ apiKey: options.apiKey });
  }

  async *streamChat({ system, messages, signal }: ChatRequestOptions): AsyncIterable<LlmStreamEvent> {
    const stream = await this.client.chat.completions.create(
      {
        model: this.options.model,
        max_completion_tokens: this.options.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: 'system', content: system }, ...messages],
      },
      { signal },
    );

    let usage = { inputTokens: 0, outputTokens: 0 };
    let model = this.options.model;
    let finishReason: string | null = null;

    for await (const chunk of stream) {
      model = chunk.model ?? model;
      const choice = chunk.choices[0];
      if (choice?.delta?.content) {
        yield { type: 'text', text: choice.delta.content };
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      // With include_usage the last chunk has no choices and carries the token counts
      if (chunk.usage) {
        usage = { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens };
      }
    }

    yield {
      type: 'final',
      model,
      usage,
      stopReason: finishReason === 'content_filter' ? 'refusal' : finishReason === 'length' ? 'max_tokens' : 'end',
    };
  }
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = EMBEDDING_DIMENSIONS;
  // text-embedding-3-small: related passages usually score 0.3+, unrelated ones below
  readonly minRelevance = 0.3;
  private readonly client: OpenAI;

  constructor(private readonly options: { apiKey: string; model: string }) {
    this.client = new OpenAI({ apiKey: options.apiKey });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await this.client.embeddings.create({ model: this.options.model, input: texts });
    // The API returns items with an index; sort to keep the input order guaranteed
    return [...response.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}
