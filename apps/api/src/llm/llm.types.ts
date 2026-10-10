/**
 * Provider-neutral contracts. Every chat model (Claude, the fake one used in tests)
 * implements LlmProvider, so the chat service never imports a vendor SDK directly.
 */

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequestOptions {
  system: string;
  messages: ChatTurn[];
  /** Aborts the upstream request when the browser disconnects */
  signal?: AbortSignal;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Streamed pieces of one answer: text deltas, then exactly one final event */
export type LlmStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'final'; usage: TokenUsage; model: string; stopReason: 'end' | 'max_tokens' | 'refusal' };

/** A short, non-streamed reply, e.g. a rewritten search query */
export interface CompletionOptions extends ChatRequestOptions {
  maxTokens: number;
}

export interface Completion {
  text: string;
  usage: TokenUsage;
  model: string;
}

export interface LlmProvider {
  /** Name stored in the usage table, e.g. "anthropic" */
  readonly name: string;
  streamChat(options: ChatRequestOptions): AsyncIterable<LlmStreamEvent>;
  complete(options: CompletionOptions): Promise<Completion>;
}

export interface EmbeddingProvider {
  readonly dimensions: number;
  /** Cosine similarity below which a chunk is treated as unrelated to the question */
  readonly minRelevance: number;
  /** Returns one vector per input text, in the same order */
  embed(texts: string[]): Promise<number[][]>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

/** Must match vector(1536) in the migration */
export const EMBEDDING_DIMENSIONS = 1536;
