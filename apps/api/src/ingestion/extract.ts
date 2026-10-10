import * as cheerio from 'cheerio';
import { PDFParse } from 'pdf-parse';

export interface ExtractedDocument {
  title: string | null;
  text: string;
}

export async function extractPdf(data: Buffer): Promise<ExtractedDocument> {
  const parser = new PDFParse({ data: new Uint8Array(data) });
  try {
    const result = await parser.getText();
    return { title: null, text: result.text };
  } finally {
    await parser.destroy();
  }
}

export function extractMarkdown(data: Buffer): ExtractedDocument {
  const text = data.toString('utf8');
  const heading = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? null;
  return { title: heading, text };
}

/** Main readable text of an HTML page: navigation, scripts and footers are dropped */
export function extractHtml(html: string): ExtractedDocument {
  const $ = cheerio.load(html);
  $('script, style, noscript, nav, header, footer, aside, form, iframe, svg').remove();

  const title = $('title').first().text().trim() || $('h1').first().text().trim() || null;
  const root = $('main').length ? $('main') : $('article').length ? $('article') : $('body');

  // Keep paragraph breaks so the chunker can split on them
  root.find('h1, h2, h3, h4, p, li, pre, tr').each((_, el) => {
    $(el).append('\n\n');
  });
  const text = root
    .text()
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title, text };
}

export async function fetchUrl(url: string, signal?: AbortSignal): Promise<ExtractedDocument> {
  const response = await fetch(url, {
    signal,
    headers: { 'User-Agent': 'docs-assistant/0.1 (+https://github.com)' },
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`Fetching ${url} failed with HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/pdf')) {
    return extractPdf(Buffer.from(await response.arrayBuffer()));
  }
  const body = await response.text();
  return contentType.includes('text/html') ? extractHtml(body) : { title: null, text: body };
}
