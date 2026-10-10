'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { citationIndexFromHref, linkCitations } from '@/lib/citations';

interface Props {
  text: string;
  /** Source numbers that exist for this answer; other [n] markers render as plain text */
  available: Set<number>;
  activeIndex?: number | null;
  onCite: (index: number) => void;
}

export function AnswerMarkdown({ text, available, activeIndex, onCite }: Props) {
  return (
    <div className="answer">
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
            if (!available.has(index)) return <span className="text-slate-400">[{index}]</span>;
            return (
              <button
                type="button"
                onClick={() => onCite(index)}
                aria-label={`Show source ${index}`}
                className={`cite mx-0.5 inline-grid h-5 min-w-5 place-items-center rounded-md px-1 align-text-top text-[11px] font-semibold transition-colors ${
                  activeIndex === index
                    ? 'bg-accent text-white'
                    : 'bg-accent-soft text-accent hover:bg-accent hover:text-white dark:bg-slate-800 dark:text-indigo-300'
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
