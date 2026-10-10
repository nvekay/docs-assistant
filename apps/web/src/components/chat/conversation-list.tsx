'use client';

import type { ConversationSummaryDto } from '@docs-assistant/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, MessageSquarePlus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/time';
import { useNow } from '@/lib/use-now';

export const CONVERSATIONS_KEY = ['conversations'] as const;

interface Props {
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** Called after a chat was deleted, so an open chat can be closed */
  onDeleted: (id: string) => void;
}

/** The visitor's chats, newest first: switch, start a new one, delete */
export function ConversationList({ activeId, onSelect, onNew, onDeleted }: Props) {
  const conversations = useQuery({ queryKey: CONVERSATIONS_KEY, queryFn: api.conversations });

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Button variant="secondary" className="w-full justify-start" onClick={onNew}>
          <MessageSquarePlus className="size-4" aria-hidden />
          New chat
        </Button>
      </div>
      <nav aria-label="Chats" className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {conversations.isPending ? (
          <ul className="space-y-1 px-1" aria-label="Loading chats">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="space-y-1.5 px-2 py-2">
                <Skeleton className="h-3.5 w-4/5" />
                <Skeleton className="h-2.5 w-1/3" />
              </li>
            ))}
          </ul>
        ) : conversations.error ? (
          <div className="px-3 py-2 text-sm text-slate-500">
            Couldn’t load chats.{' '}
            <button
              type="button"
              onClick={() => void conversations.refetch()}
              className="font-medium text-accent hover:underline"
            >
              Retry
            </button>
          </div>
        ) : conversations.data.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-500">
            <MessageSquare className="mx-auto mb-2 size-5 text-slate-400" aria-hidden />
            Your chats will appear here.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.data.map((c) => (
              <ConversationItem
                key={c.id}
                conversation={c}
                active={c.id === activeId}
                onSelect={() => onSelect(c.id)}
                onDeleted={() => onDeleted(c.id)}
              />
            ))}
          </ul>
        )}
      </nav>
    </div>
  );
}

function ConversationItem({
  conversation,
  active,
  onSelect,
  onDeleted,
}: {
  conversation: ConversationSummaryDto;
  active: boolean;
  onSelect: () => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const now = useNow();

  const remove = useMutation({
    mutationFn: () => api.deleteConversation(conversation.id),
    onSuccess: () => {
      queryClient.setQueryData<ConversationSummaryDto[]>(CONVERSATIONS_KEY, (list) =>
        list?.filter((c) => c.id !== conversation.id),
      );
      onDeleted();
    },
    onError: () => {
      setConfirming(false);
      toast.error('Couldn’t delete the chat. Please try again.');
    },
  });

  if (confirming) {
    return (
      <li className="animate-fade-in flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1.5 dark:bg-red-950/40">
        <span className="flex-1 truncate text-sm text-red-700 dark:text-red-300">Delete this chat?</span>
        <Button size="sm" variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
          Delete
        </Button>
        <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </li>
    );
  }

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'page' : undefined}
        className={`w-full rounded-lg py-2 pr-9 pl-3 text-left transition-colors ${
          active
            ? 'bg-accent-soft text-slate-900 dark:bg-slate-800 dark:text-white'
            : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
        }`}
      >
        <span className="block truncate text-sm font-medium">{conversation.title}</span>
        <span className="block text-xs text-slate-500">{now ? relativeTime(conversation.updatedAt, now) : ' '}</span>
      </button>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`Delete chat “${conversation.title}”`}
        className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1.5 text-slate-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 focus-visible:opacity-100 max-lg:opacity-100 dark:hover:bg-red-950/50"
      >
        <Trash2 className="size-3.5" aria-hidden />
      </button>
    </li>
  );
}
