import Link from 'next/link';

const FEATURES = [
  {
    title: 'Answers with sources',
    text: 'Every statement is tied to a numbered fragment of your docs. Click it to see the exact text the answer is based on.',
  },
  {
    title: 'Says “I don’t know”',
    text: 'Weak search matches are filtered out. If the docs don’t cover a question, the assistant says so instead of guessing.',
  },
  {
    title: 'Streaming replies',
    text: 'Tokens arrive as they are generated over Server-Sent Events. Closing the tab stops the model request.',
  },
  {
    title: 'Powered by Claude',
    text: 'Answers are written by Claude behind a provider interface. Search runs on local embeddings, and a keyless fake model runs tests for free.',
  },
  {
    title: 'Cost control',
    text: 'Per-user rate limit in Redis, daily token budgets per user and for the whole app, cost tracked per request.',
  },
  {
    title: 'Background indexing',
    text: 'Markdown, PDF and web pages are chunked and embedded by a queue worker with retries, so uploads never block the API.',
  },
];

const PIPELINE = [
  { step: 'Upload', detail: 'Markdown, PDF or URL' },
  { step: 'Queue', detail: 'BullMQ on Redis' },
  { step: 'Chunk + embed', detail: '~800 tokens, 100 overlap' },
  { step: 'pgvector', detail: 'HNSW cosine index' },
  { step: 'Retrieve top 6', detail: 'with a relevance cutoff' },
  { step: 'LLM answer', detail: 'streamed, with [n] citations' },
];

const STACK = [
  'Next.js',
  'React',
  'TypeScript',
  'NestJS',
  'PostgreSQL + pgvector',
  'Redis + BullMQ',
  'Claude API',
  'Tailwind CSS',
];

export default function HomePage() {
  const githubUrl = process.env.NEXT_PUBLIC_GITHUB_URL;

  return (
    <main className="flex-1">
      <section className="mx-auto max-w-6xl px-4 pb-12 pt-16 sm:pt-24">
        <p className="text-sm font-medium text-accent">Demo project · RAG support assistant</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          A support chat that answers from your docs and shows its sources
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-slate-600 dark:text-slate-400">
          Upload product documentation, and customers get instant answers grounded in it. Each answer links to the
          fragment it came from, and questions outside the docs get an honest “not covered”.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/chat" className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white">
            Try the chat
          </Link>
          <Link
            href="/admin"
            className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900"
          >
            Admin panel
          </Link>
          {githubUrl && (
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900"
            >
              Source code
            </a>
          )}
        </div>
      </section>

      <section className="border-y border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <h2 className="text-xl font-semibold">How a question is answered</h2>
          <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            {PIPELINE.map((p, i) => (
              <li
                key={p.step}
                className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950"
              >
                <span className="text-xs font-semibold text-accent">{String(i + 1).padStart(2, '0')}</span>
                <p className="mt-1 font-medium">{p.step}</p>
                <p className="mt-0.5 text-sm text-slate-500">{p.detail}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="text-xl font-semibold">What it does</h2>
        <div className="mt-6 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title}>
              <h3 className="font-medium">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <h2 className="text-xl font-semibold">Stack</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {STACK.map((s) => (
            <li key={s} className="rounded-full border border-slate-200 px-3 py-1 text-sm dark:border-slate-800">
              {s}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
