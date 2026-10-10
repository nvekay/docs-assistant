import type { Metadata } from 'next';
import { ChatView } from '@/components/chat/chat-view';

export const metadata: Metadata = { title: 'Chat · Docs Assistant' };

export default function ChatPage() {
  // The header is 3.5rem tall; the chat fills the rest so only the message list scrolls
  return (
    <main className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col">
      <ChatView />
    </main>
  );
}
