// Daily loop scheduler tasks (spec section 11).
// Evaluates morning brief notification, evening check-in ping, and sync canary alerts.
import type { Db } from "../db/client.ts";
import type { Env } from "../env.ts";
import { aucklandDate, aucklandMinutes, parseTimeToMinutes } from "../lib/timezone.ts";
import { getSettings } from "../routes/settings.ts";
import { sendNotification } from "./ntfy.ts";

export async function runDailyLoopScheduler(
  env: Env,
  db: Db,
  now: number,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const today = aucklandDate(now);
  const minutes = aucklandMinutes(now);
  const settings = await getSettings(db);

  // 1. Morning brief notification (default 08:30 Auckland time)
  const briefMinutes = parseTimeToMinutes(settings.brief_time);
  if (minutes >= briefMinutes) {
    await sendNotification(
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
      await sendNotification(
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

  // 3. Mail sync health canary (any account needs_reauth or last sync > 6 hours ago)
  const accounts = await db.all<{ status: string; last_sync_at: number | null }>(
    "SELECT status, last_sync_at FROM mail_accounts WHERE status IN ('active', 'needs_reauth')",
  );

  if (accounts.length > 0) {
    const sixHoursAgo = now - 6 * 3600;
    const hasReauth = accounts.some((a) => a.status === "needs_reauth");
    const isStale = accounts.some((a) => (a.last_sync_at ?? 0) < sixHoursAgo);

    if (hasReauth || isStale) {
      await sendNotification(
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
