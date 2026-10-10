'use client';

import type { DocumentDto, DocumentStatus, LoginResponse } from '@docs-assistant/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, Clock, FileText, Globe, LogOut, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

const SESSION_KEY = 'docs-assistant:admin-session';
const ACCEPTED = ['.md', '.markdown', '.txt', '.pdf'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

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
            Documents are split into sections and indexed by a background worker. Every chat searches all ready
            documents.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={signOut}>
          <LogOut className="size-3.5" aria-hidden />
          Sign out
        </Button>
      </div>
      {readOnly ? (
        <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          You are using the read-only demo account: you can see documents and usage, but uploading, reindexing and
          deleting are turned off.
        </p>
      ) : (
        <AddDocuments token={token} onUnauthorized={signOut} />
      )}
      <DocumentsTable token={token} readOnly={readOnly} onUnauthorized={signOut} />
      <UsageTable token={token} onUnauthorized={signOut} />
    </div>
  );
}

/** Shown under a long-running request: the free API host can take up to a minute to wake up */
function SlowHint({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 4000);
    return () => clearTimeout(timer);
  }, []);
  return visible ? <p className="animate-fade-in text-sm text-slate-500">{children}</p> : null;
}

function LoginForm({ onLogin }: { onLogin: (session: LoginResponse) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: (credentials: { email: string; password: string; demo?: boolean }) =>
      api.login(credentials.email, credentials.password),
    onSuccess: onLogin,
  });
  const demoPending = login.isPending && login.variables?.demo;

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Admin sign in</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Manage the documents the assistant answers from.
      </p>
      {DEMO_EMAIL && DEMO_PASSWORD && (
        <Button
          className="mt-6 w-full border-accent text-accent hover:border-accent hover:bg-accent-soft/60 dark:text-indigo-300"
          loading={demoPending}
          disabled={login.isPending}
          onClick={() => login.mutate({ email: DEMO_EMAIL, password: DEMO_PASSWORD, demo: true })}
        >
          View as demo user (read-only)
        </Button>
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
        <Button type="submit" variant="primary" loading={login.isPending && !demoPending} disabled={login.isPending}>
          {login.isPending && !demoPending ? 'Signing in…' : 'Sign in'}
        </Button>
        {login.isPending && (
          <SlowHint>The first sign-in after a pause can take up to a minute while the server wakes up.</SlowHint>
        )}
      </form>
    </div>
  );
}

type UploadState = 'waiting' | 'uploading' | 'done' | 'error';
interface QueuedFile {
  file: File;
  state: UploadState;
  error?: string;
}

function validateFile(file: File): string | null {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!ACCEPTED.includes(ext)) return 'Not .md, .txt or .pdf';
  if (file.size > MAX_FILE_BYTES) return 'Larger than 10 MB';
  return null;
}

