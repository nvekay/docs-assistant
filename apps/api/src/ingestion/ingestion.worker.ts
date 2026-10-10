import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Worker } from 'bullmq';
import { APP_CONFIG, AppConfig } from '../config/config';
import { INGESTION_JOB_OPTIONS, INGESTION_QUEUE_NAME, IngestionJobData, redisConnection } from './ingestion.queue';
import { IngestionService } from './ingestion.service';

/**
 * Consumes the ingestion queue. Runs in the separate worker process (worker.ts) or,
 * on free hosting without background workers, inside the API (RUN_WORKER_IN_API=true).
 */
export function startIngestionWorker(config: AppConfig, ingestion: IngestionService): Worker<IngestionJobData> {
  const logger = new Logger('IngestionWorker');

  const worker = new Worker<IngestionJobData>(
    INGESTION_QUEUE_NAME,
    async (job) => ingestion.process(job.data.documentId),
    {
      connection: redisConnection(config),
      concurrency: 2,
      // An idle worker keeps polling Redis. Longer waits keep it inside the free Upstash command quota
      // and only delay how fast a crashed job is retried, not how fast new jobs start.
      drainDelay: 30,
      stalledInterval: 120_000,
    },
  );

  worker.on('failed', (job, error) => {
    if (!job) return;
    const attempts = job.opts.attempts ?? INGESTION_JOB_OPTIONS.attempts;
    logger.warn(
      JSON.stringify({
        event: 'ingest_failed',
        documentId: job.data.documentId,
        attempt: job.attemptsMade,
        error: error.message,
      }),
    );
    // Only the last attempt marks the document failed; earlier ones are retried with backoff
    if (job.attemptsMade >= attempts) {
      ingestion
        .markFailed(job.data.documentId, error.message)
        .catch((e: Error) => logger.error(`Could not mark document failed: ${e.message}`));
    }
  });

  // Connection drops are retried by BullMQ; the listener names them in the logs
  worker.on('error', (error) => logger.warn(`Redis connection: ${error.message}`));

  logger.log(`Listening on queue "${INGESTION_QUEUE_NAME}"`);
  return worker;
}

/** Starts the worker inside the API when RUN_WORKER_IN_API=true, and stops it before the DB pool closes */
@Injectable()
export class InApiIngestionWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private worker?: Worker<IngestionJobData>;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly ingestion: IngestionService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.RUN_WORKER_IN_API) this.worker = startIngestionWorker(this.config, this.ingestion);
  }

  // onModuleDestroy runs before the onApplicationShutdown hooks that close Postgres and Redis
  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
