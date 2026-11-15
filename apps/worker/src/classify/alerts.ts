// Pulls individual vacancies out of a job-alert email (Seek, LinkedIn, Indeed, Trade Me, others): title, company, location, link.
// Works on the email's HTML links plus the text around them. Conservative: only links that look like a job posting.
import { decodeEntities, htmlToText } from "../gmail/body.ts";

export interface Vacancy {
  title: string;
  company: string | null;
  location: string | null;
  url: string;
  source: string;
}

interface Board { source: string; test: RegExp; canon: (m: RegExpExecArray) => string }

const BOARDS: Board[] = [
  { source: "seek", test: /https?:\/\/(?:[\w-]+\.)?seek\.(?:co\.nz|com\.au|com)\/job\/(\d{6,})/i, canon: (m) => `https://www.seek.co.nz/job/${m[1]}` },
  { source: "linkedin", test: /https?:\/\/(?:[\w-]+\.)?linkedin\.com\/(?:comm\/)?jobs\/view\/(?:[\w-]*?-)?(\d{6,})/i, canon: (m) => `https://www.linkedin.com/jobs/view/${m[1]}` },
  { source: "indeed", test: /https?:\/\/(?:[\w-]+\.)?indeed\.com\/(?:[\w/]*)?(?:viewjob|rc\/clk|pagead\/clk)[^"'\s]*[?&]jk=([0-9a-f]{8,})/i, canon: (m) => `https://www.indeed.com/viewjob?jk=${m[1]}` },
  { source: "trademe", test: /https?:\/\/(?:www\.)?trademe\.co\.nz\/a\/jobs\/[\w\-/]*?listing\/(\d{6,})/i, canon: (m) => `https://www.trademe.co.nz/a/jobs/listing/${m[1]}` },
  { source: "jora", test: /https?:\/\/(?:[\w-]+\.)?jora\.com\/job\/([\w-]{8,})/i, canon: (m) => `https://nz.jora.com/job/${m[1]}` },
];

const GENERIC_TEXT = /^(view|apply|see|easy apply|view job|apply now|more|unsubscribe|save|open|read more|learn more|view all|see all|jobs?|manage|settings|new)\b/i;
const NOISE_LINE = /^(apply|easy apply|view job|save|promoted|new|actively recruiting|be an early applicant|full[- ]time|part[- ]time|contract|casual|permanent|hybrid|remote|on-?site|\$|nz\$|salary|\d+\s*(?:minutes?|hours?|days?|weeks?) ago|\d+ (?:applicants?|connections?)|you may also|jobs? (?:recommended|for you)|see (?:all|more))/i;

function matchBoard(href: string): { source: string; url: string } | null {
  const candidates = [href];
  try { candidates.push(decodeURIComponent(href)); } catch { /* keep raw only */ }
  for (const h of candidates) {
    for (const b of BOARDS) {
      const m = b.test.exec(h);
      if (m) return { source: b.source, url: b.canon(m) };
    }
  }
  return null;
}

const ANCHOR = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

/** Distinct job-posting links in an email (used to recognise a digest). */
export function countJobLinks(html: string): number {
  const seen = new Set<string>();
  for (const m of html.matchAll(ANCHOR)) {
    const b = matchBoard(decodeEntities(m[1] as string));
    if (b) seen.add(b.url);
  }
  return seen.size;
}

function splitCompanyLocation(line: string): { company: string; location: string | null } {
  const parts = line.split(/\s[·•|]\s/);
  if (parts.length >= 2) return { company: (parts[0] as string).trim(), location: parts.slice(1).join(", ").trim() || null };
  return { company: line.trim(), location: null };
}

export function extractVacancies(html: string, max = 15): Vacancy[] {
  const byUrl = new Map<string, { source: string; titles: string[] }>();
  for (const m of html.matchAll(ANCHOR)) {
    const b = matchBoard(decodeEntities(m[1] as string));
    if (!b) continue;
    const text = htmlToText(m[2] as string).replace(/\s+/g, " ").trim();
    const entry = byUrl.get(b.url) ?? { source: b.source, titles: [] };
    if (text.length >= 4 && text.length <= 120 && !GENERIC_TEXT.test(text)) entry.titles.push(text);
    byUrl.set(b.url, entry);
  }
  const lines = htmlToText(html, { cells: true }).split("\n").map((l) => l.trim()).filter(Boolean);
  const out: Vacancy[] = [];
  for (const [url, { source, titles }] of byUrl) {
    const title = titles.sort((a, b) => b.length - a.length)[0];
    if (!title) continue;
    let company: string | null = null;
    let location: string | null = null;
    const idx = lines.findIndex((l) => l === title || l.startsWith(title));
    if (idx >= 0) {
      const next = lines.slice(idx + 1, idx + 5).filter((l) => l.length >= 2 && l.length <= 90 && !NOISE_LINE.test(l) && l !== title);
      const first = next[0];
      if (first) {
        const cl = splitCompanyLocation(first);
        company = cl.company;
        location = cl.location ?? next[1] ?? null;
      }
    }
    out.push({ title, company, location, url, source });
    if (out.length >= max) break;
  }
  return out;
}
