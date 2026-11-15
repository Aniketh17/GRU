// Server-side sessions (D-006). Cookie holds a random token; D1 holds SHA-256(token).
import { b64urlEncode } from "../crypto/b64.ts";
import { sha256 } from "../crypto/hmac.ts";
import type { Db } from "../db/client.ts";

export const COOKIE_NAME = "__Host-gru_s";
export const IDLE_TTL = 7 * 24 * 3600; // 7 days
export const ABSOLUTE_TTL = 30 * 24 * 3600; // 30 days
export const TOUCH_INTERVAL = 600; // refresh last_seen_at at most every 10 min

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

async function tokenHash(token: string): Promise<string> {
  return b64urlEncode(await sha256(token));
}

export function newToken(): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

export async function insertSessionStmt(db: Db, token: string, now: number): Promise<D1PreparedStatement> {
  return db.stmt(
    "INSERT INTO sessions (token_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?)",
    await tokenHash(token),
    now,
    now,
    now + ABSOLUTE_TTL,
  );
}

export type SessionResult = "valid" | "missing" | "expired";

export async function validateSession(db: Db, token: string | null, now: number): Promise<SessionResult> {
  if (!token || !TOKEN_RE.test(token)) return "missing";
  const hash = await tokenHash(token);
  const row = await db.first<{ last_seen_at: number; expires_at: number }>(
    "SELECT last_seen_at, expires_at FROM sessions WHERE token_hash = ?",
    hash,
  );
  if (!row) return "missing";
  if (now >= row.expires_at || now - row.last_seen_at > IDLE_TTL) {
    await db.run("DELETE FROM sessions WHERE token_hash = ?", hash);
    return "expired";
  }
  if (now - row.last_seen_at >= TOUCH_INTERVAL) {
    await db.run("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?", now, hash);
  }
  return "valid";
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  if (!TOKEN_RE.test(token)) return;
  await db.run("DELETE FROM sessions WHERE token_hash = ?", await tokenHash(token));
}

export function readSessionCookie(header: string | undefined | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === COOKIE_NAME) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ABSOLUTE_TTL}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
