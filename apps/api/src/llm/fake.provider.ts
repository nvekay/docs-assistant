import { contentWords } from './keyword-embeddings';
import { ChatRequestOptions, Completion, CompletionOptions, LlmProvider, LlmStreamEvent } from './llm.types';

/** Rough token estimate (~4 characters per token) for the fake provider and chunking */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** The sentence of a fragment sharing the most words with the question (headings skipped) */
function bestSentence(fragment: string, question: string): string {
  const wanted = new Set(contentWords(question));
  const sentences = fragment
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
  let best = sentences[0] ?? fragment;
  let bestScore = -1;
  for (const sentence of sentences) {
    const score = new Set(contentWords(sentence).filter((w) => wanted.has(w))).size;
    if (score > bestScore) [best, bestScore] = [sentence, score];
  }
  return best;
}

/**
 * Keyless stand-in for a real model. It answers with the sentence of the top source that best
 * matches the question, so retrieval and citations can be tested end to end for free.
 */
export class FakeLlmProvider implements LlmProvider {
  readonly name = 'fake';

  /** delayMs between words makes streaming (and the Stop button) visible in demos and browser tests */
  constructor(private readonly delayMs = 0) {}

  /** The fake model can't rewrite queries; an empty reply makes the caller fall back to the original question */
  async complete(_options: CompletionOptions): Promise<Completion> {
    return { text: '', usage: { inputTokens: 0, outputTokens: 0 }, model: 'fake-model' };
  }

  async *streamChat({ system, messages, signal }: ChatRequestOptions): AsyncIterable<LlmStreamEvent> {
    const source = /\[1\][^\n]*\n([\s\S]*?)(?:\n\[\d+\]|$)/.exec(system)?.[1]?.trim();
    const question = messages.findLast((m) => m.role === 'user')?.content ?? '';
    const answer = source
      ? `According to the documentation [1]: ${bestSentence(source, question)}`
      : "I couldn't find the answer in the documentation.";

    for (const word of answer.split(/(?<= )/)) {
      if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      // Behaves like the real SDKs: an aborted request stops the stream with an error
      signal?.throwIfAborted();
      yield { type: 'text', text: word };
    }

    const input = system + messages.map((m) => m.content).join('\n');
    yield {
      type: 'final',
      model: 'fake-model',
      usage: { inputTokens: estimateTokens(input), outputTokens: estimateTokens(answer) },
      stopReason: 'end',
    };
  }
}
