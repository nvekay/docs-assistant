import { estimateTokens } from '../llm/fake.provider';

export interface TextChunk {
  ord: number;
  content: string;
  tokens: number;
}

export interface ChunkOptions {
  /** Target size of one chunk */
  maxTokens: number;
  /** Tail of the previous chunk repeated at the start of the next one, so answers spanning a boundary are not lost */
  overlapTokens: number;
}

const DEFAULTS: ChunkOptions = { maxTokens: 800, overlapTokens: 100 };

/**
 * Splits text into chunks along paragraph boundaries. Paragraphs longer than one chunk
 * are split by sentences, and sentences longer than one chunk by words as a last resort.
 */
export function chunkText(text: string, options: Partial<ChunkOptions> = {}): TextChunk[] {
  const { maxTokens, overlapTokens } = { ...DEFAULTS, ...options };
  const pieces = splitIntoPieces(normalize(text), maxTokens);

  const chunks: TextChunk[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  const flush = () => {
    const content = current.join('\n\n').trim();
    if (content) chunks.push({ ord: chunks.length, content, tokens: estimateTokens(content) });
  };

  for (const piece of pieces) {
    const pieceTokens = estimateTokens(piece);
    if (currentTokens + pieceTokens > maxTokens && current.length > 0) {
      flush();
      const overlap = tailWithin(current.join('\n\n'), overlapTokens);
      current = overlap ? [overlap] : [];
      currentTokens = overlap ? estimateTokens(overlap) : 0;
    }
    current.push(piece);
    currentTokens += pieceTokens;
  }
  flush();
  return chunks;
}

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Paragraphs, with oversized ones broken into sentence- or word-sized pieces */
function splitIntoPieces(text: string, maxTokens: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\n\n+/)) {
    if (estimateTokens(paragraph) <= maxTokens) {
      if (paragraph.trim()) out.push(paragraph.trim());
      continue;
    }
    for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
      if (estimateTokens(sentence) <= maxTokens) {
        out.push(sentence);
      } else {
        out.push(...splitByWords(sentence, maxTokens));
      }
    }
  }
  return out;
}

function splitByWords(text: string, maxTokens: number): string[] {
  const out: string[] = [];
  let buffer = '';
  for (const word of text.split(/\s+/)) {
    const next = buffer ? `${buffer} ${word}` : word;
    if (estimateTokens(next) > maxTokens && buffer) {
      out.push(buffer);
      buffer = word;
    } else {
      buffer = next;
    }
  }
  if (buffer) out.push(buffer);
  return out;
}

/** Last whole words of the text that fit into the token budget */
function tailWithin(text: string, tokens: number): string {
  if (tokens <= 0) return '';
  const words = text.split(/\s+/);
  const tail: string[] = [];
  for (let i = words.length - 1; i >= 0; i--) {
    const candidate = [words[i], ...tail].join(' ');
    if (estimateTokens(candidate) > tokens) break;
    tail.unshift(words[i]);
  }
  return tail.join(' ');
}
