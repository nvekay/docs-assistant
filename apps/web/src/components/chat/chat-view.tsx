'use client';

import type { ChatMessageDto, ChatStreamEvent, Citation } from '@docs-assistant/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, Copy, MessageSquarePlus, PanelLeft, RotateCcw, Square, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, API_BASE, ApiError, toApiError } from '@/lib/api';
import { readSseEvents } from '@/lib/sse';
import { AnswerMarkdown } from './answer-markdown';
import { CONVERSATIONS_KEY, ConversationList } from './conversation-list';
import { SourcePanel } from './source-panel';

interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  /** The question this answer belongs to, for "Try again" */
  question?: string;
  usage?: { inputTokens: number; outputTokens: number; costUsd: number };
  error?: string;
  streaming?: boolean;
  /** No response for a few seconds: probably the free API host waking up */
  slow?: boolean;
  truncated?: boolean;
}

/** Messages of a chat being written to right now; for other chats the server history is shown */
interface LiveChat {
  conversationId: string | null;
  messages: UiMessage[];
}

const LAST_CHAT_KEY = 'docs-assistant:conversation';
const MAX_QUESTION = 2000;
const SLOW_AFTER_MS = 4000;

const SUGGESTIONS = [
  'How do I reset my password?',
  'Can I export invoices to CSV?',
  'What plans are there and what do they cost?',
  'How does this assistant choose its sources?',
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

const NO_MESSAGES: UiMessage[] = [];

const toUiMessage = (m: ChatMessageDto): UiMessage => ({
  id: String(m.id),
  role: m.role,
  content: m.content,
  citations: m.citations,
});

export function ChatView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  /** The open chat lives in the URL (?c=…), so reload, back/forward and links work */
  const activeId = searchParams.get('c');

  const [live, setLive] = useState<LiveChat | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<{ messageId: string; index: number } | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const isLive = live !== null && live.conversationId === activeId;
  const history = useQuery({
    queryKey: ['messages', activeId],
    queryFn: () => api.chatMessages(activeId!),
    enabled: !!activeId && !isLive,
    staleTime: Infinity,
    retry: false,
  });
  const saved = useMemo(() => history.data?.map(toUiMessage) ?? [], [history.data]);
  const messages: UiMessage[] = isLive ? live.messages : activeId ? saved : NO_MESSAGES;
  const loadingHistory = !!activeId && !isLive && history.isPending;
  const historyFailed = !!activeId && !isLive && history.isError;
  // 404: deleted, or a link to another browser's chat (chats belong to the visitor cookie)
  const missingChat = historyFailed && history.error instanceof ApiError && history.error.status === 404;

  // Remember the open chat for the next visit
  useEffect(() => {
    if (activeId) storage.set(LAST_CHAT_KEY, activeId);
  }, [activeId]);

  // Reopen the last chat only on arrival at /chat without one; later "New chat" clicks must stay new
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const saved = activeId ? null : storage.get(LAST_CHAT_KEY);
    if (saved) router.replace(`/chat?c=${saved}`, { scroll: false });
  }, [activeId, router]);

  // A chat that no longer exists (deleted, or another browser's link) must not be reopened
  useEffect(() => {
    if (missingChat && storage.get(LAST_CHAT_KEY) === activeId) storage.set(LAST_CHAT_KEY, null);
  }, [missingChat, activeId]);

  // Follow new text only while the reader is at the bottom; switching chats jumps to the end
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  useLayoutEffect(() => {
    atBottomRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeId, history.data]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = atBottom;
    setShowJump(!atBottom);
  };

  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  const patchMessage = (id: string, patch: (m: UiMessage) => Partial<UiMessage>) =>
    setLive((current) =>
      current
        ? { ...current, messages: current.messages.map((m) => (m.id === id ? { ...m, ...patch(m) } : m)) }
        : current,
    );

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || busy) return;

      const assistantId = crypto.randomUUID();
      const userMessage: UiMessage = { id: crypto.randomUUID(), role: 'user', content: question, citations: [] };
      const pending: UiMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        citations: [],
        question,
        streaming: true,
      };
      setLive({ conversationId: activeId, messages: [...messages, userMessage, pending] });
      setBusy(true);
      setSelected(null);
      atBottomRef.current = true;

      const abort = new AbortController();
      abortRef.current = abort;
      let responded = false;
      const slowTimer = setTimeout(
        () => !responded && patchMessage(assistantId, () => ({ slow: true })),
        SLOW_AFTER_MS,
      );
      const responding = () => {
        if (responded) return;
        responded = true;
        clearTimeout(slowTimer);
        patchMessage(assistantId, () => ({ slow: false }));
      };
      let conversationId = activeId;

      try {
        const res = await fetch(`${API_BASE}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: question, conversationId: activeId ?? undefined }),
          signal: abort.signal,
        });
        responding();
        if (!res.ok || !res.body) throw await toApiError(res);

        for await (const event of readSseEvents<ChatStreamEvent>(res.body)) {
          switch (event.type) {
            case 'meta':
              conversationId = event.conversationId;
              if (event.conversationId !== activeId) {
                setLive((current) => (current ? { ...current, conversationId: event.conversationId } : current));
                router.replace(`/chat?c=${event.conversationId}`, { scroll: false });
              }
              void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
              break;
            case 'delta':
              patchMessage(assistantId, (m) => ({ content: m.content + event.text }));
              break;
            case 'citations':
              patchMessage(assistantId, () => ({ citations: event.citations }));
              break;
            case 'done':
              patchMessage(assistantId, () => ({ usage: event.usage, truncated: event.stopReason === 'max_tokens' }));
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
        clearTimeout(slowTimer);
        patchMessage(assistantId, () => ({ streaming: false, slow: false }));
        setBusy(false);
        abortRef.current = null;
        // Next time this chat is opened from the list, load the saved version
        if (conversationId) void queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
      }
    },
    [busy, activeId, messages, queryClient, router],
  );

  const stopStreaming = () => abortRef.current?.abort();

  const openChat = (id: string | null) => {
    stopStreaming();
    setLive(null);
    setSelected(null);
    setListOpen(false);
    if (!id) storage.set(LAST_CHAT_KEY, null);
    if (id !== activeId) router.push(id ? `/chat?c=${id}` : '/chat', { scroll: false });
  };

  const onDeleted = (id: string) => {
    queryClient.removeQueries({ queryKey: ['messages', id] });
    if (id === activeId) openChat(null);
  };

  const selectedMessage = messages.find((m) => m.id === selected?.messageId);
  const closeSources = useCallback(() => setSelected(null), []);

  const list = (
    <ConversationList activeId={activeId} onSelect={openChat} onNew={() => openChat(null)} onDeleted={onDeleted} />
  );

  return (
    <div className="flex min-h-0 w-full flex-1">
      {/* Chat list: a column on wide screens, a drawer on phones */}
      <aside
        aria-label="Chat list"
        className="hidden w-64 shrink-0 border-r border-slate-200 bg-slate-50/60 lg:block dark:border-slate-800 dark:bg-slate-950"
      >
        {list}
      </aside>
      {listOpen && <Drawer onClose={() => setListOpen(false)}>{list}</Drawer>}

      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1 border-b border-slate-200 px-2 py-1.5 lg:hidden dark:border-slate-800">
          <Button variant="ghost" size="sm" onClick={() => setListOpen(true)}>
            <PanelLeft className="size-4" aria-hidden />
            Chats
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="icon" onClick={() => openChat(null)} aria-label="New chat">
            <MessageSquarePlus className="size-4" aria-hidden />
          </Button>
        </div>

        <div ref={scrollRef} onScroll={onScroll} className="scroll-thin flex-1 overflow-y-auto px-4 py-6">
          {loadingHistory ? (
            <HistorySkeleton />
          ) : missingChat ? (
            <div className="mx-auto max-w-md pt-16 text-center">
              <p className="font-medium">This chat isn’t available</p>
              <p className="mt-1 text-sm text-slate-500">It may have been deleted, or it belongs to another browser.</p>
              <Button variant="primary" className="mt-5" onClick={() => openChat(null)}>
                Start a new chat
              </Button>
            </div>
          ) : historyFailed ? (
            <div className="mx-auto max-w-md pt-16 text-center">
              <p className="font-medium">Couldn’t load this chat</p>
              <p className="mt-1 text-sm text-slate-500">Check your connection; the server may also be waking up.</p>
              <Button className="mt-5" loading={history.isFetching} onClick={() => void history.refetch()}>
                <RotateCcw className="size-4" aria-hidden />
                Try again
              </Button>
            </div>
          ) : messages.length === 0 ? (
            <EmptyState onPick={send} />
          ) : (
            <ol className="mx-auto flex max-w-3xl flex-col gap-6">
              {messages.map((m) => (
                <li key={m.id} className={`animate-fade-in ${m.role === 'user' ? 'flex justify-end' : ''}`}>
                  {m.role === 'user' ? (
                    <p className="max-w-[85%] rounded-2xl rounded-br-md bg-slate-100 px-4 py-2.5 text-[15px] whitespace-pre-wrap dark:bg-slate-800">
                      {m.content}
                    </p>
                  ) : (
                    <AssistantMessage
                      message={m}
                      activeIndex={selected?.messageId === m.id ? selected.index : null}
                      onCite={(index) => setSelected({ messageId: m.id, index })}
                      onRetry={busy || !m.question ? undefined : () => void send(m.question!)}
                    />
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        {showJump && messages.length > 0 && (
          <button
            type="button"
            onClick={jumpToBottom}
            aria-label="Scroll to the latest message"
            className="animate-fade-in absolute bottom-28 left-1/2 -translate-x-1/2 rounded-full border border-slate-200 bg-white p-2 text-slate-600 shadow-md transition-colors hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <ArrowDown className="size-4" aria-hidden />
          </button>
        )}

        <Composer busy={busy} onSend={send} onStop={stopStreaming} />
      </section>

      {/* Sources: a side column on wide screens, a bottom sheet on phones */}
      {selectedMessage && (
        <aside
          aria-label="Sources"
          className="animate-fade-in fixed inset-x-0 bottom-0 z-30 h-[60dvh] rounded-t-2xl border-t border-slate-200 bg-white shadow-2xl lg:static lg:z-auto lg:h-auto lg:w-96 lg:shrink-0 lg:animate-none lg:rounded-none lg:border-t-0 lg:border-l lg:shadow-none dark:border-slate-800 dark:bg-slate-950"
        >
          <SourcePanel
            citations={selectedMessage.citations}
            activeIndex={selected?.index ?? null}
            onSelect={(index) => setSelected({ messageId: selectedMessage.id, index })}
            onClose={closeSources}
          />
        </aside>
      )}
    </div>
  );
}

function Composer({ busy, onSend, onStop }: { busy: boolean; onSend: (text: string) => void; onStop: () => void }) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow with the text up to ~8 lines, then scroll
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const submit = () => {
    if (!input.trim() || busy) return;
    onSend(input);
    setInput('');
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="border-t border-slate-200 bg-white px-4 pt-3 pb-3 dark:border-slate-800 dark:bg-slate-950"
    >
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-slate-300 bg-white p-1.5 pl-3.5 shadow-sm transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 dark:border-slate-700 dark:bg-slate-900">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          maxLength={MAX_QUESTION}
          placeholder="Ask about the documentation…"
          aria-label="Your question"
          className="scroll-thin max-h-[200px] min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[15px] outline-none placeholder:text-slate-400"
        />
        {busy ? (
          <Button variant="secondary" size="icon" className="size-9 rounded-xl" onClick={onStop} aria-label="Stop">
            <Square className="size-3.5 fill-current" aria-hidden />
          </Button>
        ) : (
          <Button
            type="submit"
            variant="primary"
            size="icon"
            className="size-9 rounded-xl"
            disabled={!input.trim()}
            aria-label="Send"
          >
            <ArrowUp className="size-4" aria-hidden />
          </Button>
        )}
      </div>
      <div className="mx-auto mt-1.5 flex max-w-3xl justify-between gap-3 px-1 text-xs text-slate-500">
        <span>Answers come only from the uploaded docs. Numbers in answers open the source.</span>
        {input.length > MAX_QUESTION * 0.8 ? (
          <span className={`shrink-0 tabular-nums ${input.length >= MAX_QUESTION ? 'text-red-600' : ''}`}>
            {input.length}/{MAX_QUESTION}
          </span>
        ) : (
          <span className="hidden shrink-0 sm:inline">Enter to send · Shift + Enter for a new line</span>
        )}
      </div>
    </form>
  );
}

function AssistantMessage({
  message,
  activeIndex,
  onCite,
  onRetry,
}: {
  message: UiMessage;
  activeIndex: number | null;
  onCite: (index: number) => void;
  onRetry?: () => void;
}) {
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
          <AnswerMarkdown
            text={message.content}
            citations={message.citations}
            activeIndex={activeIndex}
            streaming={message.streaming}
            onCite={onCite}
          />
        ) : message.streaming ? (
          <div className="py-2" aria-live="polite">
            <p className="flex items-center gap-1" aria-label="Thinking">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-1.5 animate-pulse rounded-full bg-slate-400"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </p>
            {message.slow && (
              <p className="animate-fade-in mt-2 text-sm text-slate-500">
                Waking up the server. On free hosting the first request after a pause can take up to a minute.
              </p>
            )}
          </div>
        ) : null}

        {message.truncated && (
          <p className="mt-2 text-sm text-slate-500">The answer reached the length limit and was cut off.</p>
        )}

        {message.error && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <span className="flex-1">{message.error}</span>
            {onRetry && (
              <Button size="sm" variant="ghost" onClick={onRetry} className="text-amber-900 dark:text-amber-200">
                <RotateCcw className="size-3.5" aria-hidden />
                Try again
              </Button>
            )}
          </div>
        )}

        {message.citations.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {message.citations.map((c) => (
              <button
                key={c.index}
                type="button"
                onClick={() => onCite(c.index)}
                title={c.documentTitle}
                className={`max-w-full truncate rounded-md border px-2 py-1 text-xs transition-colors ${
                  activeIndex === c.index
                    ? 'border-accent bg-accent-soft text-accent dark:bg-slate-800 dark:text-indigo-300'
                    : 'border-slate-200 text-slate-600 hover:border-accent hover:text-accent dark:border-slate-700 dark:text-slate-400 dark:hover:text-indigo-300'
                }`}
              >
                [{c.index}] {c.documentTitle}
              </button>
            ))}
          </div>
        )}

        {!message.streaming && message.content && (
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
            <CopyButton text={message.content} />
            {message.usage && (
              <span>
                {message.usage.inputTokens + message.usage.outputTokens} tokens · ${message.usage.costUsd.toFixed(4)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="-ml-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
    >
      {copied ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function Drawer({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Chats">
      <button type="button" aria-label="Close chats" onClick={onClose} className="absolute inset-0 bg-slate-950/40" />
      <div className="animate-slide-in relative flex h-full w-72 max-w-[85vw] flex-col bg-white shadow-xl dark:bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-200 py-1.5 pr-2 pl-4 dark:border-slate-800">
          <span className="text-sm font-semibold">Chats</span>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close chats">
            <X className="size-4" aria-hidden />
          </Button>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

function HistorySkeleton() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6" aria-label="Loading chat">
      <Skeleton className="ml-auto h-10 w-2/5 rounded-2xl" />
      <div className="flex gap-3">
        <Skeleton className="size-7 shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-2/3" />
        </div>
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
            className="group rounded-xl border border-slate-200 px-4 py-3 text-left text-sm transition hover:-translate-y-px hover:border-accent hover:bg-accent-soft/40 hover:shadow-sm active:translate-y-0 dark:border-slate-800 dark:hover:bg-slate-900"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
