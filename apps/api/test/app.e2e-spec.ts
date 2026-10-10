import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ChatMessageDto, ChatStreamEvent, DocumentDto } from '@docs-assistant/shared';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PG_POOL } from '../src/db/db.module';

/**
 * The whole API against real Postgres (pgvector) and Redis in throwaway containers.
 * The LLM and embeddings are the keyless fakes, and the ingestion worker runs in-process,
 * so upload -> queue -> index -> chat is exercised exactly as in production.
 */

const ADMIN = { email: 'admin@example.com', password: 'admin-e2e-password' };
const VIEWER = { email: 'viewer@example.com', password: 'viewer-e2e-password' };
const RATE_LIMIT = 5;

const GUIDE = `# Password reset

To reset your password, open Settings and click "Reset password". The reset link is valid for 30 minutes.

## Invoices

Invoices can be exported to CSV from the Billing page.
`;

/** Runs the "-- Up Migration" part of every SQL migration, in file name order */
async function migrate(pool: Pool) {
  const dir = join(__dirname, '../../../migrations');
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const up = readFileSync(join(dir, file), 'utf8').split('-- Down Migration')[0];
    await pool.query(up);
  }
}

function parseSse(body: string): ChatStreamEvent[] {
  return body
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data:'))
    .map((block) => JSON.parse(block.slice(5).trim()) as ChatStreamEvent);
}

const answerText = (events: ChatStreamEvent[]) => events.map((e) => (e.type === 'delta' ? e.text : '')).join('');

