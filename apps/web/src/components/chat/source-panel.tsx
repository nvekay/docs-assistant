'use client';

import type { Citation } from '@docs-assistant/shared';
import { FileText, X } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  citations: Citation[];
  activeIndex: number | null;
  onSelect: (index: number) => void;
  onClose: () => void;
}

/** Fragments start with a "Title › Section" line; it is shown as a heading, the rest as the quote */
function splitExcerpt(citation: Citation): { section: string | null; body: string } {
  const [first, ...rest] = citation.excerpt.split('\n\n');
  return first.startsWith(citation.documentTitle) && rest.length
    ? { section: first, body: rest.join('\n\n') }
    : { section: null, body: citation.excerpt };
}

/** Shows the exact fragment an answer relied on, so a user can check it */
export function SourcePanel({ citations, activeIndex, onSelect, onClose }: Props) {
  const active = citations.find((c) => c.index === activeIndex) ?? citations[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const excerpt = active ? splitExcerpt(active) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
        <h2 className="text-sm font-semibold">Sources</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close sources">
          <X className="size-4" aria-hidden />
        </Button>
      </div>

      {!active || !excerpt ? (
        <p className="p-4 text-sm text-slate-500">
          Click a numbered marker in an answer to see the documentation fragment it came from.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 px-4 pt-3" role="tablist" aria-label="Cited fragments">
            {citations.map((c) => (
              <button
                key={c.index}
                type="button"
                role="tab"
                aria-selected={c.index === active.index}
                onClick={() => onSelect(c.index)}
                className={`max-w-full truncate rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                  c.index === active.index
                    ? 'bg-accent text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                [{c.index}] {c.documentTitle}
              </button>
            ))}
          </div>
          <div key={active.index} className="animate-fade-in scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <p className="mb-2 flex items-start gap-1.5 text-xs text-slate-500">
              <FileText className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>
                {excerpt.section ?? active.documentTitle}
                <span className="text-slate-400"> · similarity {active.score.toFixed(2)}</span>
              </span>
            </p>
            <blockquote className="rounded-lg border-l-4 border-accent bg-slate-50 p-3 text-sm leading-relaxed whitespace-pre-wrap text-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {excerpt.body}
            </blockquote>
          </div>
        </>
      )}
    </div>
  );
}
