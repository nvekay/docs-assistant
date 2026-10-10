import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ChatController } from './chat/chat.controller';
import { ChatService } from './chat/chat.service';
import { RetrievalService } from './chat/retrieval.service';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { DocumentsController } from './documents/documents.controller';
import { DocumentsService } from './documents/documents.service';
import { HealthController } from './health/health.controller';
import { IngestionQueueModule } from './ingestion/ingestion.queue';
import { IngestionService } from './ingestion/ingestion.service';
import { InApiIngestionWorker } from './ingestion/ingestion.worker';
import { LlmModule } from './llm/llm.module';
import { RedisModule } from './redis/redis.module';
import { UsageController } from './usage/usage.controller';
import { UsageService } from './usage/usage.service';

@Module({
  imports: [ConfigModule, DbModule, RedisModule, LlmModule, IngestionQueueModule, AuthModule],
  controllers: [HealthController, DocumentsController, ChatController, UsageController],
  // The worker pieces only do anything when RUN_WORKER_IN_API=true
  providers: [DocumentsService, RetrievalService, ChatService, UsageService, IngestionService, InApiIngestionWorker],
})
export class AppModule {}
