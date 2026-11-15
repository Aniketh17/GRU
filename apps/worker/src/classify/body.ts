// Fact extraction from the text of a job-application email: position, interview time, meeting link.
// Pure functions. Conservative: when unsure they return nothing, and Ani confirms anything time-related.
import { decodeEntities } from "../gmail/body.ts";
import { aucklandToEpoch } from "../lib/when.ts";
import { cleanRole, extractRole } from "./role.ts";

// ---------------------------------------------------------------- role
const LABEL = /^(?:job title|position title|position applied for|position|role|vacancy|job|applied for)\s*[:\-–]\s*(.{3,90})$/i;

export function extractRoleFromBody(text: string): string | null {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean).slice(0, 120);
  for (const l of lines) {
    const m = LABEL.exec(l);
    const role = m?.[1] ? cleanRole(m[1]) : null;
    if (role) return role;
  }
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).slice(0, 60);
  for (const s of sentences) {
    const role = extractRole(s);
    if (role) return role;
  }
  return null;
}

// ---------------------------------------------------------------- meeting link
export type LinkKind = "Zoom" | "Teams" | "Google Meet" | "Webex" | "Whereby" | "GoTo" | "Video interview";
const END = String.raw`[^\s"'<>)\]]`;
const LINKS: [RegExp, LinkKind][] = [
  [new RegExp(String.raw`https?://(?:[\w-]+\.)?zoom\.us/(?:j|my|s|w)/${END}+`, "i"), "Zoom"],
  [new RegExp(String.raw`https?://teams\.microsoft\.com/l/meetup-join/${END}+`, "i"), "Teams"],
  [new RegExp(String.raw`https?://teams\.live\.com/meet/${END}+`, "i"), "Teams"],
  [new RegExp(String.raw`https?://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}${END}*`, "i"), "Google Meet"],
  [new RegExp(String.raw`https?://(?:[\w-]+\.)?webex\.com/${END}*(?:meet|join)${END}*`, "i"), "Webex"],
  [new RegExp(String.raw`https?://(?:[\w-]+\.)?whereby\.com/${END}+`, "i"), "Whereby"],
  [new RegExp(String.raw`https?://(?:app\.)?goto(?:meeting)?\.com/${END}+`, "i"), "GoTo"],
  [new RegExp(String.raw`https?://(?:[\w-]+\.)?(?:hirevue|myinterview|modernhire|sparkhire)\.com/${END}+`, "i"), "Video interview"],
];

/** Only well-known meeting/video-interview hosts are ever returned, never tracking or unsubscribe links. */
export function extractMeetingLink(text: string, html: string): { url: string; kind: LinkKind } | null {
  const haystacks = [decodeEntities(html), text];
  for (const hay of haystacks) {
    for (const [re, kind] of LINKS) {
      const m = re.exec(hay);
      if (m) {
        const url = m[0].replace(/[.,;:!?]+$/, "");
        if (url.length <= 500) return { url, kind };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- interview time
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MON = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const DATE_DM = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?${MON}\b\.?,?(?:\s+(\d{4}))?`, "gi");
const DATE_MD = new RegExp(String.raw`\b${MON}\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?![\d:])(?:,?\s+(\d{4}))?`, "gi");
const DATE_NUM = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
const TIME12 = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i;
const TIME24 = /\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*(?:am|pm|a\.m\.|p\.m\.))/i;
const NZ_TZ = /\b(NZDT|NZST|NZT|Auckland|New Zealand|Pacific\/Auckland)\b/i;
const FOREIGN_TZ = /\b(UTC|GMT|PST|PDT|MST|MDT|CST|CDT|EST|EDT|AEST|AEDT|ACST|AWST|BST|CET|CEST|IST|SGT|JST|HKT)\b|\b(?:GMT|UTC)\s?[+-]\d/;

export interface TimeCandidates {
  /** Distinct future interview times (UTC epoch seconds), assuming Auckland time unless the text says otherwise. */
  times: number[];
  /** A candidate was skipped because it was stated in another time zone. */
  foreign: boolean;
}

export interface ScanOptions {
  /** Interview times need a clock time; deadlines usually don't ("by 20 November"). */
  requireTime?: boolean;
  /** Hour (Auckland) used when a date has no time. */
  defaultHour?: number;
  /** How far ahead a date may be, in days. */
  horizonDays?: number;
}

export function extractInterviewTimes(text: string, refSec: number): TimeCandidates {
  return scanDates(text, refSec, {});
}

export function scanDates(text: string, refSec: number, opts: ScanOptions = {}): TimeCandidates {
  const requireTime = opts.requireTime ?? true;
  const defaultHour = opts.defaultHour ?? 9;
  const horizon = (opts.horizonDays ?? 120) * 86400;
  const flat = text.replace(/\s+/g, " ");
  const ref = new Date(refSec * 1000);
  const refYear = ref.getUTCFullYear();
  const found = new Set<number>();
  let foreign = false;

  const consider = (index: number, length: number, d: number, m: number, yearIn: number | null) => {
    if (d < 1 || d > 31 || m < 1 || m > 12) return;
    const window = flat.slice(Math.max(0, index - 40), index + length + 90);
    let h: number | null = null;
    let min = 0;
    const t12 = TIME12.exec(window);
    if (t12) {
      h = (Number(t12[1]) % 12) + (/^p/i.test(t12[3] as string) ? 12 : 0);
      min = Number(t12[2] ?? 0);
    } else {
      const t24 = TIME24.exec(window);
      if (t24) { h = Number(t24[1]); min = Number(t24[2]); }
    }
    if (h === null && requireTime) return;
    if (Number(t12?.[1] ?? 1) > 12) return;
    const hour = h ?? defaultHour;
    if (FOREIGN_TZ.test(window) && !NZ_TZ.test(window)) { foreign = true; return; }
    let year = yearIn ?? refYear;
    let epoch = aucklandToEpoch(year, m, d, hour, min);
    if (yearIn === null && epoch < refSec - 86400) { year += 1; epoch = aucklandToEpoch(year, m, d, hour, min); }
    if (epoch >= refSec - 6 * 3600 && epoch <= refSec + horizon) found.add(epoch);
  };

  for (const m of flat.matchAll(DATE_DM)) consider(m.index ?? 0, m[0].length, Number(m[1]), MONTHS.indexOf((m[2] as string).slice(0, 3).toLowerCase()) + 1, m[3] ? Number(m[3]) : null);
  for (const m of flat.matchAll(DATE_MD)) consider(m.index ?? 0, m[0].length, Number(m[2]), MONTHS.indexOf((m[1] as string).slice(0, 3).toLowerCase()) + 1, m[3] ? Number(m[3]) : null);
  for (const m of flat.matchAll(DATE_NUM)) consider(m.index ?? 0, m[0].length, Number(m[1]), Number(m[2]), Number(m[3]));
  return { times: [...found].sort((a, b) => a - b).slice(0, 4), foreign };
}
