import { randomUUID } from "node:crypto";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

interface SessionEntry {
  expiresAt: number;
}

const sessions = new Map<string, SessionEntry>();

export const SESSION_COOKIE_NAME = "gitsync_session";

export function createSession(): string {
  const token = randomUUID();
  sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

export function isValidSession(token: string | undefined): boolean {
  if (!token) return false;
  const entry = sessions.get(token);
  if (!entry) return false;
  if (entry.expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function destroySession(token: string | undefined): void {
  if (token) sessions.delete(token);
}
