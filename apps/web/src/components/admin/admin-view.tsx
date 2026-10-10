'use client';

import type { DocumentDto, DocumentStatus, LoginResponse } from '@docs-assistant/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, ApiError } from '@/lib/api';

const SESSION_KEY = 'docs-assistant:admin-session';

// The public read-only demo account, shown on the sign-in page when configured
const DEMO_EMAIL = process.env.NEXT_PUBLIC_DEMO_VIEWER_EMAIL;
const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_VIEWER_PASSWORD;

/**
 * The admin session as a tiny external store: kept in memory, mirrored to sessionStorage so it
 * survives reloads of this tab. Storage may be blocked (private mode), then memory alone is used.
 */
const sessionStore = (() => {
  let current: LoginResponse | null | undefined;
  const listeners = new Set<() => void>();
  return {
    get: (): LoginResponse | null => {
      if (current === undefined) {
        try {
          const raw = sessionStorage.getItem(SESSION_KEY);
          current = raw ? (JSON.parse(raw) as LoginResponse) : null;
        } catch {
          current = null;
        }
      }
      return current;
    },
    set: (session: LoginResponse | null) => {
      current = session;
      try {
        if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
        else sessionStorage.removeItem(SESSION_KEY);
      } catch {
        /* memory only */
      }
      listeners.forEach((notify) => notify());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
})();

const noopSubscribe = () => () => {};

export function AdminView() {
  // On the server there is no session; rendering nothing until hydration avoids flashing the login form
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const session = useSyncExternalStore(sessionStore.subscribe, sessionStore.get, () => null);
  const signOut = useCallback(() => sessionStore.set(null), []);

  if (!hydrated) return null;
  if (!session) return <LoginForm onLogin={sessionStore.set} />;

  const token = session.accessToken;
  const readOnly = session.role === 'viewer';

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge base</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Documents are split into chunks and embedded by a background worker. Only ready documents are searched.
          </p>
        </div>
        <button
          type="button"
          onClick={signOut}
          className="shrink-0 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
        >
          Sign out
        </button>
      </div>
      {readOnly ? (
        <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          You are using the read-only demo account: you can see documents and usage, but uploading, reindexing and
          deleting are turned off.
        </p>
      ) : (
        <AddDocument token={token} onUnauthorized={signOut} />
      )}
      <DocumentsTable token={token} readOnly={readOnly} onUnauthorized={signOut} />
      <UsageTable token={token} onUnauthorized={signOut} />
    </div>
  );
}

function LoginForm({ onLogin }: { onLogin: (session: LoginResponse) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      api.login(credentials.email, credentials.password),
    onSuccess: onLogin,
  });

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Admin sign in</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Manage the documents the assistant answers from.
      </p>
      {DEMO_EMAIL && DEMO_PASSWORD && (
        <button
          type="button"
          disabled={login.isPending}
          onClick={() => login.mutate({ email: DEMO_EMAIL, password: DEMO_PASSWORD })}
          className="mt-6 w-full rounded-lg border border-accent px-4 py-2.5 text-sm font-medium text-accent hover:bg-accent-soft/50 disabled:opacity-50 dark:hover:bg-slate-900"
        >
          View as demo user (read-only)
        </button>
      )}
      <form
        className="mt-6 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate({ email, password });
        }}
      >
        <Field label="Email">
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </Field>
        {login.error && <ErrorText error={login.error} />}
        <button type="submit" disabled={login.isPending} className={primaryButton}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

