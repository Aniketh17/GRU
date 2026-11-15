// Deadlines stated in job emails ("complete the assessment by 20 November", "please respond by Friday 5pm").
// Dates only: the sentence is never stored. Kinds map to what the user needs to do.
import { scanDates } from "./body.ts";
import type { MailClass } from "./types.ts";

export type DeadlineKind = "assessment" | "offer_reply" | "interview_reply" | "other";

const CUE = /\b(?:by|before|until|no later than|deadline|due(?: date)?|expires?|closes?|respond by|reply by|complete(?:d)? by|confirm by|within)\b/i;
const WITHIN = /\bwithin (\d{1,2}) (days?|hours?)\b/i;

function kindFor(cls: MailClass): DeadlineKind | null {
  if (cls === "assessment") return "assessment";
  if (cls === "offer") return "offer_reply";
  if (cls === "interview_invite" || cls === "interview_update") return "interview_reply";
  if (cls === "application_update" || cls === "info_request") return "other";
  return null;
}

export function extractDeadlines(text: string, refSec: number, cls: MailClass): { at: number; kind: DeadlineKind }[] {
  const kind = kindFor(cls);
  if (!kind) return [];
  const found = new Map<number, DeadlineKind>();
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).slice(0, 80);
  for (const s of sentences) {
    if (!CUE.test(s)) continue;
    const within = WITHIN.exec(s);
    if (within && (kind === "assessment" || kind === "offer_reply")) {
      const n = Number(within[1]);
      const at = refSec + n * (within[2]?.startsWith("hour") ? 3600 : 86400);
      found.set(at - (at % 900), kind);
      continue;
    }
    const dates = scanDates(s, refSec, { requireTime: false, defaultHour: 17, horizonDays: 90 }).times;
    if (dates[0]) found.set(dates[0], kind);
  }
  return [...found].map(([at, k]) => ({ at, kind: k })).slice(0, 2);
}
