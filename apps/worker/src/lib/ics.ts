// Minimal RFC 5545 calendar writer for the private GRU feed (Apple/Google Calendar subscribe to it).
export interface IcsEvent {
  uid: string;
  summary: string;
  /** UTC epoch seconds (timed) or an Auckland calendar day "YYYY-MM-DD" (all-day). */
  start: number | string;
  end?: number;
  description?: string;
  url?: string;
  location?: string;
  tentative?: boolean;
  alarmMinutes?: number;
  category?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const utc = (epoch: number): string => {
  const d = new Date(epoch * 1000);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
};

export const escapeText = (s: string): string => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Folds a content line at 75 octets (continuation lines start with one space). */
export function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > (out.length === 0 ? 75 : 74)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function buildIcs(events: IcsEvent[], now: number, name = "GRU"): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GRU//Job search//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    "X-WR-TIMEZONE:Pacific/Auckland",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}@gru`, `DTSTAMP:${utc(now)}`);
    if (typeof e.start === "string") {
      const d = e.start.replace(/-/g, "");
      const next = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)) + 1));
      lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`);
    } else {
      lines.push(`DTSTART:${utc(e.start)}`, `DTEND:${utc(e.end ?? e.start + 3600)}`);
    }
    lines.push(`SUMMARY:${escapeText(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.category) lines.push(`CATEGORIES:${escapeText(e.category)}`);
    lines.push(`STATUS:${e.tentative ? "TENTATIVE" : "CONFIRMED"}`);
    if (e.alarmMinutes && typeof e.start === "number") {
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(e.summary)}`, `TRIGGER:-PT${e.alarmMinutes}M`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
