export const CITATION_HREF_PREFIX = '#cite-';

/**
 * Turns the model's [n] and [1, 3] markers into Markdown links (#cite-n), so the Markdown
 * renderer can show them as clickable chips that open the source fragment.
 */
export function linkCitations(markdown: string): string {
  return markdown.replace(/\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g, (_, group: string) =>
    group
      .split(',')
      .map((n) => `[${n.trim()}](${CITATION_HREF_PREFIX}${n.trim()})`)
      .join(''),
  );
}

export function citationIndexFromHref(href: string | undefined): number | null {
  if (!href?.startsWith(CITATION_HREF_PREFIX)) return null;
  const n = Number(href.slice(CITATION_HREF_PREFIX.length));
  return Number.isInteger(n) ? n : null;
}
