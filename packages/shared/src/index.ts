import { z } from 'zod';

/** Request body for POST /chat */
export const chatRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(2000),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** Request body for POST /documents when adding a URL (files go through multipart upload) */
export const createUrlDocumentSchema = z.object({
  url: z.string().url(),
  title: z.string().trim().min(1).max(200).optional(),
});
export type CreateUrlDocument = z.infer<typeof createUrlDocumentSchema>;

export type DocumentStatus = 'queued' | 'processing' | 'ready' | 'failed';
export type SourceType = 'md' | 'pdf' | 'url';

export interface DocumentDto {
  id: string;
  title: string;
  sourceType: SourceType;
  sourceRef: string | null;
  status: DocumentStatus;
  error: string | null;
  chunkCount: number;
  createdAt: string;
}

/** One source fragment the answer refers to as [n] */
export interface Citation {
  index: number;
  documentId: string;
  documentTitle: string;
  chunkId: number;
  excerpt: string;
  score: number;
}

/** Server-Sent Events emitted by POST /chat, in order: meta, delta*, citations, done | error */
export type ChatStreamEvent =
  | { type: 'meta'; conversationId: string }
  | { type: 'delta'; text: string }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'done'; usage: { inputTokens: number; outputTokens: number; costUsd: number } }
  | { type: 'error'; code: 'rate_limited' | 'daily_limit' | 'refused' | 'internal'; message: string };

/** GET /chat/:conversationId/messages, used to restore a conversation after a page reload */
export interface ChatMessageDto {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  createdAt: string;
}

/** Error body of POST /chat when a limit is hit (HTTP 429), before any streaming starts */
export interface ChatLimitErrorBody {
  code: 'rate_limited' | 'daily_limit';
  message: string;
}

/** One row of GET /usage (admin): totals for one UTC day */
export interface UsageDayDto {
  day: string;
  requests: number;
  users: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** admin can change the knowledge base; viewer is the read-only public demo account */
export type AdminRole = 'admin' | 'viewer';

/** Response of POST /auth/login */
export interface LoginResponse {
  accessToken: string;
  role: AdminRole;
}