function AddDocuments({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<'file' | 'url'>('file');
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const incoming = [...list].map((file): QueuedFile => {
      const error = validateFile(file);
      return error ? { file, state: 'error', error } : { file, state: 'waiting' };
    });
    // Picking more files replaces the finished ones, keeps the ones still waiting
    setFiles((current) => [...current.filter((f) => f.state === 'waiting'), ...incoming]);
  };

  const setFileState = (file: File, patch: Partial<QueuedFile>) =>
    setFiles((current) => current.map((f) => (f.file === file ? { ...f, ...patch } : f)));

  /** One by one, so each file gets its own status and one failure doesn't stop the rest */
  const uploadAll = async () => {
    const waiting = files.filter((f) => f.state === 'waiting');
    if (!waiting.length) return;
    setUploading(true);
    let done = 0;
    for (const { file } of waiting) {
      setFileState(file, { state: 'uploading' });
      try {
        await api.uploadDocument(token, file, waiting.length === 1 && title ? title : undefined);
        setFileState(file, { state: 'done' });
        done++;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return onUnauthorized();
        setFileState(file, { state: 'error', error: (error as Error).message });
      }
    }
    setUploading(false);
    setTitle('');
    void queryClient.invalidateQueries({ queryKey: ['documents'] });
    if (done) toast.success(`${done} ${done === 1 ? 'file' : 'files'} added. Indexing takes a few seconds.`);
    if (done < waiting.length) toast.error(`${waiting.length - done} of ${waiting.length} files could not be added.`);
  };

  const addUrl = useMutation({
    mutationFn: () => api.addUrl(token, url, title || undefined),
    onSuccess: () => {
      setUrl('');
      setTitle('');
      toast.success('Page added. Indexing takes a few seconds.');
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) onUnauthorized();
    },
  });

  const waitingCount = files.filter((f) => f.state === 'waiting').length;

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
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors ${
              mode === m
                ? 'bg-slate-100 font-medium dark:bg-slate-800'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800 dark:hover:bg-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {m === 'file' ? <Upload className="size-3.5" aria-hidden /> : <Globe className="size-3.5" aria-hidden />}
            {m === 'file' ? 'Upload files' : 'Add web page'}
          </button>
        ))}
      </div>

      {mode === 'file' ? (
        <div className="mt-3">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(e.dataTransfer.files);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
              dragging
                ? 'border-accent bg-accent-soft/50 dark:bg-slate-900'
                : 'border-slate-300 hover:border-accent hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900'
            }`}
          >
            <Upload className={`size-6 ${dragging ? 'text-accent' : 'text-slate-400'}`} aria-hidden />
            <span className="text-sm font-medium">Drop files here or click to choose</span>
            <span className="text-xs text-slate-500">.md, .txt or .pdf, up to 10 MB each, several at once</span>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPTED.join(',')}
              aria-label="Files"
              className="sr-only"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>

          {files.length > 0 && (
            <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {files.map((f) => (
                <li
                  key={`${f.file.name}-${f.file.size}-${f.file.lastModified}`}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm"
                >
                  <FileText className="size-4 shrink-0 text-slate-400" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{f.file.name}</span>
                  <span className="shrink-0 text-xs text-slate-500 tabular-nums">{formatSize(f.file.size)}</span>
                  <FileState file={f} />
                  {f.state !== 'uploading' && !uploading && (
                    <button
                      type="button"
                      aria-label={`Remove ${f.file.name}`}
                      onClick={() => setFiles((current) => current.filter((x) => x !== f))}
                      className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap items-end gap-3">
            {waitingCount === 1 && (
              <div className="min-w-56 flex-1">
                <Field label="Title (optional)">
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={200}
                    className={inputClass}
                  />
                </Field>
              </div>
            )}
            <Button variant="primary" loading={uploading} disabled={!waitingCount} onClick={() => void uploadAll()}>
              {uploading ? 'Uploading…' : waitingCount > 1 ? `Add ${waitingCount} files` : 'Add'}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            addUrl.mutate();
          }}
        >
          <Field label="Page URL">
            <input
              type="url"
              required
              placeholder="https://docs.example.com/page"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Title (optional)">
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={inputClass} />
          </Field>
          <Button type="submit" variant="primary" loading={addUrl.isPending}>
            Add
          </Button>
          {addUrl.error && <ErrorText error={addUrl.error} />}
        </form>
      )}
    </section>
  );
}

function FileState({ file }: { file: QueuedFile }) {
  switch (file.state) {
    case 'uploading':
      return <Spinner className="size-4 text-accent" />;
    case 'done':
      return <CircleCheck className="size-4 text-emerald-600" aria-label="Added" />;
    case 'error':
      return (
        <span
          className="flex max-w-48 items-center gap-1 truncate text-xs text-red-600 dark:text-red-400"
          title={file.error}
        >
          <CircleAlert className="size-3.5 shrink-0" aria-hidden />
          {file.error}
        </span>
      );
    default:
      return <Clock className="size-4 text-slate-300 dark:text-slate-600" aria-label="Waiting" />;
  }
}

const formatSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

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
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const documents = useQuery({
    queryKey: ['documents'],
    queryFn: () => api.documents(token),
    // Poll only while something is still being indexed
    refetchInterval: (query) =>
      query.state.data?.some((d) => d.status === 'queued' || d.status === 'processing') ? 2000 : false,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['documents'] });

  const reindex = useMutation({
    mutationFn: (id: string) => api.reindex(token, id),
    onSettled: refresh,
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (doc: DocumentDto) => api.deleteDocument(token, doc.id),
    onSuccess: (_, doc) => toast.success(`“${doc.title}” deleted.`),
    onError: (error) => toast.error(error.message),
    onSettled: () => {
      setConfirmDelete(null);
      void refresh();
    },
  });
  const reindexAll = useMutation({
    mutationFn: () => api.reindexAll(token),
    onSuccess: ({ queued }) => toast.success(`Reindexing ${queued} documents.`),
    onError: (error) => toast.error(error.message),
    onSettled: refresh,
  });

  useEffect(() => {
    if (documents.error instanceof ApiError && documents.error.status === 401) onUnauthorized();
  }, [documents.error, onUnauthorized]);

  const count = documents.data?.length ?? 0;
  const indexing = documents.data?.filter((d) => d.status === 'queued' || d.status === 'processing').length ?? 0;

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          Documents
          {count > 0 && <span className="ml-2 text-sm font-normal text-slate-500">{count}</span>}
          {indexing > 0 && (
            <span className="ml-3 inline-flex items-center gap-1.5 text-sm font-normal text-blue-600 dark:text-blue-400">
              <Spinner className="size-3.5" /> indexing {indexing}
            </span>
          )}
        </h2>
        {!readOnly && count > 0 && (
          <Button size="sm" loading={reindexAll.isPending} onClick={() => reindexAll.mutate()}>
            {!reindexAll.isPending && <RefreshCw className="size-3.5" aria-hidden />}
            Reindex all
          </Button>
        )}
      </div>
      {documents.isPending ? (
        <div
          className="mt-3 space-y-px overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800"
          aria-label="Loading documents"
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="ml-auto h-5 w-14 rounded-full" />
            </div>
          ))}
        </div>
      ) : documents.error ? (
        <ErrorText error={documents.error} />
      ) : count === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700">
          No documents yet. Upload files or add a web page above.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:bg-slate-900">
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
                <tr key={doc.id} className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-900/50">
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
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[doc.status]}`}
                      title={doc.error ?? undefined}
                    >
                      {(doc.status === 'queued' || doc.status === 'processing') && <Spinner className="size-3" />}
                      {doc.status}
                    </span>
                    {doc.error && (
                      <p className="mt-1 max-w-56 truncate text-xs text-red-600 dark:text-red-400" title={doc.error}>
                        {doc.error}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{doc.chunkCount}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">
                    {new Date(doc.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {readOnly ? null : confirmDelete === doc.id ? (
                      <span className="animate-fade-in inline-flex items-center gap-1">
                        <span className="mr-1 text-xs text-slate-500">Delete?</span>
                        <Button
                          size="sm"
                          variant="danger"
                          loading={remove.isPending}
                          onClick={() => remove.mutate(doc)}
                        >
                          Delete
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={remove.isPending}
                          onClick={() => setConfirmDelete(null)}
                        >
                          Cancel
                        </Button>
                      </span>
                    ) : (
                      <span className="inline-flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={reindex.isPending && reindex.variables === doc.id}
                          onClick={() => reindex.mutate(doc.id)}
                        >
                          Reindex
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setConfirmDelete(doc.id)}>
                          <Trash2 className="size-3.5" aria-hidden />
                          Delete
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
      <dl className="mt-3 grid grid-cols-3 gap-3 sm:max-w-xl">
        <Stat label="Questions" value={totals?.requests.toLocaleString()} />
        <Stat label="Tokens" value={totals?.tokens.toLocaleString()} />
        <Stat label="Cost" value={totals && `$${totals.cost.toFixed(4)}`} />
      </dl>
      {usage.isPending ? (
        <Skeleton className="mt-3 h-24 w-full rounded-xl" />
      ) : usage.error ? (
        <ErrorText error={usage.error} />
      ) : usage.data.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No questions asked yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:bg-slate-900">
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
                <tr key={d.day} className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-900/50">
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
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition hover:border-slate-400 focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-slate-600 dark:text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-800">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value ?? <Skeleton className="mt-1 h-5 w-16" />}</dd>
    </div>
  );
}

function ErrorText({ error }: { error: Error }) {
  return <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error.message}</p>;
}
