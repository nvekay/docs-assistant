import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ChatView } from '@/components/chat/chat-view';

export const metadata: Metadata = { title: 'Chat · Docs Assistant' };

export default function ChatPage() {
  // The header is 3.5rem tall; the chat fills the rest so only the message list scrolls.
  // ChatView reads ?c= from the URL, which needs a Suspense boundary on a static page.
  return (
    <main className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col">
      <Suspense fallback={null}>
        <ChatView />
      </Suspense>
    </main>
  );
}
