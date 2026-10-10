import { createHash } from 'node:crypto';
import { ChatRequestOptions, EmbeddingProvider, EMBEDDING_DIMENSIONS, LlmProvider, LlmStreamEvent } from './llm.types';

/** Rough token estimate (~4 characters per token) for the fake provider and chunking */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

// Function words carry no topic; without this filter "What is the capital of Peru?"
// would match any English text through "is", "the" and "of"
const STOPWORDS = new Set(
  (
    'a an and are as at be by can do does for from has have how i if in into is it its me my no not of on or our ' +
    'so that the their them then there these they this to was we what when where which who why will with you your'
  ).split(' '),
);

/** Topic words of a text: lowercase, without stopwords */
const contentWords = (text: string) =>
  new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !STOPWORDS.has(w)));

/** The sentence of a fragment sharing the most words with the question (headings skipped) */
function bestSentence(fragment: string, question: string): string {
  const wanted = contentWords(question);
  const sentences = fragment
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
  let best = sentences[0] ?? fragment;
  let bestScore = -1;
  for (const sentence of sentences) {
    const score = [...contentWords(sentence)].filter((w) => wanted.has(w)).length;
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

/**
 * Deterministic "hashed bag of words" embeddings: texts that share words get similar vectors.
 * Good enough for local development and tests without an embeddings API.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = EMBEDDING_DIMENSIONS;
  // Bag-of-words vectors score low even for good matches, so the cutoff is lower
  readonly minRelevance = 0.1;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const words = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !STOPWORDS.has(w));
    for (const word of words) {
      const bucket = createHash('md5').update(word).digest().readUInt32BE(0) % this.dimensions;
      vector[bucket] += 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  }
}
