import type {
  ChatMessageDto,
  ConversationSummaryDto,
  DocumentDto,
  LoginResponse,
  UsageDayDto,
} from '@docs-assistant/shared';

/** All requests go to this origin; next.config.ts proxies /api/* to the NestJS API */
export const API_BASE = '/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Nest errors look like {message, statusCode}; ours add {code}; validation adds {issues} */
export async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { message?: string | string[]; code?: string } | null;
  const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
  return new ApiError(res.status, message || `Request failed (${res.status})`, body?.code);
}

async function request<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) throw await toApiError(res);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  chatMessages: (conversationId: string) => request<ChatMessageDto[]>(`/chat/${conversationId}/messages`),

  conversations: () => request<ConversationSummaryDto[]>('/chat/conversations'),

  deleteConversation: (conversationId: string) => request<void>(`/chat/${conversationId}`, { method: 'DELETE' }),

  login: (email: string, password: string) =>
    request<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  documents: (token: string) => request<DocumentDto[]>('/documents', {}, token),

  uploadDocument: (token: string, file: File, title?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (title) form.append('title', title);
    return request<{ id: string }>('/documents/upload', { method: 'POST', body: form }, token);
  },

  addUrl: (token: string, url: string, title?: string) =>
    request<{ id: string }>('/documents/url', { method: 'POST', body: JSON.stringify({ url, title }) }, token),

  reindex: (token: string, id: string) =>
    request<{ id: string }>(`/documents/${id}/reindex`, { method: 'POST' }, token),

  reindexAll: (token: string) => request<{ queued: number }>('/documents/reindex-all', { method: 'POST' }, token),

  deleteDocument: (token: string, id: string) => request<void>(`/documents/${id}`, { method: 'DELETE' }, token),

  usage: (token: string, days = 14) => request<UsageDayDto[]>(`/usage?days=${days}`, {}, token),
};
