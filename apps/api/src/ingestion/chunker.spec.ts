import { chunkText } from './chunker';
import { extractHtml, extractMarkdown } from './extract';

describe('chunkText', () => {
  it('keeps a short text as one chunk', () => {
    const chunks = chunkText('Hello world.\n\nSecond paragraph.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ ord: 0, content: 'Hello world.\n\nSecond paragraph.' });
  });

  it('splits long text into ordered chunks within the token budget', () => {
    const paragraph = 'word '.repeat(150).trim(); // ~190 tokens
    const text = Array.from({ length: 10 }, () => paragraph).join('\n\n');
    const chunks = chunkText(text, { maxTokens: 400, overlapTokens: 50 });

    expect(chunks.length).toBeGreaterThan(3);
    chunks.forEach((c, i) => {
      expect(c.ord).toBe(i);
      expect(c.tokens).toBeLessThanOrEqual(400 + 50);
    });
  });

  it('repeats the tail of the previous chunk at the start of the next', () => {
    const text = ['alpha '.repeat(100), 'beta '.repeat(100), 'gamma '.repeat(100)].map((s) => s.trim()).join('\n\n');
    const chunks = chunkText(text, { maxTokens: 200, overlapTokens: 20 });
    expect(chunks[1].content.startsWith('alpha')).toBe(true);
  });

  it('splits a single huge paragraph without losing words', () => {
    const text = Array.from({ length: 2000 }, (_, i) => `w${i}`).join(' ');
    const chunks = chunkText(text, { maxTokens: 300, overlapTokens: 0 });
    const words = chunks.flatMap((c) => c.content.split(/\s+/));
    expect(new Set(words).size).toBe(2000);
  });

  it('returns nothing for blank input', () => {
    expect(chunkText('   \n\n  ')).toEqual([]);
  });
});

describe('extractors', () => {
  it('takes the markdown title from the first heading', () => {
    const doc = extractMarkdown(Buffer.from('# Getting started\n\nInstall the app.'));
    expect(doc.title).toBe('Getting started');
  });

  it('keeps main content of an HTML page and drops navigation and scripts', () => {
    const html = `<html><head><title>Docs</title><script>track()</script></head>
      <body><nav>Home | Pricing</nav><main><h1>Reset password</h1><p>Open settings.</p><p>Click reset.</p></main>
      <footer>© 2026</footer></body></html>`;
    const doc = extractHtml(html);
    expect(doc.title).toBe('Docs');
    expect(doc.text).toContain('Reset password');
    expect(doc.text).toContain('Open settings.\n\nClick reset.');
    expect(doc.text).not.toMatch(/Pricing|track|2026/);
  });
});
