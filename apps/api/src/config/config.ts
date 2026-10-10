import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/** Lines like "KEY=" in .env arrive as empty strings and must mean "not set" */
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    DATABASE_URL: z.string().min(1),
    // A REST (https://) URL or a plain redis:// URL to a TLS-only host connects and then gets dropped,
    // which only shows up later as endless "read ECONNRESET"; reject those at startup instead
    REDIS_URL: z
      .string()
      .min(1)
      .refine((url) => /^rediss?:\/\//.test(url), {
        message: 'must be a redis:// or rediss:// URL (for Upstash: Connect -> ioredis, not the https REST URL)',
      })
      .refine((url) => !/^redis:\/\/[^/]*upstash\.io/.test(url), {
        message: 'Upstash requires TLS: use the rediss:// URL (two s) with the password',
      }),
    PORT: z.coerce.number().int().positive().default(3001),
    CORS_ORIGIN: z.string().default('http://localhost:3000'),

    /** anthropic = Claude; fake = keyless stand-in for local development and tests */
    LLM_PROVIDER: z.enum(['fake', 'anthropic']).default('fake'),

    ANTHROPIC_API_KEY: z.string().optional(),
    // Haiku 5.5 is the cheapest current model and plenty for answering from given fragments
    ANTHROPIC_MODEL: z.string().default('claude-haiku-5-5'),
    /** Only for API keys not scoped to a workspace: the workspace ID from the Claude Console */
    ANTHROPIC_WORKSPACE_ID: z.preprocess(emptyToUndefined, z.string().optional()),
    ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('low'),
    /** Opt-in server-side retry on another model when the requested one declines (beta) */
    ANTHROPIC_FALLBACK: z.preprocess((v) => v === 'true' || v === '1', z.boolean()),

    /** Pause between words of the fake model, to make streaming visible without an API key */
    FAKE_LLM_DELAY_MS: z.coerce.number().int().min(0).max(1000).default(0),

    /** Caps the answer (thinking included), so one request has a known maximum cost */
    LLM_MAX_TOKENS: z.coerce.number().int().positive().default(8000),
    /** Earlier messages sent with each question, so the model remembers the conversation */
    CHAT_HISTORY_MESSAGES: z.coerce.number().int().min(0).max(100).default(24),

    // Claude Haiku 5.5 list prices (USD per million tokens, prompts up to 100k tokens)
    PRICE_INPUT_PER_MTOK: z.coerce.number().nonnegative().default(0.1),
    PRICE_OUTPUT_PER_MTOK: z.coerce.number().nonnegative().default(0.5),
    DAILY_TOKEN_LIMIT_PER_USER: z.coerce.number().int().positive().default(200000),
    /** Hard cap for the whole demo per day, so a public deployment can't run up the API bill */
    DAILY_TOKEN_LIMIT_GLOBAL: z.coerce.number().int().positive().default(1_000_000),
    CHAT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),

    RETRIEVAL_TOP_K: z.coerce.number().int().min(1).max(20).default(8),
    /** Overrides the default relevance threshold of the keyword embeddings (cosine similarity, 0..1) */
    RETRIEVAL_MIN_SCORE: z.preprocess(emptyToUndefined, z.coerce.number().min(0).max(1).optional()),

    ADMIN_EMAIL: z.string().email().default('admin@example.com'),
    ADMIN_PASSWORD: z.string().min(1).default('change-me'),
    JWT_SECRET: z.string().min(1).default('change-me-too'),
    // Optional public read-only account for the deployed demo
    DEMO_VIEWER_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
    DEMO_VIEWER_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

    /** Free hosting has no separate worker service, so the API can run the queue worker itself */
    RUN_WORKER_IN_API: z.preprocess((v) => v === 'true' || v === '1', z.boolean()).default(false),
  })
  // Fail at startup, not on the first chat request, when a real provider lacks its key
  .superRefine((c, ctx) => {
    if (c.LLM_PROVIDER === 'anthropic' && !c.ANTHROPIC_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['ANTHROPIC_API_KEY'], message: 'required when LLM_PROVIDER=anthropic' });
    }
    if (c.NODE_ENV === 'production' && (c.ADMIN_PASSWORD === 'change-me' || c.JWT_SECRET === 'change-me-too')) {
      ctx.addIssue({
        code: 'custom',
        path: ['ADMIN_PASSWORD'],
        message: 'set ADMIN_PASSWORD and JWT_SECRET to real secrets in production',
      });
    }
    if (!c.DEMO_VIEWER_EMAIL !== !c.DEMO_VIEWER_PASSWORD) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEMO_VIEWER_EMAIL'],
        message: 'set both DEMO_VIEWER_EMAIL and DEMO_VIEWER_PASSWORD, or neither',
      });
    }
  });

export type AppConfig = z.infer<typeof configSchema>;

/** Local dev reads the repo-root .env; in production the host injects real env vars and no file exists */
export function loadDotEnv(): void {
  for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }
  return parsed.data;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
