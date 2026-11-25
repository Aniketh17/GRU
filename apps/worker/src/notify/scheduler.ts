// Daily loop scheduler tasks (spec section 11).
// Evaluates morning brief notification, evening check-in ping, and sync canary alerts.
import type { Db } from "../db/client.ts";
import type { Env } from "../env.ts";
import { aucklandDate, aucklandMinutes, parseTimeToMinutes } from "../lib/timezone.ts";
import { getSettings } from "../routes/settings.ts";
import { NTFY_BACKOFF_KEY, sendNotification } from "./ntfy.ts";

export async function runDailyLoopScheduler(
  env: Env,
  db: Db,
  now: number,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const today = aucklandDate(now);
  const minutes = aucklandMinutes(now);
  const settings = await getSettings(db);
  // One query for everything already sent recently (and any ntfy back-off), instead of a claim attempt per notification per run.
  const sentRows = await db.all<{ key: string; sent_at: number }>("SELECT key, sent_at FROM notifications_sent WHERE sent_at >= ?", now - 3 * 86400);
  const sentKeys = new Set(sentRows.map((r) => r.key));
  const backingOff = sentRows.some((r) => r.key === NTFY_BACKOFF_KEY && r.sent_at > now);
  const sendOnce: typeof sendNotification = async (d, topic, origin, kind, key, n, f) => (backingOff || sentKeys.has(key) ? false : sendNotification(d, topic, origin, kind, key, n, f));

  // 1. Morning brief notification (default 08:30 Auckland time)
  const briefMinutes = parseTimeToMinutes(settings.brief_time);
  if (minutes >= briefMinutes) {
    await sendOnce(
      db,
      env.NTFY_TOPIC,
      env.APP_ORIGIN,
      "brief",
      `brief:${today}`,
      now,
      fetchFn,
    );
  }

  // 2. Evening ping at 18:30 (1110 min) if checkin is not completed
  if (minutes >= 18 * 60 + 30) {
    const checkin = await db.first<{ status: string }>(
      "SELECT status FROM checkins WHERE date = ?",
      today,
    );
    if (!checkin || checkin.status !== "completed") {
      await sendOnce(
        db,
        env.NTFY_TOPIC,
        env.APP_ORIGIN,
        "evening",
        `evening:${today}`,
        now,
        fetchFn,
      );
    }
  }

  const send = (kind: "interview" | "debrief" | "task_due" | "jobs" | "weekly" | "network", key: string) =>
    sendOnce(db, env.NTFY_TOPIC, env.APP_ORIGIN, kind, key, now, fetchFn);

  // 2b. Interview reminders: 24 h and 2 h before (generic text), debrief nudge the morning after
  const upcoming = await db.all<{ id: number; start_utc: number }>(
    "SELECT id, start_utc FROM interviews WHERE state = 'scheduled' AND start_utc > ? AND start_utc <= ?", now, now + 24 * 3600,
  );
  for (const i of upcoming) {
    if (i.start_utc - now <= 2 * 3600) await send("interview", `iv2:${i.id}`);
    else await send("interview", `iv24:${i.id}`);
  }
  if (minutes >= briefMinutes) {
    const past = await db.all<{ id: number; start_utc: number }>(
      "SELECT id, start_utc FROM interviews WHERE state IN ('scheduled','done') AND debrief_enc IS NULL AND start_utc < ? AND start_utc > ?", now, now - 3 * 86400,
    );
    for (const i of past) if (aucklandDate(i.start_utc) < today) await send("debrief", `debrief:${i.id}`);

    // Sunday: the weekly summary (once)
    if (new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", weekday: "short" }).format(new Date(now * 1000)) === "Sun") await send("weekly", `weekly:${today}`);

    // 2c. Tasks due, and new job matches, at most once per day after the brief time
    const due = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE done_at IS NULL AND due_at IS NOT NULL AND due_at <= ?", now);
    if ((due?.n ?? 0) > 0) await send("task_due", `task_due:${today}`);
    const follow = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM net_people WHERE next_followup_at IS NOT NULL AND next_followup_at <= ?", now);
    if ((follow?.n ?? 0) > 0) await send("network", `network:${today}`);
    const fresh = await db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM jobs j JOIN job_matches m ON m.job_id = j.id
       WHERE j.status = 'new' AND j.first_seen_at >= ? AND m.score >= ?`, now - 86400, settings.shortlist_threshold,
    );
    if ((fresh?.n ?? 0) > 0) await send("jobs", `jobs:${today}`);
  }

  // 3. Mail sync health canary (any account needs_reauth or last sync > 6 hours ago)
  const accounts = await db.all<{ status: string; last_sync_at: number | null }>(
    "SELECT status, last_sync_at FROM mail_accounts WHERE status IN ('active', 'needs_reauth')",
  );

  if (accounts.length > 0) {
    const sixHoursAgo = now - 6 * 3600;
    const hasReauth = accounts.some((a) => a.status === "needs_reauth");
    const isStale = accounts.some((a) => (a.last_sync_at ?? 0) < sixHoursAgo);

    if (hasReauth || isStale) {
      await sendOnce(
        db,
        env.NTFY_TOPIC,
        env.APP_ORIGIN,
        "reauth",
        `reauth:${today}`,
        now,
        fetchFn,
      );
    }
  }
}
