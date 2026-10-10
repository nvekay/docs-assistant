import { chunkDocument, chunkText } from './chunker';
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

describe('chunkDocument', () => {
  const guide = [
    '# Ledgerly: account and security',
    '',
    '## Reset your password',
    '',
    'Click "Forgot password?" on the sign-in page.',
    '',
    '## Two-factor authentication',
    '',
    'Turn it on in Settings > Security.',
  ].join('\n');

  it('makes one chunk per section, each starting with "Title › Section"', () => {
    const chunks = chunkDocument(guide, { title: 'Ledgerly: account and security' });
    expect(chunks.map((c) => c.content)).toEqual([
      'Ledgerly: account and security › Reset your password\n\nClick "Forgot password?" on the sign-in page.',
      'Ledgerly: account and security › Two-factor authentication\n\nTurn it on in Settings > Security.',
    ]);
    expect(chunks.map((c) => c.ord)).toEqual([0, 1]);
  });

  it('keeps text before the first heading and splits long sections', () => {
    const long = `Intro text.\n\n## Big section\n\n${'A sentence about invoices. '.repeat(120)}`;
    const chunks = chunkDocument(long, { title: 'Guide', maxTokens: 300 });
    expect(chunks[0].content).toBe('Guide\n\nIntro text.');
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks.slice(1)) {
      expect(chunk.content.startsWith('Guide › Big section\n\n')).toBe(true);
      expect(chunk.tokens).toBeLessThanOrEqual(300 + 10);
    }
  });

  it('treats text without headings (PDF, web pages) as one titled section', () => {
    expect(chunkDocument('Just a paragraph.', { title: 'Manual' }).map((c) => c.content)).toEqual([
      'Manual\n\nJust a paragraph.',
    ]);
  });
});