function AddDocument({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'file' | 'url'>('file');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const add = useMutation({
    mutationFn: async () => {
      if (mode === 'url') return api.addUrl(token, url, title || undefined);
      const file = fileRef.current?.files?.[0];
      if (!file) throw new ApiError(400, 'Choose a file first');
      return api.uploadDocument(token, file, title || undefined);
    },
    onSuccess: () => {
      setUrl('');
      setTitle('');
      if (fileRef.current) fileRef.current.value = '';
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) onUnauthorized();
    },
  });

  return (
    <section className="mt-6 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <div className="flex gap-1 text-sm" role="tablist">
        {(['file', 'url'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1.5 ${mode === m ? 'bg-slate-100 font-medium dark:bg-slate-800' : 'text-slate-500'}`}
          >
            {m === 'file' ? 'Upload file' : 'Add web page'}
          </button>
        ))}
      </div>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        {mode === 'file' ? (
          <Field key="file" label="File (.md, .txt or .pdf, up to 10 MB)">
            <input
              ref={fileRef}
              type="file"
              required
              accept=".md,.markdown,.txt,.pdf"
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm dark:file:bg-slate-800 dark:file:text-slate-200"
            />
          </Field>
        ) : (
          <Field key="url" label="Page URL">
            <input
              type="url"
              required
              placeholder="https://docs.example.com/page"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className={inputClass}
            />
          </Field>
        )}
        <Field label="Title (optional)">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={inputClass} />
        </Field>
        <button type="submit" disabled={add.isPending} className={primaryButton}>
          {add.isPending ? 'Adding…' : 'Add'}
        </button>
      </form>
      {add.error && <ErrorText error={add.error} />}
    </section>
  );
}

const STATUS_STYLES: Record<DocumentStatus, string> = {
  queued: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  processing: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
  ready: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  failed: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300',
};

function DocumentsTable({
  token,
  readOnly,
  onUnauthorized,
}: {
  token: string;
  readOnly: boolean;
  onUnauthorized: () => void;
}) {
  const queryClient = useQueryClient();
  const documents = useQuery({
    queryKey: ['documents'],
    queryFn: () => api.documents(token),
    // Poll only while something is still being indexed
    refetchInterval: (query) =>
      query.state.data?.some((d) => d.status === 'queued' || d.status === 'processing') ? 2000 : false,
  });
  const action = useMutation({
    mutationFn: async ({ id, kind }: { id: string; kind: 'reindex' | 'delete' }) => {
      if (kind === 'reindex') await api.reindex(token, id);
      else await api.deleteDocument(token, id);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  });

  useEffect(() => {
    if (documents.error instanceof ApiError && documents.error.status === 401) onUnauthorized();
  }, [documents.error, onUnauthorized]);

  const remove = (doc: DocumentDto) => {
    if (window.confirm(`Delete “${doc.title}” and its ${doc.chunkCount} chunks?`))
      action.mutate({ id: doc.id, kind: 'delete' });
  };

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">Documents</h2>
      {documents.isPending ? (
        <p className="mt-3 text-sm text-slate-500">Loading…</p>
      ) : documents.error ? (
        <ErrorText error={documents.error} />
      ) : documents.data.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No documents yet. Upload a file or add a web page above.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900">
              <tr>
                <th className="px-4 py-2.5 font-medium">Title</th>
                <th className="px-4 py-2.5 font-medium">Source</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">Chunks</th>
                <th className="px-4 py-2.5 font-medium">Added</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {documents.data.map((doc) => (
                <tr key={doc.id}>
                  <td className="max-w-64 truncate px-4 py-2.5 font-medium" title={doc.title}>
                    {doc.title}
                  </td>
                  <td className="max-w-48 truncate px-4 py-2.5 text-slate-500" title={doc.sourceRef ?? ''}>
                    <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] uppercase dark:bg-slate-800">
                      {doc.sourceType}
                    </span>
                    {doc.sourceRef}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[doc.status]}`}
                      title={doc.error ?? undefined}
                    >
                      {doc.status}
                    </span>
                    {doc.error && (
                      <p className="mt-1 max-w-56 truncate text-xs text-red-600 dark:text-red-400">{doc.error}</p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{doc.chunkCount}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">
                    {new Date(doc.createdAt).toLocaleDateString()}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    {!readOnly && (
                      <>
                        <button
                          type="button"
                          onClick={() => action.mutate({ id: doc.id, kind: 'reindex' })}
                          className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                        >
                          Reindex
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(doc)}
                          className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {action.error && <ErrorText error={action.error} />}
    </section>
  );
}

function UsageTable({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const usage = useQuery({ queryKey: ['usage'], queryFn: () => api.usage(token, 14), refetchInterval: 30_000 });

  useEffect(() => {
    if (usage.error instanceof ApiError && usage.error.status === 401) onUnauthorized();
  }, [usage.error, onUnauthorized]);

  const totals = usage.data?.reduce(
    (t, d) => ({
      requests: t.requests + d.requests,
      tokens: t.tokens + d.inputTokens + d.outputTokens,
      cost: t.cost + d.costUsd,
    }),
    { requests: 0, tokens: 0, cost: 0 },
  );

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Usage, last 14 days</h2>
      {totals && (
        <dl className="mt-3 grid grid-cols-3 gap-3 sm:max-w-xl">
          <Stat label="Questions" value={totals.requests.toLocaleString()} />
          <Stat label="Tokens" value={totals.tokens.toLocaleString()} />
          <Stat label="Cost" value={`$${totals.cost.toFixed(4)}`} />
        </dl>
      )}
      {usage.isPending ? (
        <p className="mt-3 text-sm text-slate-500">Loading…</p>
      ) : usage.error ? (
        <ErrorText error={usage.error} />
      ) : usage.data.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No questions asked yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Day (UTC)</th>
                <th className="px-4 py-2.5 text-right font-medium">Questions</th>
                <th className="px-4 py-2.5 text-right font-medium">Users</th>
                <th className="px-4 py-2.5 text-right font-medium">Input tokens</th>
                <th className="px-4 py-2.5 text-right font-medium">Output tokens</th>
                <th className="px-4 py-2.5 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 tabular-nums dark:divide-slate-800">
              {usage.data.map((d) => (
                <tr key={d.day}>
                  <td className="px-4 py-2.5">{d.day}</td>
                  <td className="px-4 py-2.5 text-right">{d.requests}</td>
                  <td className="px-4 py-2.5 text-right">{d.users}</td>
                  <td className="px-4 py-2.5 text-right">{d.inputTokens.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right">{d.outputTokens.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right">${d.costUsd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-slate-700 dark:bg-slate-900';
const primaryButton = 'h-10 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-50';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-slate-600 dark:text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-800">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function ErrorText({ error }: { error: Error }) {
  return <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error.message}</p>;
}
