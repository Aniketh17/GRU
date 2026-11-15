// Login rate limiting (D-019). Pure state transitions + D1 load/store.
import { b64urlEncode } from "../crypto/b64.ts";
import { hmacSha256 } from "../crypto/hmac.ts";
import type { Db } from "../db/client.ts";

export const CLIENT_MAX_FAILS = 5;
export const CLIENT_WINDOW = 15 * 60;
export const CLIENT_BASE_LOCK = 15 * 60;
export const CLIENT_MAX_LOCK = 24 * 3600;
export const STRIKE_DECAY = 24 * 3600;
export const GLOBAL_MAX_FAILS = 20;
export const GLOBAL_WINDOW = 3600;
export const GLOBAL_LOCK = 3600;
export const GLOBAL_BUCKET = "global";

export interface Bucket {
  bucket: string;
  fails: number;
  window_start: number;
  locked_until: number;
  strikes: number;
}

export interface Buckets {
  client: Bucket;
  global: Bucket;
}

const empty = (bucket: string): Bucket => ({ bucket, fails: 0, window_start: 0, locked_until: 0, strikes: 0 });

/** Bucket key from the client IP. The raw IP is never stored. */
export async function clientBucketKey(secret: string, ip: string): Promise<string> {
  const mac = await hmacSha256(secret, "ip:" + ip);
  return "c:" + b64urlEncode(mac.slice(0, 16));
}

export async function loadBuckets(db: Db, clientKey: string): Promise<Buckets> {
  const rows = await db.all<Bucket>(
    "SELECT bucket, fails, window_start, locked_until, strikes FROM login_attempts WHERE bucket IN (?, ?)",
    clientKey,
    GLOBAL_BUCKET,
  );
  return {
    client: rows.find((r) => r.bucket === clientKey) ?? empty(clientKey),
    global: rows.find((r) => r.bucket === GLOBAL_BUCKET) ?? empty(GLOBAL_BUCKET),
  };
}

/** Seconds until login is allowed again (0 = allowed). */
export function lockRemaining(b: Buckets, now: number): number {
  return Math.max(0, b.client.locked_until - now, b.global.locked_until - now);
}

export function nextClient(b: Bucket, now: number): Bucket {
  const n = { ...b };
  if (n.locked_until > 0 && now - n.locked_until > STRIKE_DECAY) n.strikes = 0;
  if (now - n.window_start >= CLIENT_WINDOW) {
    n.fails = 0;
    n.window_start = now;
  }
  n.fails += 1;
  if (n.fails >= CLIENT_MAX_FAILS) {
    n.strikes += 1;
    n.locked_until = now + Math.min(CLIENT_BASE_LOCK * 2 ** (n.strikes - 1), CLIENT_MAX_LOCK);
    n.fails = 0;
    n.window_start = now;
  }
  return n;
}

export function nextGlobal(b: Bucket, now: number): Bucket {
  const n = { ...b };
  if (now - n.window_start >= GLOBAL_WINDOW) {
    n.fails = 0;
    n.window_start = now;
  }
  n.fails += 1;
  if (n.fails >= GLOBAL_MAX_FAILS) {
    n.locked_until = now + GLOBAL_LOCK;
    n.fails = 0;
    n.window_start = now;
  }
  return n;
}

function upsertStmt(db: Db, b: Bucket): D1PreparedStatement {
  return db.stmt(
    `INSERT INTO login_attempts (bucket, fails, window_start, locked_until, strikes) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(bucket) DO UPDATE SET fails = excluded.fails, window_start = excluded.window_start,
       locked_until = excluded.locked_until, strikes = excluded.strikes`,
    b.bucket,
    b.fails,
    b.window_start,
    b.locked_until,
    b.strikes,
  );
}

export function failureStmts(db: Db, b: Buckets, now: number): D1PreparedStatement[] {
  return [upsertStmt(db, nextClient(b.client, now)), upsertStmt(db, nextGlobal(b.global, now))];
}

export function successStmt(db: Db, clientKey: string): D1PreparedStatement {
  return db.stmt("DELETE FROM login_attempts WHERE bucket = ?", clientKey);
}
