import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

export const USER_COOKIE = 'da_uid';
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/**
 * Chat users are anonymous: an httpOnly cookie holds a random id that conversations,
 * rate limits and token budgets are tied to. The web app proxies /api to this server,
 * so the cookie is first-party and SameSite=Lax works.
 */
export function resolveAnonymousUser(req: Request, res: Response, secure: boolean): string {
  const existing = readCookie(req.headers.cookie, USER_COOKIE);
  if (existing && UUID_RE.test(existing)) return existing;

  const id = randomUUID();
  res.cookie(USER_COOKIE, id, { httpOnly: true, sameSite: 'lax', secure, maxAge: ONE_YEAR_MS, path: '/' });
  return id;
}
