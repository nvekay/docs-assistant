import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/config';
import { PG_POOL } from '../db/db.module';
import { toVectorLiteral } from '../db/vector';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from '../llm/llm.types';
import { RetrievedChunk } from './prompt';

interface ChunkRow {
  id: string;
  document_id: string;
  title: string;
  content: string;
  score: number;
}

@Injectable()
export class RetrievalService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Top-k chunks by cosine similarity, minus the ones too weak to be about the question */
  async search(query: string): Promise<RetrievedChunk[]> {
    const [vector] = await this.embeddings.embed([query]);
    // ORDER BY the distance operator itself so Postgres can use the HNSW index;
    // chunks only exist for documents that were indexed successfully
    const { rows } = await this.pool.query<ChunkRow>(
      `SELECT c.id, c.document_id, d.title, c.content, 1 - (c.embedding <=> $1::vector) AS score
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
       ORDER BY c.embedding <=> $1::vector
       LIMIT $2`,
      [toVectorLiteral(vector), this.config.RETRIEVAL_TOP_K],
    );
    const minScore = this.config.RETRIEVAL_MIN_SCORE ?? this.embeddings.minRelevance;
    return rows
      .filter((r) => r.score >= minScore)
      .map((r) => ({
        chunkId: Number(r.id),
        documentId: r.document_id,
        documentTitle: r.title,
        content: r.content,
        score: r.score,
      }));
  }
}
