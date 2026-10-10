import { FakeLlmProvider } from '../llm/fake.provider';
import { LlmProvider } from '../llm/llm.types';
import { readCookie } from './anonymous-user';
import { conversationTitle } from './chat.service';
import { buildRetrievalQuery, buildSystemPrompt, extractCitations, RetrievedChunk } from './prompt';
import { rewritePrompt, rewriteQuery } from './query-rewrite';
import { fuseRankings } from './rank-fusion';

const source = (n: number, content = `Doc ${n} › Section\n\nContent of fragment ${n}.`): RetrievedChunk => ({
  chunkId: n * 10,
  documentId: `doc-${n}`,
  documentTitle: `Doc ${n}`,
  content,
  score: 0.81234,
});

describe('buildSystemPrompt', () => {
  it('numbers the sources so the model can cite them', () => {
    const prompt = buildSystemPrompt([source(1), source(2)]);
    // Each chunk starts with its own "Title › Section" line, right after the number
    expect(prompt).toContain('[1] Doc 1 › Section\n\nContent of fragment 1.');
    expect(prompt).toContain('[2] Doc 2 › Section\n\nContent of fragment 2.');
    expect(prompt.indexOf('[1] Doc 1')).toBeLessThan(prompt.indexOf('[2] Doc 2'));
  });

  it('says explicitly when nothing matched, so the model declines instead of guessing', () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain('none matched this question');
    expect(prompt).not.toMatch(/\[1\]/);
  });
});

describe('extractCitations', () => {
  const sources = [source(1), source(2), source(3)];

  it('keeps only the sources the answer cites, in order', () => {
    const citations = extractCitations('Open Settings [3]. The link expires in 30 minutes [1].', sources);
    expect(citations.map((c) => c.index)).toEqual([1, 3]);
    expect(citations[1]).toMatchObject({ documentId: 'doc-3', chunkId: 30, documentTitle: 'Doc 3', score: 0.812 });
  });

  it('understands grouped markers and ignores duplicates', () => {
    expect(extractCitations('Yes [1, 2]. Also [2].', sources).map((c) => c.index)).toEqual([1, 2]);
  });

  it('drops numbers that do not match a source', () => {
    expect(extractCitations('See [0] and [7].', sources)).toEqual([]);
  });
});

describe('buildRetrievalQuery', () => {
  it('adds the previous question to a short follow-up', () => {
    expect(buildRetrievalQuery('and on mobile?', 'How do I reset my password?')).toBe(
      'How do I reset my password?\nand on mobile?',
    );
  });

  it('searches a full question on its own', () => {
    expect(buildRetrievalQuery('How do I download last month invoice?', 'How do I reset my password?')).toBe(
      'How do I download last month invoice?',
    );
  });
});

describe('readCookie', () => {
  it('finds a cookie among others', () => {
    expect(readCookie('a=1; da_uid=abc%20d; b=2', 'da_uid')).toBe('abc d');
    expect(readCookie('xda_uid=1', 'da_uid')).toBeUndefined();
    expect(readCookie(undefined, 'da_uid')).toBeUndefined();
  });
});

describe('fuseRankings', () => {
  it('ranks chunks found by both searches first and keeps the best cosine score', () => {
    const fullText = [source(1), source(2), { ...source(3), score: 0.1 }];
    const vector = [{ ...source(3), score: 0.5 }, source(4)];
    const fused = fuseRankings([fullText, vector], 3);
    // 3 is in both lists; 2 and 4 tie on rank, and the earlier one wins
    expect(fused.map((c) => c.chunkId)).toEqual([30, 10, 20]);
    expect(fused[0].score).toBe(0.5);
  });

  it('works when one search finds nothing', () => {
    expect(fuseRankings([[], [source(2), source(1)]], 8).map((c) => c.chunkId)).toEqual([20, 10]);
  });
});

describe('query rewriting', () => {
  const llmReplying = (text: string) =>
    ({
      name: 'stub',
      streamChat: jest.fn(),
      complete: jest.fn().mockResolvedValue({ text, usage: { inputTokens: 120, outputTokens: 15 }, model: 'stub' }),
    }) as unknown as LlmProvider;

  it('gives the model the conversation and the latest message as one prompt', () => {
    const prompt = rewritePrompt(
      [
        { role: 'user', content: 'How do I reset my password?' },
        { role: 'assistant', content: 'Use the Forgot password link.' },
      ],
      'а на телефоне?',
    );
    expect(prompt).toBe(
      'Conversation so far:\nUser: How do I reset my password?\nAssistant: Use the Forgot password link.\n\nLatest message: а на телефоне?',
    );
  });

  it('takes the first line of the reply, without quotes', async () => {
    const result = await rewriteQuery(llmReplying('"reset password mobile app"\nextra'), [], 'а на телефоне?');
    expect(result).toEqual({ query: 'reset password mobile app', usage: { inputTokens: 120, outputTokens: 15 } });
  });

  it('returns no query when the model replies with nothing, like the fake model', async () => {
    expect((await rewriteQuery(new FakeLlmProvider(), [], 'hello')).query).toBeNull();
  });
});

describe('conversationTitle', () => {
  it('uses the first question on one line, shortened to 80 characters', () => {
    expect(conversationTitle('How do I\n  reset my password?')).toBe('How do I reset my password?');
    const title = conversationTitle('word '.repeat(40));
    expect(title).toHaveLength(80);
    expect(title.endsWith('…')).toBe(true);
  });
});
