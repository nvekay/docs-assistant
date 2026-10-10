import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
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
      useFactory: (config: AppConfig) => {
        const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
        // ioredis reconnects by itself; the listener only names the source of the error in the logs
        const logger = new Logger('Redis');
        redis.on('error', (error: Error) => logger.warn(`Rate-limit connection: ${error.message}`));
        return redis;
      },
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
