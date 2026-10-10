import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config/config';

export const REDIS = Symbol('REDIS');

/** Shared Redis client for rate limiting (BullMQ keeps its own connections) */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      // Fail fast instead of queueing commands forever while Redis is down
      useFactory: (config: AppConfig) => new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