describe('Docs Assistant API (e2e)', () => {
  let postgres: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;
  let app: INestApplication;
  let pool: Pool;
  let adminToken: string;

  beforeAll(async () => {
    [postgres, redis] = await Promise.all([
      new PostgreSqlContainer('pgvector/pgvector:pg16').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);

    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: postgres.getConnectionUri(),
      REDIS_URL: redis.getConnectionUrl(),
      LLM_PROVIDER: 'fake',
      EMBEDDING_PROVIDER: 'fake',
      RUN_WORKER_IN_API: 'true',
      CHAT_RATE_LIMIT_PER_MINUTE: String(RATE_LIMIT),
      DAILY_TOKEN_LIMIT_PER_USER: '50000',
      ADMIN_EMAIL: ADMIN.email,
      ADMIN_PASSWORD: ADMIN.password,
      DEMO_VIEWER_EMAIL: VIEWER.email,
      DEMO_VIEWER_PASSWORD: VIEWER.password,
      JWT_SECRET: 'e2e-secret',
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.enableShutdownHooks();
    pool = app.get<Pool>(PG_POOL);
    await migrate(pool);
    await app.init();

    const login = await request(app.getHttpServer()).post('/auth/login').send(ADMIN).expect(200);
    adminToken = login.body.accessToken;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await Promise.all([postgres?.stop(), redis?.stop()]);
  });

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });

  async function waitForReady(id: string): Promise<DocumentDto> {
    for (let i = 0; i < 50; i++) {
      const res = await request(app.getHttpServer()).get('/documents').set(auth()).expect(200);
      const doc = (res.body as DocumentDto[]).find((d) => d.id === id);
      if (doc?.status === 'ready' || doc?.status === 'failed') return doc;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Document ${id} was not indexed in time`);
  }

  it('reports health', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', database: 'ok', llmProvider: 'fake' });
  });

  describe('admin auth', () => {
    it('rejects wrong credentials and missing tokens', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ ...ADMIN, password: 'nope' })
        .expect(401);
      await request(app.getHttpServer()).get('/documents').expect(401);
    });

    it('lets the demo viewer read but not change anything', async () => {
      const login = await request(app.getHttpServer()).post('/auth/login').send(VIEWER).expect(200);
      expect(login.body.role).toBe('viewer');
      const viewer = { Authorization: `Bearer ${login.body.accessToken}` };

      await request(app.getHttpServer()).get('/documents').set(viewer).expect(200);
      await request(app.getHttpServer()).get('/usage').set(viewer).expect(200);
      await request(app.getHttpServer())
        .post('/documents/url')
        .set(viewer)
        .send({ url: 'https://example.com' })
        .expect(403);
    });
  });

  describe('ingestion and chat', () => {
    let documentId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/documents/upload')
        .set(auth())
        .attach('file', Buffer.from(GUIDE), { filename: 'guide.md', contentType: 'text/markdown' })
        .expect(201);
      documentId = res.body.id;
    });

    it('indexes an uploaded document through the queue', async () => {
      const doc = await waitForReady(documentId);
      expect(doc).toMatchObject({ status: 'ready', title: 'Password reset', sourceType: 'md' });
      expect(doc.chunkCount).toBeGreaterThan(0);
    });

    it('streams an answer with a citation, then continues the conversation', async () => {
      const agent = request.agent(app.getHttpServer());

      const first = await agent.post('/chat').send({ message: 'How do I reset my password?' }).expect(200);
      expect(first.headers['content-type']).toContain('text/event-stream');
      expect(first.headers['set-cookie']?.[0]).toMatch(/^da_uid=.*HttpOnly/i);

      const events = parseSse(first.text);
      expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['meta', 'delta', 'citations', 'done']));
      expect(answerText(events)).toContain('open Settings and click "Reset password"');

      const citations = events.find((e) => e.type === 'citations');
      expect(citations).toMatchObject({ citations: [{ index: 1, documentId, documentTitle: 'Password reset' }] });
      const done = events.find((e) => e.type === 'done');
      expect(done).toMatchObject({
        type: 'done',
        usage: { inputTokens: expect.any(Number), costUsd: expect.any(Number) },
      });

      const meta = events[0] as Extract<ChatStreamEvent, { type: 'meta' }>;
      await agent
        .post('/chat')
        .send({ conversationId: meta.conversationId, message: 'how long is the link valid?' })
        .expect(200);

      const history = await agent.get(`/chat/${meta.conversationId}/messages`).expect(200);
      const messages = history.body as ChatMessageDto[];
      expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
      expect(messages[1].citations).toHaveLength(1);

      // Another visitor (no cookie) can't read or continue this conversation
      await request(app.getHttpServer()).get(`/chat/${meta.conversationId}/messages`).expect(404);
      await request(app.getHttpServer())
        .post('/chat')
        .send({ conversationId: meta.conversationId, message: 'hi' })
        .expect(404);
    });

    it('declines questions the documentation does not cover', async () => {
      const res = await request(app.getHttpServer()).post('/chat').send({ message: 'What is the capital of Peru?' });
      const events = parseSse(res.text);
      expect(answerText(events)).toContain("couldn't find");
      expect(events.find((e) => e.type === 'citations')).toEqual({ type: 'citations', citations: [] });
    });

    it('records usage for the admin dashboard', async () => {
      const res = await request(app.getHttpServer()).get('/usage').set(auth()).expect(200);
      expect(res.body[0].requests).toBeGreaterThanOrEqual(3);
      expect(res.body[0].costUsd).toBeGreaterThan(0);
    });
  });

  describe('limits', () => {
    it('rate-limits a visitor per minute with Retry-After', async () => {
      const agent = request.agent(app.getHttpServer());
      for (let i = 0; i < RATE_LIMIT; i++) {
        await agent.post('/chat').send({ message: 'invoices csv' }).expect(200);
      }
      const blocked = await agent.post('/chat').send({ message: 'invoices csv' }).expect(429);
      expect(blocked.body.code).toBe('rate_limited');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('stops answering when the daily token budget is used up', async () => {
      const agent = request.agent(app.getHttpServer());
      const first = await agent.post('/chat').send({ message: 'invoices csv' }).expect(200);
      const cookies = first.headers['set-cookie'] as unknown as string[];
      const userId = /da_uid=([^;]+)/.exec(cookies[0])![1];

      await pool.query(
        `INSERT INTO usage (user_id, provider, model, input_tokens, output_tokens, cost_usd)
         VALUES ($1, 'test', 'test', 50000, 0, 0)`,
        [userId],
      );
      const blocked = await agent.post('/chat').send({ message: 'invoices csv' }).expect(429);
      expect(blocked.body.code).toBe('daily_limit');
    });

    it('validates the question', async () => {
      await request(app.getHttpServer()).post('/chat').send({ message: '   ' }).expect(400);
    });
  });
});
