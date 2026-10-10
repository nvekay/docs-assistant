import { readCookie } from './anonymous-user';
import { buildRetrievalQuery, buildSystemPrompt, extractCitations, RetrievedChunk } from './prompt';

const source = (n: number, content = `Content of fragment ${n}.`): RetrievedChunk => ({
  chunkId: n * 10,
  documentId: `doc-${n}`,
  documentTitle: `Doc ${n}`,
  content,
  score: 0.81234,
});

describe('buildSystemPrompt', () => {
  it('numbers the sources so the model can cite them', () => {
    const prompt = buildSystemPrompt([source(1), source(2)]);
    expect(prompt).toContain('[1] Doc 1\nContent of fragment 1.');
    expect(prompt).toContain('[2] Doc 2\nContent of fragment 2.');
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
