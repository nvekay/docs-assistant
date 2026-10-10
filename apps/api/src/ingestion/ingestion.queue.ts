import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConnectionOptions, Queue } from 'bullmq';
import { APP_CONFIG, AppConfig } from '../config/config';

export const INGESTION_QUEUE_NAME = 'ingest-document';
export const INGESTION_QUEUE = Symbol('INGESTION_QUEUE');

export interface IngestionJobData {
  documentId: string;
}

/** BullMQ needs maxRetriesPerRequest: null so blocking commands survive Redis reconnects */
export function redisConnection(config: AppConfig): ConnectionOptions {
  return { url: config.REDIS_URL, maxRetriesPerRequest: null };
}

/** Retries with exponential backoff: 2 s, 4 s, 8 s; after the last one the document is marked failed */
export const INGESTION_JOB_OPTIONS = {
  attempts: 4,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

@Global()
@Module({
  providers: [
    {
      provide: INGESTION_QUEUE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const queue = new Queue<IngestionJobData>(INGESTION_QUEUE_NAME, { connection: redisConnection(config) });
        // Without a listener BullMQ prints bare "read ECONNRESET" errors with no hint where they came from
        const logger = new Logger('IngestionQueue');
        queue.on('error', (error) => logger.warn(`Redis connection: ${error.message}`));
        return queue;
      },
    },
  ],
  exports: [INGESTION_QUEUE],
})
export class IngestionQueueModule implements OnApplicationShutdown {
  constructor(@Inject(INGESTION_QUEUE) private readonly queue: Queue<IngestionJobData>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
