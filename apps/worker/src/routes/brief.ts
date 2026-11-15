// Morning Brief API (spec section 11).
// Computed on read: overnight changes, review queue count, follow-ups due, upcoming interviews, pipeline counts, sync health.
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import type { Db } from "../db/client.ts";
import { nowSec } from "../env.ts";
import { aucklandDate } from "../lib/timezone.ts";
import { getSettings } from "./settings.ts";

export const briefRoutes = new Hono<AppEnv>();

briefRoutes.get("/", async (c) => c.json(await computeBrief(c.get("db"), nowSec())));

export async function computeBrief(db: Db, now: number) {
  const today = aucklandDate(now);
  const settings = await getSettings(db);

  // 1. Changes since yesterday (last 24 hours, auto-applied, not undone)
  const yesterdaySec = now - 86400;
  const recentChanges = await db.all<{
    id: number;
    app_id: number;
    company: string;
    prev_status: string;
    type: string;
    at: number;
    created_at: number;
    undone: number;
  }>(
    `SELECT e.id, e.app_id, a.company, e.prev_status, e.type, e.at, e.created_at, e.undone
     FROM events e
     JOIN applications a ON e.app_id = a.id
     WHERE e.auto_applied = 1 AND e.undone = 0 AND e.at >= ? AND e.type LIKE 'status:%'
     ORDER BY e.at DESC
     LIMIT 20`,
    yesterdaySec,
  );

  const changes = recentChanges.map((r) => {
    const toStatus = r.type.slice(7);
    const canUndo = (now - r.created_at) <= 86400 && r.undone === 0;
    return {
      id: r.id,
      app_id: r.app_id,
      company: r.company,
      from_status: r.prev_status,
      to_status: toStatus,
      at: r.at,
      can_undo: canUndo,
    };
  });

  // 2. Review queue count
  const reviewRow = await db.first<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM review_queue WHERE resolved_at IS NULL",
  );
  const reviewCount = reviewRow?.cnt ?? 0;

  // 3. Follow-ups due (applications where last_event_at or applied_at is older than stale_days)
  const staleThresholdSec = now - (settings.stale_days * 86400);
  const staleRows = await db.all<{
    id: number;
    company: string;
    role: string | null;
    status: string;
    applied_at: number;
    last_event_at: number | null;
  }>(
    `SELECT id, company, role, status, applied_at, last_event_at
     FROM applications
     WHERE status IN ('applied', 'assessment')
       AND COALESCE(last_event_at, applied_at) <= ?
     ORDER BY COALESCE(last_event_at, applied_at) ASC
     LIMIT 10`,
    staleThresholdSec,
  );

  const followUps = staleRows.map((r) => {
    const lastAt = r.last_event_at ?? r.applied_at;
    const daysStale = Math.floor((now - lastAt) / 86400);
    return {
      id: r.id,
      company: r.company,
      role: r.role,
      status: r.status,
      days_stale: daysStale,
    };
  });

  // 4. Interviews in next 48h, plus finished interviews needing a debrief / follow-up
  const interviewRows = await db.all<{ id: number; app_id: number; company: string; start_utc: number; format: string | null; prep_enc: string | null }>(
    `SELECT i.id, i.app_id, a.company, i.start_utc, i.format, i.prep_enc
     FROM interviews i JOIN applications a ON i.app_id = a.id
     WHERE i.state = 'scheduled' AND i.start_utc >= ? AND i.start_utc <= ?
     ORDER BY i.start_utc ASC`,
    now,
    now + 48 * 3600,
  );
  const interviewsUpcoming = interviewRows.map((i) => ({
    id: i.id,
    app_id: i.app_id,
    company: i.company,
    at: i.start_utc,
    format: i.format,
    prep_ready: Boolean(i.prep_enc),
  }));

  const pastRows = await db.all<{ id: number; app_id: number; company: string; start_utc: number; debrief_enc: string | null; followup_sent: number }>(
    `SELECT i.id, i.app_id, a.company, i.start_utc, i.debrief_enc, i.followup_sent
     FROM interviews i JOIN applications a ON i.app_id = a.id
     WHERE i.state IN ('scheduled', 'done') AND i.start_utc < ?
     ORDER BY i.start_utc DESC LIMIT 20`,
    now,
  );
  const missingDebriefs = pastRows
    .filter((i) => !i.debrief_enc && now - i.start_utc <= 7 * 86400)
    .map((i) => ({ id: i.id, app_id: i.app_id, company: i.company, at: i.start_utc }));
  const interviewFollowUps = pastRows
    .filter((i) => !i.followup_sent && now - i.start_utc >= settings.interview_stale_days * 86400)
    .map((i) => ({
      id: i.app_id,
      company: i.company,
      role: null as string | null,
      status: "interview",
      days_stale: Math.floor((now - i.start_utc) / 86400),
    }));

  // 5. Pipeline status counts
  const countRows = await db.all<{ status: string; cnt: number }>(
    "SELECT status, COUNT(*) as cnt FROM applications GROUP BY status",
  );
  const pipeline: Record<string, number> = {};
  let totalApplications = 0;
  for (const r of countRows) {
    pipeline[r.status] = r.cnt;
    totalApplications += r.cnt;
  }

  // 6. Sync health
  const mailAccounts = await db.all<{
    id: number;
    email: string;
    status: string;
    last_sync_at: number | null;
  }>("SELECT id, email, status, last_sync_at FROM mail_accounts");

  const activeAccounts = mailAccounts.filter((a) => a.status === "active").length;
  const needsReauth = mailAccounts.some((a) => a.status === "needs_reauth");
  const lastSyncAt = mailAccounts.length > 0 ? Math.max(0, ...mailAccounts.map((a) => a.last_sync_at ?? 0)) : null;

  let healthSummary = "No Gmail accounts connected";
  if (needsReauth) {
    healthSummary = "Action needed: Reconnect Gmail";
  } else if (activeAccounts > 0) {
    if (lastSyncAt) {
      const minAgo = Math.max(0, Math.floor((now - lastSyncAt) / 60));
      healthSummary = minAgo < 1
        ? `Synced just now · ${activeAccounts} mailbox${activeAccounts === 1 ? "" : "es"} active`
        : `Synced ${minAgo}m ago · ${activeAccounts} mailbox${activeAccounts === 1 ? "" : "es"} active`;
    } else {
      healthSummary = `Syncing · ${activeAccounts} mailbox${activeAccounts === 1 ? "" : "es"} connected`;
    }
  }

  return {
    date: today,
    generated_at: now,
    changes_since_yesterday: changes,
    review_count: reviewCount,
    follow_ups: [...followUps, ...interviewFollowUps],
    interviews_upcoming: interviewsUpcoming,
    missing_debriefs: missingDebriefs,
    pipeline,
    total_applications: totalApplications,
    health: {
      active_mailboxes: activeAccounts,
      needs_reauth: needsReauth,
      last_sync_at: lastSyncAt,
      summary: healthSummary,
    },
  };
}
