import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/config';
import { PG_POOL } from '../db/db.module';
import { toVectorLiteral } from '../db/vector';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from '../llm/llm.types';
import { RetrievedChunk } from './prompt';
import { fuseRankings } from './rank-fusion';

interface ChunkRow {
  id: string;
  document_id: string;
  title: string;
  content: string;
  score: number;
}

/** How many candidates each search contributes before fusion */
const CANDIDATES = 20;

const toChunk = (r: ChunkRow): RetrievedChunk => ({
  chunkId: Number(r.id),
  documentId: r.document_id,
  documentTitle: r.title,
  content: r.content,
  score: r.score,
});

/**
 * Hybrid search over all documents: Postgres full-text search (stemmed words, ranked by
 * ts_rank_cd) and vector similarity (pgvector, HNSW index), merged with Reciprocal Rank Fusion.
 * Either search alone misses things the other finds; together they cover more of the docs.
 */
@Injectable()
export class RetrievalService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async search(query: string): Promise<RetrievedChunk[]> {
    const [vector] = await this.embeddings.embed([query]);
    const literal = toVectorLiteral(vector);
    const minScore = this.config.RETRIEVAL_MIN_SCORE ?? this.embeddings.minRelevance;

    const [semantic, fullText] = await Promise.all([
      // ORDER BY the distance operator itself so Postgres can use the HNSW index
      this.pool.query<ChunkRow>(
        `SELECT c.id, c.document_id, d.title, c.content, 1 - (c.embedding <=> $1::vector) AS score
         FROM chunks c
         JOIN documents d ON d.id = c.document_id
         ORDER BY c.embedding <=> $1::vector
         LIMIT $2`,
        [literal, CANDIDATES],
      ),
      // OR of the stemmed query words (plainto_tsquery would require all of them); stopwords drop out
      this.pool.query<ChunkRow>(
        `SELECT c.id, c.document_id, d.title, c.content, 1 - (c.embedding <=> $2::vector) AS score
         FROM chunks c
         JOIN documents d ON d.id = c.document_id,
              to_tsquery('english', replace(plainto_tsquery('english', $1)::text, ' & ', ' | ')) AS q
         WHERE c.tsv @@ q
         ORDER BY ts_rank_cd(c.tsv, q) DESC
         LIMIT $3`,
        [query, literal, CANDIDATES],
      ),
    ]);

    const vectorHits = semantic.rows.filter((r) => r.score >= minScore).map(toChunk);
    return fuseRankings([fullText.rows.map(toChunk), vectorHits], this.config.RETRIEVAL_TOP_K);
  }
}
