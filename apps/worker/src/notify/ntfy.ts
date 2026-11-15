// ntfy push notification client (spec sections 11 and 14).
// Sends strictly CONSTANT generic strings. Never includes company names, titles, or counts.
import type { Db } from "../db/client.ts";
import { errorCode, log } from "../log/index.ts";

export type NotificationKind = "brief" | "evening" | "reauth";

export const NOTIFICATION_MESSAGES: Record<NotificationKind, { title: string; message: string; priority: number; tag: string }> = {
  brief: {
    title: "GRU",
    message: "GRU: your morning brief is ready",
    priority: 3,
    tag: "briefcase",
  },
  evening: {
    title: "GRU",
    message: "GRU: evening check-in ready",
    priority: 3,
    tag: "memo",
  },
  reauth: {
    title: "GRU Alert",
    message: "GRU: action needed",
    priority: 4,
    tag: "warning",
  },
};

export async function sendNotification(
  db: Db,
  topic: string | undefined,
  appOrigin: string,
  kind: NotificationKind,
  key: string,
  now: number,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  if (!topic || topic.trim() === "") {
    log("ntfy_skipped", { reason: "no_topic", kind });
    return false;
  }

  // Claim the key atomically (idempotent); release it if delivery fails so a later tick retries.
  const claim = await db.run("INSERT OR IGNORE INTO notifications_sent (key, sent_at) VALUES (?, ?)", key, now);
  if (claim.meta.changes !== 1) return false;
  const release = () => db.run("DELETE FROM notifications_sent WHERE key = ?", key);

  const spec = NOTIFICATION_MESSAGES[kind];
  try {
    const res = await fetchFn(`https://ntfy.sh/${topic.trim()}`, {
      method: "POST",
      headers: {
        "Title": spec.title,
        "Priority": String(spec.priority),
        "Tags": spec.tag,
        "Click": appOrigin,
      },
      body: spec.message,
    });

    if (!res.ok) {
      log("ntfy_error", { status: res.status, kind });
      await release();
      return false;
    }

    log("ntfy_sent", { kind });
    return true;
  } catch (err) {
    log("ntfy_error", { code: errorCode(err), kind });
    await release();
    return false;
  }
}
