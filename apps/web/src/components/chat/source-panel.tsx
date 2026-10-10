'use client';

import type { Citation } from '@docs-assistant/shared';

interface Props {
  citations: Citation[];
  activeIndex: number | null;
  onSelect: (index: number) => void;
  onClose: () => void;
}

/** Shows the exact fragment an answer relied on, so a user can check it */
export function SourcePanel({ citations, activeIndex, onSelect, onClose }: Props) {
  const active = citations.find((c) => c.index === activeIndex) ?? citations[0];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h2 className="text-sm font-semibold">Sources</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          Close
        </button>
      </div>

      {!active ? (
        <p className="p-4 text-sm text-slate-500">
          Click a numbered marker in an answer to see the documentation fragment it came from.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 px-4 pt-3">
            {citations.map((c) => (
              <button
                key={c.index}
                type="button"
                onClick={() => onSelect(c.index)}
                className={`rounded-md px-2 py-1 text-xs font-medium ${
                  c.index === active.index
                    ? 'bg-accent text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                [{c.index}] {c.documentTitle}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <p className="mb-2 text-xs text-slate-500">
              {active.documentTitle} · similarity {active.score.toFixed(2)}
            </p>
            <blockquote className="whitespace-pre-wrap rounded-lg border-l-4 border-accent bg-slate-50 p-3 text-sm leading-relaxed text-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {active.excerpt}
            </blockquote>
          </div>
        </>
      )}
    </div>
  );
}
