import { loadConfig } from '../config/config';
import { calculateCostUsd } from './cost';
import { FakeEmbeddingProvider, FakeLlmProvider } from './fake.provider';
import { createLlmProvider } from './llm.module';
import { LlmStreamEvent } from './llm.types';

const baseEnv = { DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://x' };

async function collect(stream: AsyncIterable<LlmStreamEvent>) {
  const events: LlmStreamEvent[] = [];
  for await (const e of stream) events.push(e);
  return events;
}

describe('FakeLlmProvider', () => {
  it('answers with the sentence of the first source that matches the question, and ends with usage', async () => {
    const system =
      'Answer from the sources.\n\n[1] Getting started\n# Setup\nRequires Node 22. Install with pnpm install. Then run it.\n\n[2] Other\nIrrelevant.';
    const events = await collect(
      new FakeLlmProvider().streamChat({ system, messages: [{ role: 'user', content: 'How to install?' }] }),
    );

    const text = events
      .filter((e) => e.type === 'text')
      .map((e) => (e as { text: string }).text)
      .join('');
    expect(text).toBe('According to the documentation [1]: Install with pnpm install.');

    const final = events.at(-1);
    expect(final).toMatchObject({ type: 'final', stopReason: 'end' });
  });

  it('says so when there is no source', async () => {
    const events = await collect(new FakeLlmProvider().streamChat({ system: 'No sources.', messages: [] }));
    const text = events
      .filter((e) => e.type === 'text')
      .map((e) => (e as { text: string }).text)
      .join('');
    expect(text).toContain("couldn't find");
  });
});

describe('FakeEmbeddingProvider', () => {
  const cosine = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);

  it('returns normalized 1536-dim vectors where similar texts score higher', async () => {
    const [q, near, far] = await new FakeEmbeddingProvider().embed([
      'how to reset my password',
      'To reset your password open settings',
      'Invoices are sent monthly by email',
    ]);
    expect(q).toHaveLength(1536);
    expect(cosine(q, q)).toBeCloseTo(1, 5);
    expect(cosine(q, near)).toBeGreaterThan(cosine(q, far));
  });

  it('ignores function words, so an unrelated question stays below the relevance cutoff', async () => {
    const provider = new FakeEmbeddingProvider();
    const [q, doc] = await provider.embed([
      'What is the capital of Peru?',
      'To reset your password, open the Settings page. The link is valid for 30 minutes.',
    ]);
    expect(cosine(q, doc)).toBeLessThan(provider.minRelevance);
  });
});

describe('calculateCostUsd', () => {
  it('uses prices per million tokens', () => {
    expect(calculateCostUsd({ inputTokens: 1000, outputTokens: 500 }, { input: 4, output: 20 })).toBeCloseTo(0.014, 6);
  });
});

describe('config and provider selection', () => {
  it('defaults to the fake provider without keys', () => {
    expect(createLlmProvider(loadConfig(baseEnv)).name).toBe('fake');
  });

  it('fails fast when anthropic is selected without a key', () => {
    expect(() => loadConfig({ ...baseEnv, LLM_PROVIDER: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('builds the anthropic provider with a key', () => {
    const config = loadConfig({ ...baseEnv, LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key' });
    expect(createLlmProvider(config).name).toBe('anthropic');
    expect(config.ANTHROPIC_MODEL).toBe('claude-opus-5-5');
  });
});
