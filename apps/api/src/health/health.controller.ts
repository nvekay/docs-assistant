import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { LLM_PROVIDER, LlmProvider } from '../llm/llm.types';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  @Get()
  async check() {
    try {
      await this.pool.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'unreachable' });
    }
    return { status: 'ok', database: 'ok', llmProvider: this.llm.name };
  }
}
