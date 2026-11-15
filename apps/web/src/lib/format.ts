// Dates are stored as UTC epoch seconds and shown in Ani's zone (Pacific/Auckland).
import type { Status } from "./api.ts";

export const TZ = "Pacific/Auckland";
const DAY = 86400;

const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const shortDate = new Intl.DateTimeFormat("en-NZ", { timeZone: TZ, day: "numeric", month: "short" });
const longDate = new Intl.DateTimeFormat("en-NZ", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const timeFmt = new Intl.DateTimeFormat("en-NZ", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

/** Local calendar day (YYYY-MM-DD) in Auckland. */
export const localDay = (epoch: number): string => dayKey.format(new Date(epoch * 1000));

function dayDiff(epoch: number, now: number): number {
  const a = Date.parse(localDay(epoch) + "T00:00:00Z");
  const b = Date.parse(localDay(now) + "T00:00:00Z");
  return Math.round((b - a) / (DAY * 1000));
}

export const formatShort = (epoch: number | null): string => (epoch ? shortDate.format(new Date(epoch * 1000)) : "—");
export const formatLong = (epoch: number): string => longDate.format(new Date(epoch * 1000));
export const formatTime = (epoch: number): string => timeFmt.format(new Date(epoch * 1000)).replace(" ", " ");

export function formatRelative(epoch: number | null, now = Math.floor(Date.now() / 1000)): string {
  if (!epoch) return "—";
  const d = dayDiff(epoch, now);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d > 1 && d < 7) return `${d} days ago`;
  if (d < 0 && d > -7) return d === -1 ? "Tomorrow" : `In ${-d} days`;
  return formatShort(epoch);
}

export function daysSince(epoch: number | null, now = Math.floor(Date.now() / 1000)): number {
  return epoch ? Math.max(0, dayDiff(epoch, now)) : 0;
}

export function greeting(now = new Date()): string {
  const h = Number(new Intl.DateTimeFormat("en-NZ", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(now)) % 24;
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** <input type="date"> value (YYYY-MM-DD) → epoch at 12:00 Auckland-ish (device local noon). */
export function dateInputToEpoch(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return Math.floor(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime() / 1000);
}

export const epochToDateInput = (epoch: number | null): string => (epoch ? localDay(epoch) : "");

export const STATUS_LABEL: Record<Status, string> = {
  applied: "Applied",
  assessment: "Assessment",
  interview: "Interview",
  offer: "Offer",
  accepted: "Accepted",
  declined: "Declined",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const STATUS_ORDER: Status[] = ["applied", "assessment", "interview", "offer", "accepted", "declined", "rejected", "withdrawn"];

export function eventLabel(type: string, prev: Status | null): string {
  if (type === "created") return "Application added";
  if (type.startsWith("email:")) {
    const L: Record<string, string> = {
      application_received: "Application confirmation received", assessment: "Assessment email received",
      interview_invite: "Interview invitation received", interview_update: "Interview update received",
      rejection: "Rejection email received", offer: "Offer email received",
      info_request: "Information requested by email", application_update: "Status update email received",
    };
    return L[type.slice(6)] ?? "Email received";
  }
  if (type === "interview_proposed") return "Interview details found in an email";
  if (type === "interview_scheduled") return "Interview scheduled";
  if (type === "interview_debrief") return "Interview debrief saved";
  if (type === "undo") return `Change undone${prev ? ` (was ${STATUS_LABEL[prev] ?? prev})` : ""}`;
  if (type.startsWith("status:")) {
    const to = type.slice(7) as Status;
    return `Status → ${STATUS_LABEL[to] ?? to}${prev ? ` (from ${STATUS_LABEL[prev] ?? prev})` : ""}`;
  }
  return type;
}

const partsFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
function tzOffsetMs(ms: number): number {
  const p = partsFmt.formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - ms;
}

/** <input type="datetime-local"> value interpreted as Auckland wall-clock time → UTC epoch seconds (DST-safe). */
export function localDateTimeToEpoch(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const asUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  let guess = asUtc;
  for (let i = 0; i < 2; i++) guess = asUtc - tzOffsetMs(guess);
  return Math.floor(guess / 1000);
}

/** Auckland wall-clock date+time for an epoch, formatted like a datetime-local value. */
export function epochToDateTimeInput(epoch: number): string {
  const p = partsFmt.formatToParts(new Date(epoch * 1000));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

export const formatDateTime = (epoch: number): string => `${formatShort(epoch)} ${formatTime(epoch)}`;
