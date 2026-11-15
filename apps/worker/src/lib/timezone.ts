// Timezone and date helpers for Pacific/Auckland.
// Computes local date string (YYYY-MM-DD) and minutes from midnight using Intl.DateTimeFormat.

export const AUCKLAND_TZ = "Pacific/Auckland";

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: AUCKLAND_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("en-NZ", {
  timeZone: AUCKLAND_TZ,
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

/** Formats a Unix timestamp (seconds) to local Auckland YYYY-MM-DD */
export function aucklandDate(nowSec: number): string {
  const d = new Date(nowSec * 1000);
  return dateFormatter.format(d);
}

/** Returns minutes from local midnight for Auckland */
export function aucklandMinutes(nowSec: number): number {
  const d = new Date(nowSec * 1000);
  let h = 0;
  let m = 0;
  for (const p of timeFormatter.formatToParts(d)) {
    if (p.type === "hour") h = Number(p.value) % 24;
    else if (p.type === "minute") m = Number(p.value);
  }
  return h * 60 + m;
}

/** Parses "HH:mm" into minutes from midnight. Default "08:30" -> 510 */
export function parseTimeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  if (h === undefined || m === undefined || isNaN(h) || isNaN(m)) return 8 * 60 + 30;
  return h * 60 + m;
}
