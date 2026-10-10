import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/config';

export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const pool = new Pool({
          connectionString: config.DATABASE_URL,
          max: 10,
          // Neon and other managed Postgres require TLS; local docker does not
          ssl: config.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
          // Neon suspends idle compute and drops its connections; don't hold idle ones for long
          idleTimeoutMillis: 60_000,
        });
        // An idle client dropped by the server emits 'error'; without a listener that crashes the process.
        // The pool discards the broken client and opens a new one on the next query.
        const logger = new Logger('Postgres');
        pool.on('error', (error) => logger.warn(`Idle connection closed: ${error.message}`));
        return pool;
      },
    },
  ],
  exports: [PG_POOL],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
