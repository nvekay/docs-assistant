import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';

/**
 * Sliding-window log in a Redis sorted set: one member per allowed request, scored by time.
 * The check and the insert run in one Lua script, so concurrent requests can't both slip
 * past the limit. Returns how long to wait when the window is full.
 */
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
if redis.call('ZCARD', key) >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return {0, tonumber(oldest[2]) + window - now}
end
redis.call('ZADD', key, now, ARGV[4])
redis.call('PEXPIRE', key, window)
return {1, 0}
`;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export class SlidingWindowRateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly prefix = 'ratelimit:chat',
  ) {}

  async hit(key: string, now = Date.now()): Promise<RateLimitResult> {
    const [allowed, retryAfterMs] = (await this.redis.eval(
      SLIDING_WINDOW_SCRIPT,
      1,
      `${this.prefix}:${key}`,
      now,
      this.windowMs,
      this.limit,
      `${now}-${randomUUID()}`,
    )) as [number, number];
    return { allowed: allowed === 1, retryAfterMs: Math.max(0, retryAfterMs) };
  }
}
