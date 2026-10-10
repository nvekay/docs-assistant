import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { APP_CONFIG, AppConfig, loadDotEnv } from './config/config';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { IngestionService } from './ingestion/ingestion.service';
import { startIngestionWorker } from './ingestion/ingestion.worker';
import { LlmModule } from './llm/llm.module';

@Module({
  imports: [ConfigModule, DbModule, LlmModule],
  providers: [IngestionService],
})
class WorkerModule {}

/**
 * Background worker: a separate process (a Render "background worker" in production)
 * that shares the API's modules but only consumes the ingestion queue.
 */
async function bootstrap() {
  loadDotEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  const worker = startIngestionWorker(app.get<AppConfig>(APP_CONFIG), app.get(IngestionService));

  const shutdown = async () => {
    await worker.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void bootstrap();
