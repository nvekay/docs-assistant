import { Inject, Injectable } from '@nestjs/common';
import type { UsageDayDto } from '@docs-assistant/shared';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { TokenUsage } from '../llm/llm.types';

export interface UsageRecord {
  userId: string;
  provider: string;
  model: string;
  usage: TokenUsage;
  costUsd: number;
}

/** Days are UTC days, so limits reset at the same moment for every user */
const TODAY_UTC = `date_trunc('day', now(), 'UTC')`;

@Injectable()
export class UsageService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async record(r: UsageRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO usage (user_id, provider, model, input_tokens, output_tokens, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [r.userId, r.provider, r.model, r.usage.inputTokens, r.usage.outputTokens, r.costUsd],
    );
  }

  /** Tokens spent today by one user and by everyone, for the daily limits */
  async tokensToday(userId: string): Promise<{ user: number; total: number }> {
    const { rows } = await this.pool.query<{ user_tokens: number; total_tokens: number }>(
      `SELECT COALESCE(SUM(input_tokens + output_tokens) FILTER (WHERE user_id = $1), 0)::int AS user_tokens,
              COALESCE(SUM(input_tokens + output_tokens), 0)::int AS total_tokens
       FROM usage
       WHERE created_at >= ${TODAY_UTC}`,
      [userId],
    );
    return { user: rows[0].user_tokens, total: rows[0].total_tokens };
  }

  /** Per-day totals for the admin dashboard, newest first */
  async dailySummary(days: number): Promise<UsageDayDto[]> {
    const { rows } = await this.pool.query<{
      day: string;
      requests: number;
      users: number;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
    }>(
      `SELECT to_char((created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
              COUNT(*)::int AS requests,
              COUNT(DISTINCT user_id)::int AS users,
              SUM(input_tokens)::int AS input_tokens,
              SUM(output_tokens)::int AS output_tokens,
              SUM(cost_usd)::float8 AS cost_usd
       FROM usage
       WHERE created_at >= ${TODAY_UTC} - make_interval(days => $1 - 1)
       GROUP BY 1
       ORDER BY 1 DESC`,
      [days],
    );
    return rows.map((r) => ({
      day: r.day,
      requests: r.requests,
      users: r.users,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      costUsd: r.cost_usd,
    }));
  }
}
