'use client';

import type { Citation } from '@docs-assistant/shared';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { citationIndexFromHref, linkCitations } from '@/lib/citations';

interface Props {
  text: string;
  /** Sources of this answer; [n] markers without a source render as plain text */
  citations: Citation[];
  activeIndex?: number | null;
  /** Adds a blinking cursor after the last word while the answer is still arriving */
  streaming?: boolean;
  onCite: (index: number) => void;
}

export function AnswerMarkdown({ text, citations, activeIndex, streaming, onCite }: Props) {
  const titles = new Map(citations.map((c) => [c.index, c.documentTitle]));
  return (
    <div className={`answer ${streaming ? 'streaming' : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            const index = citationIndexFromHref(href);
            if (index === null) {
              return (
                <a href={href} target="_blank" rel="noreferrer noopener">
                  {children}
                </a>
              );
            }
            const title = titles.get(index);
            // While streaming, citations arrive only at the end: show the marker without a link yet
            if (!title) return <span className="text-slate-400">[{index}]</span>;
            return (
              <button
                type="button"
                onClick={() => onCite(index)}
                title={title}
                aria-label={`Show source ${index}: ${title}`}
                className={`cite mx-0.5 inline-grid h-5 min-w-5 place-items-center rounded-md px-1 align-text-top text-[11px] font-semibold transition-colors ${
                  activeIndex === index
                    ? 'bg-accent text-white'
                    : 'bg-accent-soft text-accent hover:bg-accent hover:text-white dark:bg-slate-800 dark:text-indigo-300 dark:hover:bg-accent dark:hover:text-white'
                }`}
              >
                {index}
              </button>
            );
          },
        }}
      >
        {linkCitations(text)}
      </ReactMarkdown>
    </div>
  );
}
