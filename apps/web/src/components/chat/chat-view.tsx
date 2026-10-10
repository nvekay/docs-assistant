'use client';

import type { ChatStreamEvent, Citation } from '@docs-assistant/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, API_BASE, ApiError, toApiError } from '@/lib/api';
import { readSseEvents } from '@/lib/sse';
import { AnswerMarkdown } from './answer-markdown';
import { SourcePanel } from './source-panel';

interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  usage?: { inputTokens: number; outputTokens: number; costUsd: number };
  error?: string;
  streaming?: boolean;
}

const CONVERSATION_KEY = 'docs-assistant:conversation';

const SUGGESTIONS = [
  'How do I reset my password?',
  'Can I export invoices to CSV?',
  'How does this assistant choose its sources?',
  'What happens when I reach the daily limit?',
];

// Storage can throw in private windows or with blocked site data; the chat still works without it
const storage = {
  get: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string | null) => {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
};

export function ChatView() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<{ messageId: string; index: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Restore the previous conversation after a reload; the cookie proves it is this visitor's
  useEffect(() => {
    const saved = storage.get(CONVERSATION_KEY);
    if (!saved) return;
    api
      .chatMessages(saved)
      .then((rows) => {
        setConversationId(saved);
        setMessages(rows.map((m) => ({ id: String(m.id), role: m.role, content: m.content, citations: m.citations })));
      })
      .catch(() => storage.set(CONVERSATION_KEY, null));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const patchMessage = (id: string, patch: (m: UiMessage) => Partial<UiMessage>) =>
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...patch(m) } : m)));

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || busy) return;

      const assistantId = crypto.randomUUID();
      setMessages((list) => [
        ...list,
        { id: crypto.randomUUID(), role: 'user', content: question, citations: [] },
        { id: assistantId, role: 'assistant', content: '', citations: [], streaming: true },
      ]);
      setInput('');
      setBusy(true);
      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const res = await fetch(`${API_BASE}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: question, conversationId: conversationId ?? undefined }),
          signal: abort.signal,
        });
        if (!res.ok || !res.body) throw await toApiError(res);

        for await (const event of readSseEvents<ChatStreamEvent>(res.body)) {
          switch (event.type) {
            case 'meta':
              setConversationId(event.conversationId);
              storage.set(CONVERSATION_KEY, event.conversationId);
              break;
            case 'delta':
              patchMessage(assistantId, (m) => ({ content: m.content + event.text }));
              break;
            case 'citations':
              patchMessage(assistantId, () => ({ citations: event.citations }));
              break;
            case 'done':
              patchMessage(assistantId, () => ({ usage: event.usage }));
              break;
            case 'error':
              patchMessage(assistantId, () => ({ error: event.message }));
              break;
          }
        }
      } catch (error) {
        const message =
          (error as Error).name === 'AbortError'
            ? 'Stopped.'
            : error instanceof ApiError
              ? error.message
              : 'Could not reach the assistant. Check your connection and try again.';
        patchMessage(assistantId, () => ({ error: message }));
      } finally {
        patchMessage(assistantId, () => ({ streaming: false }));
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, conversationId],
  );

  const newChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(null);
    setSelected(null);
    setPanelOpen(false);
    storage.set(CONVERSATION_KEY, null);
  };

  const openCitation = (messageId: string, index: number) => {
    setSelected({ messageId, index });
    setPanelOpen(true);
  };

  const selectedMessage = messages.find((m) => m.id === selected?.messageId);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 gap-0 lg:gap-6 lg:px-4">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-4 py-6 lg:px-0">
          {messages.length === 0 ? (
            <EmptyState onPick={send} />
          ) : (
            <ol className="mx-auto flex max-w-3xl flex-col gap-6">
              {messages.map((m) => (
                <li key={m.id} className={m.role === 'user' ? 'flex justify-end' : ''}>
                  {m.role === 'user' ? (
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-slate-100 px-4 py-2.5 text-[15px] dark:bg-slate-800">
                      {m.content}
                    </p>
                  ) : (
                    <AssistantMessage
                      message={m}
                      activeIndex={selected?.messageId === m.id ? selected.index : null}
                      onCite={(index) => openCitation(m.id, index)}
                    />
                  )}
                </li>
              ))}
            </ol>
          )}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950 lg:px-0"
        >
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="Ask about the documentation…"
              aria-label="Your question"
              className="max-h-40 min-h-11 flex-1 resize-none rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-slate-700 dark:bg-slate-900"
            />
            {busy ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="h-11 rounded-xl border border-slate-300 px-4 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="h-11 rounded-xl bg-accent px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40"
              >
                Send
              </button>
            )}
          </div>
          <div className="mx-auto mt-2 flex max-w-3xl justify-between text-xs text-slate-500">
            <span>Answers come only from the uploaded docs. Numbers in answers open the source.</span>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={newChat}
                className="shrink-0 pl-3 hover:text-slate-800 dark:hover:text-slate-200"
              >
                New chat
              </button>
            )}
          </div>
        </form>
      </section>

      {/* Sources: a side column on wide screens, a bottom sheet on phones */}
      {panelOpen && selectedMessage && (
        <aside className="fixed inset-x-0 bottom-0 z-30 h-[60dvh] rounded-t-2xl border-t border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950 lg:static lg:z-auto lg:h-auto lg:w-96 lg:shrink-0 lg:rounded-none lg:border-t-0 lg:border-l lg:shadow-none">
          <SourcePanel
            citations={selectedMessage.citations}
            activeIndex={selected?.index ?? null}
            onSelect={(index) => setSelected({ messageId: selectedMessage.id, index })}
            onClose={() => setPanelOpen(false)}
          />
        </aside>
      )}
    </div>
  );
}

function AssistantMessage({
  message,
  activeIndex,
  onCite,
}: {
  message: UiMessage;
  activeIndex: number | null;
  onCite: (index: number) => void;
}) {
  const available = new Set(message.citations.map((c) => c.index));
  return (
    <div className="flex gap-3">
      <span
        className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-accent text-xs font-semibold text-white"
        aria-hidden
      >
        AI
      </span>
      <div className="min-w-0 flex-1">
        {message.content ? (
          <AnswerMarkdown text={message.content} available={available} activeIndex={activeIndex} onCite={onCite} />
        ) : message.streaming ? (
          <p className="flex items-center gap-1 py-2" aria-label="Thinking">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-1.5 animate-pulse rounded-full bg-slate-400"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </p>
        ) : null}

        {message.error && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {message.error}
          </p>
        )}

        {message.citations.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {message.citations.map((c) => (
              <button
                key={c.index}
                type="button"
                onClick={() => onCite(c.index)}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:border-accent hover:text-accent dark:border-slate-700 dark:text-slate-400"
              >
                [{c.index}] {c.documentTitle}
              </button>
            ))}
          </div>
        )}

        {message.usage && (
          <p className="mt-2 text-xs text-slate-400">
            {message.usage.inputTokens + message.usage.outputTokens} tokens · ${message.usage.costUsd.toFixed(4)}
          </p>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center pt-10 text-center sm:pt-20">
      <h1 className="text-2xl font-semibold tracking-tight">Ask the docs</h1>
      <p className="mt-2 text-slate-600 dark:text-slate-400">
        The assistant answers from the indexed documentation and shows where each answer came from. If the docs don’t
        cover a question, it says so.
      </p>
      <div className="mt-8 grid w-full gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="rounded-xl border border-slate-200 px-4 py-3 text-left text-sm hover:border-accent hover:bg-accent-soft/40 dark:border-slate-800 dark:hover:bg-slate-900"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
