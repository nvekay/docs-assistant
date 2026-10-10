import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/config';

export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new Pool({
          connectionString: config.DATABASE_URL,
          max: 10,
          // Neon and other managed Postgres require TLS; local docker does not
          ssl: config.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
        }),
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
