// Cron tick (spec section 8). Phase 0: lock, pause/kill checks and housekeeping.
// Phase 2: Gmail synchronisation, classification, and review queue integration.
import type { Env } from "./env.ts";
import { IDLE_TTL } from "./auth/session.ts";
import { SubrequestBudget } from "./db/budget.ts";
import { Db } from "./db/client.ts";
import { getSystemState } from "./db/kv.ts";
import { catchUpMail, syncMailAccounts } from "./gmail/sync.ts";
import { errorCode, log } from "./log/index.ts";
import { runDailyLoopScheduler } from "./notify/scheduler.ts";

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
  // Deliberately NOT charged to the call budget: releasing the lock must work even when the tick used every call it had.
  await db.d1.prepare("DELETE FROM kv WHERE k = 'tick_lock' AND v = ?").bind(value).run();
}

export function housekeepingStmts(db: Db, now: number): D1PreparedStatement[] {
  return [
    db.stmt("DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?", now, now - IDLE_TTL),
    db.stmt("DELETE FROM login_attempts WHERE locked_until <= ?1 AND window_start <= ?1 - 86400", now),
    db.stmt("DELETE FROM voice_log WHERE created_at < ?", now - 30 * 86400),
    db.stmt("DELETE FROM kv WHERE (k LIKE 'tts_chars:%' OR k LIKE 'ai:%') AND k < ?", `ai:~:${new Date((now - 2 * 86400) * 1000).toISOString().slice(0, 10)}`),
    db.stmt("DELETE FROM oauth_states WHERE expires_at <= ?", now),
    db.stmt("DELETE FROM sync_runs WHERE started_at < ?", now - 30 * 86400),
    db.stmt("UPDATE emails_seen SET snippet_enc = NULL WHERE snippet_enc IS NOT NULL AND internal_date < ?", now - 90 * 86400),
    db.stmt("UPDATE review_queue SET context_enc = NULL WHERE context_enc IS NOT NULL AND created_at < ?", now - 30 * 86400),
  ];
}

export async function runTick(env: Env, now: number, fetchFn: typeof fetch = fetch): Promise<TickResult> {
  const db = new Db(env.DB, new SubrequestBudget());
  try {
    const s = await getSystemState(db);
    if (s.kill !== "running") return skip(s.kill);
    if (s.paused) return skip("paused");
    const lock = await acquireTickLock(db, now);
    if (!lock) return skip("locked");
    try {
      await db.batch(housekeepingStmts(db, now));
      await syncMailAccounts(env, db, now, fetchFn);
      await runDailyLoopScheduler(env, db, now, fetchFn);
      await catchUpMail(env, db, now, fetchFn); // last: uses whatever call budget is left
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

/**
 * "Refresh" from the app: checks Gmail now and reads whatever job mail is waiting, using a fresh call budget for this request.
 * Shares the cron's lock, so it can never overlap a scheduled run. Never sends notifications.
 */
export async function runManualSync(env: Env, now: number, fetchFn: typeof fetch = fetch): Promise<{ ran: boolean; reason?: string; pending: number }> {
  const db = new Db(env.DB, new SubrequestBudget());
  const pending = async () => (await db.d1.prepare("SELECT COUNT(*) AS n FROM emails_seen WHERE body_checked = 0 AND internal_date >= ?").bind(now - 5 * 86400).first<{ n: number }>())?.n ?? 0;
  const s = await getSystemState(db);
  if (s.kill !== "running") return { ran: false, reason: s.kill, pending: 0 };
  if (s.paused) return { ran: false, reason: "paused", pending: await pending() };
  const lock = await acquireTickLock(db, now);
  if (!lock) return { ran: false, reason: "busy", pending: await pending() };
  try {
    await syncMailAccounts(env, db, now, fetchFn);
    await catchUpMail(env, db, now, fetchFn);
  } catch (err) {
    log("manual_sync_error", { code: errorCode(err) });
  } finally {
    await releaseTickLock(db, lock);
  }
  return { ran: true, pending: await pending() };
}
