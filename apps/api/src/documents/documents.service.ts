import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { DocumentDto, SourceType } from '@docs-assistant/shared';
import { Queue } from 'bullmq';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { INGESTION_JOB_OPTIONS, INGESTION_QUEUE, IngestionJobData } from '../ingestion/ingestion.queue';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const SOURCE_BY_EXTENSION: Record<string, SourceType> = { md: 'md', markdown: 'md', txt: 'md', pdf: 'pdf' };

interface DocumentListRow {
  id: string;
  title: string;
  source_type: SourceType;
  source_ref: string | null;
  status: DocumentDto['status'];
  error: string | null;
  chunk_count: string;
  created_at: Date;
}

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(INGESTION_QUEUE) private readonly queue: Queue<IngestionJobData>,
  ) {}

  async list(): Promise<DocumentDto[]> {
    const { rows } = await this.pool.query<DocumentListRow>(
      `SELECT d.id, d.title, d.source_type, d.source_ref, d.status, d.error, d.created_at,
              (SELECT count(*) FROM chunks c WHERE c.document_id = d.id) AS chunk_count
       FROM documents d
       ORDER BY d.created_at DESC`,
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      sourceType: r.source_type,
      sourceRef: r.source_ref,
      status: r.status,
      error: r.error,
      chunkCount: Number(r.chunk_count),
      createdAt: r.created_at.toISOString(),
    }));
  }

  async createFromUpload(
    file: { originalname: string; buffer: Buffer; mimetype: string; size: number },
    title?: string,
  ) {
    const extension = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    const sourceType = SOURCE_BY_EXTENSION[extension];
    if (!sourceType) throw new BadRequestException('Only .md, .markdown, .txt and .pdf files are supported');
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException('File is larger than 10 MB');

    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO documents (title, source_type, source_ref, raw_content, mime_type)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [title?.trim() || file.originalname, sourceType, file.originalname, file.buffer, file.mimetype],
    );
    await this.enqueue(rows[0].id);
    return { id: rows[0].id };
  }

  async createFromUrl(url: string, title?: string) {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO documents (title, source_type, source_ref) VALUES ($1, 'url', $2) RETURNING id`,
      [title?.trim() || new URL(url).hostname + new URL(url).pathname, url],
    );
    await this.enqueue(rows[0].id);
    return { id: rows[0].id };
  }

  async reindex(id: string) {
    const { rowCount } = await this.pool.query(
      `UPDATE documents SET status = 'queued', error = NULL, updated_at = now() WHERE id = $1`,
      [id],
    );
    if (!rowCount) throw new NotFoundException('Document not found');
    await this.enqueue(id);
    return { id };
  }

  async remove(id: string) {
    const { rowCount } = await this.pool.query('DELETE FROM documents WHERE id = $1', [id]);
    if (!rowCount) throw new NotFoundException('Document not found');
  }

  private async enqueue(documentId: string) {
    // A unique job id per run lets a document be reindexed while an older job is still kept for history
    await this.queue.add('ingest', { documentId }, { ...INGESTION_JOB_OPTIONS, jobId: `${documentId}-${Date.now()}` });
  }
}
