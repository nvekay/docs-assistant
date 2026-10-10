import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { LLM_PROVIDER, LlmProvider } from '../llm/llm.types';
import { REDIS } from '../redis/redis.module';

const TIMEOUT_MS = 3000;

/** Resolves to 'ok' or 'unreachable', never hangs longer than the timeout */
async function probe(check: () => Promise<unknown>): Promise<'ok' | 'unreachable'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
  });
  try {
    await Promise.race([check(), timeout]);
    return 'ok';
  } catch {
    return 'unreachable';
  } finally {
    clearTimeout(timer);
  }
}

@Controller('health')
export class HealthController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  /** Used by the hosting health check: a wrong DATABASE_URL or REDIS_URL fails the deploy visibly */
  @Get()
  async check() {
    const [database, redis] = await Promise.all([
      probe(() => this.pool.query('SELECT 1')),
      probe(() => this.redis.ping()),
    ]);
    const body = {
      status: database === 'ok' && redis === 'ok' ? 'ok' : 'error',
      database,
      redis,
      // Render sets RENDER_GIT_COMMIT; shows which deploy is answering
      commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? 'local',
    };
    if (body.status !== 'ok') throw new ServiceUnavailableException(body);
    return { ...body, llmProvider: this.llm.name };
  }
}
