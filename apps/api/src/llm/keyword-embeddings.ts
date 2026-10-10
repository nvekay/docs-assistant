import { createHash } from 'node:crypto';
import { EmbeddingProvider, EMBEDDING_DIMENSIONS } from './llm.types';

// Function words carry no topic; without this filter "What is the capital of Peru?"
// would match any English text through "is", "the" and "of"
export const STOPWORDS = new Set(
  (
    'a an and are as at be by can do does for from has have how i if in into is it its me my no not of on or our ' +
    'so that the their them then there these they this to was we what when where which who why will with you your'
  ).split(' '),
);

/** Topic words of a text: lowercase, without stopwords */
export const contentWords = (text: string): string[] =>
  (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !STOPWORDS.has(w));

/**
 * Keyword embeddings ("hashed bag of words"): each topic word is hashed into one of 1536
 * buckets, so texts that share words get similar vectors. Runs locally, needs no API key and
 * costs nothing, which is why the demo uses it: Anthropic has no embeddings API.
 * It matches words, not meaning, so synonyms ("price" vs "cost") don't match.
 */
export class KeywordEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = EMBEDDING_DIMENSIONS;
  // With small (section-sized) chunks, one hash-bucket collision between an unrelated question and a
  // chunk scores ~0.14, so the cutoff sits above it. Single-word matches are left to full-text search,
  // which compares real words and can't collide.
  readonly minRelevance = 0.2;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    for (const word of contentWords(text)) {
      const bucket = createHash('md5').update(word).digest().readUInt32BE(0) % this.dimensions;
      vector[bucket] += 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  }
}
