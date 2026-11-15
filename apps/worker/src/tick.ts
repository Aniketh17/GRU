// Cron tick (spec section 8). Phase 0: lock, pause/kill checks and housekeeping only.
// Gmail sync (Phase 2) and scheduler tasks (Phase 3) plug in here.
import type { Env } from "./env.ts";
import { IDLE_TTL } from "./auth/session.ts";
import { SubrequestBudget } from "./db/budget.ts";
import { Db } from "./db/client.ts";
import { getSystemState } from "./db/kv.ts";
import { errorCode, log } from "./log/index.ts";

export const TICK_LOCK_TTL = 300;

export interface TickResult {
  ran: boolean;
  reason?: "paused" | "wiping" | "wiped" | "locked" | "error";
}

/** Atomic: succeeds only if no lock exists or the existing one has expired. */
export async function acquireTickLock(db: Db, now: number): Promise<string | null> {
  const value = `${now + TICK_LOCK_TTL}:${crypto.randomUUID()}`;
  const r = await db.run(
    `INSERT INTO kv (k, v) VALUES ('tick_lock', ?1)
     ON CONFLICT(k) DO UPDATE SET v = excluded.v WHERE CAST(kv.v AS INTEGER) <= ?2`,
    value,
    now,
  );
  return r.meta.changes === 1 ? value : null;
}

export async function releaseTickLock(db: Db, value: string): Promise<void> {
  await db.run("DELETE FROM kv WHERE k = 'tick_lock' AND v = ?", value);
}

export function housekeepingStmts(db: Db, now: number): D1PreparedStatement[] {
  return [
    db.stmt("DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?", now, now - IDLE_TTL),
    db.stmt("DELETE FROM login_attempts WHERE locked_until <= ?1 AND window_start <= ?1 - 86400", now),
    db.stmt("DELETE FROM oauth_states WHERE expires_at <= ?", now),
    db.stmt("DELETE FROM sync_runs WHERE started_at < ?", now - 30 * 86400),
    db.stmt("UPDATE emails_seen SET snippet_enc = NULL WHERE snippet_enc IS NOT NULL AND internal_date < ?", now - 90 * 86400),
  ];
}

export async function runTick(env: Env, now: number): Promise<TickResult> {
  const db = new Db(env.DB, new SubrequestBudget());
  try {
    const s = await getSystemState(db);
    if (s.kill !== "running") return skip(s.kill);
    if (s.paused) return skip("paused");
    const lock = await acquireTickLock(db, now);
    if (!lock) return skip("locked");
    try {
      await db.batch(housekeepingStmts(db, now));
      log("tick_done", { budget_used_count: db.budget.usedCount });
      return { ran: true };
    } finally {
      await releaseTickLock(db, lock);
    }
  } catch (err) {
    // Includes D1 daily-cap errors: end quietly, never loop (D-011).
    log("tick_error", { code: errorCode(err) });
    return { ran: false, reason: "error" };
  }
}

function skip(reason: NonNullable<TickResult["reason"]>): TickResult {
  log("tick_skipped", { code: reason });
  return { ran: false, reason };
}
