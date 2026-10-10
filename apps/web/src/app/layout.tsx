import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { SiteHeader } from '@/components/site-header';
import { Providers } from './providers';
import './globals.css';

const inter = Inter({ subsets: ['latin', 'cyrillic'], variable: '--font-inter' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono-face' });

export const metadata: Metadata = {
  title: 'Docs Assistant',
  description: 'AI support assistant that answers questions from your product docs, with sources.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <Providers>
          <SiteHeader />
          {children}
        </Providers>
      </body>
    </html>
  );
}
