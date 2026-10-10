import { RetrievedChunk } from './prompt';

/** The usual RRF constant: damps the weight of the very top ranks so no single list dominates */
const RRF_K = 60;

/**
 * Reciprocal Rank Fusion: merges ranked lists (full-text and vector search) by rank
 * alone, so their incomparable scores never have to be normalized against each other.
 * A chunk found by both searches rises to the top.
 */
export function fuseRankings(lists: RetrievedChunk[][], limit: number): RetrievedChunk[] {
  const fused = new Map<number, { chunk: RetrievedChunk; score: number }>();
  for (const list of lists) {
    list.forEach((chunk, rank) => {
      const entry = fused.get(chunk.chunkId);
      const contribution = 1 / (RRF_K + rank + 1);
      if (entry) {
        entry.score += contribution;
        // Keep the cosine similarity shown in citations, whichever list it came from
        if (chunk.score > entry.chunk.score) entry.chunk = chunk;
      } else {
        fused.set(chunk.chunkId, { chunk, score: contribution });
      }
    });
  }
  return [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.chunk);
}
