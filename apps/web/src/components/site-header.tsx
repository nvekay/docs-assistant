'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/chat', label: 'Chat' },
  { href: '/admin', label: 'Admin' },
];

export function SiteHeader() {
  const pathname = usePathname();
  // The chat uses the full window width (list, messages, sources); other pages are centered
  const fullWidth = pathname.startsWith('/chat');
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
      <div className={`mx-auto flex h-14 items-center justify-between px-4 ${fullWidth ? 'max-w-none' : 'max-w-6xl'}`}>
        <Link href="/" className="flex items-center gap-2 whitespace-nowrap font-semibold">
          <span className="grid size-7 place-items-center rounded-md bg-accent text-sm text-white" aria-hidden>
            D
          </span>
          Docs Assistant
          <span className="hidden rounded-full bg-accent-soft px-2 py-0.5 text-xs sm:inline font-medium text-accent dark:bg-slate-800 dark:text-indigo-300">
            demo
          </span>
        </Link>
        <nav className="flex gap-1 text-sm">
          {LINKS.map((link) => {
            const active = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-2.5 py-1.5 transition-colors sm:px-3 ${
                  active
                    ? 'bg-slate-100 font-medium dark:bg-slate-800'
                    : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-900'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
