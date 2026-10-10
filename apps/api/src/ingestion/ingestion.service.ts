import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { toVectorLiteral } from '../db/vector';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from '../llm/llm.types';
import { chunkDocument } from './chunker';
import { ExtractedDocument, extractMarkdown, extractPdf, fetchUrl } from './extract';

const EMBED_BATCH = 64;
const INSERT_BATCH = 100;

interface DocumentRow {
  id: string;
  title: string;
  source_type: 'md' | 'pdf' | 'url';
  source_ref: string | null;
  raw_content: Buffer | null;
}

/**
 * Turns one document into searchable chunks: extract text -> split into chunks ->
 * embed in batches -> replace the document's chunks in one transaction.
 * Runs in the worker process; the API only enqueues jobs.
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
  ) {}

  async process(documentId: string): Promise<{ chunks: number }> {
    const { rows } = await this.pool.query<DocumentRow>(
      `UPDATE documents SET status = 'processing', error = NULL, updated_at = now()
       WHERE id = $1
       RETURNING id, title, source_type, source_ref, raw_content`,
      [documentId],
    );
    const doc = rows[0];
    if (!doc) {
      this.logger.warn(`Document ${documentId} no longer exists, skipping`);
      return { chunks: 0 };
    }

    const extracted = await this.extract(doc);
    // The same title the document ends up with (extracted beats the uploaded file name)
    const chunks = chunkDocument(extracted.text, { title: extracted.title ?? doc.title });
    if (chunks.length === 0) {
      throw new Error('No readable text found in the document');
    }

    const vectors: number[][] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      vectors.push(...(await this.embeddings.embed(chunks.slice(i, i + EMBED_BATCH).map((c) => c.content))));
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Reindexing replaces the old chunks atomically, so search never sees a half-indexed document
      await client.query('DELETE FROM chunks WHERE document_id = $1', [doc.id]);
      for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
        const batch = chunks.slice(i, i + INSERT_BATCH);
        const params: unknown[] = [];
        const values = batch.map((chunk, j) => {
          params.push(doc.id, chunk.ord, chunk.content, chunk.tokens, toVectorLiteral(vectors[i + j]));
          const p = j * 5;
          return `($${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}::vector)`;
        });
        await client.query(
          `INSERT INTO chunks (document_id, ord, content, tokens, embedding) VALUES ${values.join(', ')}`,
          params,
        );
      }
      // A title taken from the document beats the file name the admin uploaded
      await client.query(
        `UPDATE documents SET status = 'ready', title = COALESCE($2, title), updated_at = now() WHERE id = $1`,
        [doc.id, extracted.title],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    this.logger.log(JSON.stringify({ event: 'document_indexed', documentId: doc.id, chunks: chunks.length }));
    return { chunks: chunks.length };
  }

  async markFailed(documentId: string, message: string): Promise<void> {
    await this.pool.query(`UPDATE documents SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`, [
      documentId,
      message.slice(0, 500),
    ]);
  }

  private async extract(doc: DocumentRow): Promise<ExtractedDocument> {
    switch (doc.source_type) {
      case 'url':
        return fetchUrl(doc.source_ref!, AbortSignal.timeout(30_000));
      case 'pdf':
        return extractPdf(this.requireRaw(doc));
      case 'md':
        return extractMarkdown(this.requireRaw(doc));
    }
  }

  private requireRaw(doc: DocumentRow): Buffer {
    if (!doc.raw_content) throw new Error('Uploaded file content is missing');
    return doc.raw_content;
  }
}
