// Pure theme-schedule logic (no DOM), shared by the app and unit tests.
// Automatic = light 09:00–18:30, dark otherwise, in Pacific/Auckland via Intl, so NZ
// daylight saving comes from the platform tz database rather than hand-written rules.

export type ThemePref = "auto" | "light" | "dark";
export type Theme = "light" | "dark";

export const SCHEDULE = { lightFrom: 9 * 60, darkFrom: 18 * 60 + 30, timeZone: "Pacific/Auckland" } as const;
export const MAX_WAIT_MS = 30 * 60 * 1000; // re-check at least every 30 min so DST shifts self-correct

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-NZ", { timeZone, hour: "numeric", minute: "numeric", hourCycle: "h23" });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Minutes since local midnight in the given IANA zone. */
export function localMinutes(date: Date, timeZone: string = SCHEDULE.timeZone): number {
  let h = 0;
  let m = 0;
  for (const p of formatter(timeZone).formatToParts(date)) {
    if (p.type === "hour") h = Number(p.value) % 24;
    else if (p.type === "minute") m = Number(p.value);
  }
  return h * 60 + m;
}

export function scheduledTheme(date: Date): Theme {
  const m = localMinutes(date);
  return m >= SCHEDULE.lightFrom && m < SCHEDULE.darkFrom ? "light" : "dark";
}

export function resolveTheme(pref: ThemePref, date: Date): Theme {
  return pref === "auto" ? scheduledTheme(date) : pref;
}

/** Milliseconds until the next 09:00 / 18:30 boundary, capped so the schedule self-corrects. */
export function msUntilNextBoundary(date: Date): number {
  const m = localMinutes(date);
  const target = m < SCHEDULE.lightFrom ? SCHEDULE.lightFrom : m < SCHEDULE.darkFrom ? SCHEDULE.darkFrom : SCHEDULE.lightFrom + 1440;
  const ms = (target - m) * 60_000 - (date.getSeconds() * 1000 + date.getMilliseconds());
  return Math.max(1000, Math.min(ms, MAX_WAIT_MS));
}

export function isThemePref(v: unknown): v is ThemePref {
  return v === "auto" || v === "light" || v === "dark";
}
