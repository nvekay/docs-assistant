import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/config';

export const PG_POOL = Symbol('PG_POOL');

/**
 * Managed Postgres (Neon) URLs carry sslmode=require. pg warns that it will change what that
 * means, so the mode is taken out of the URL and TLS is set explicitly with full certificate
 * verification (Neon uses publicly trusted certificates). Local docker URLs have no sslmode.
 */
export function postgresConnection(url: string): { connectionString: string; ssl?: { rejectUnauthorized: true } } {
  const parsed = new URL(url);
  const mode = parsed.searchParams.get('sslmode');
  if (!mode || mode === 'disable') return { connectionString: url };
  parsed.searchParams.delete('sslmode');
  return { connectionString: parsed.toString(), ssl: { rejectUnauthorized: true } };
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const { connectionString, ssl } = postgresConnection(config.DATABASE_URL);
        const pool = new Pool({
          connectionString,
          ssl,
          max: 10,
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
