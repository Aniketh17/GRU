// Job title (position) and application source from email headers only (subject + sender domain).
// Conservative: returns null unless the subject clearly states a role. Never reads message bodies.
import { domainMatches } from "./classify.ts";

const TAIL = String.raw`(?:\s+(?:position|role|opportunity|vacancy|job|posting)\b|\s+(?:at|with|@|for)\s+|\s[-–—|:]\s|\s*[(\[,!.?]|\s*$)`;
const CORE = String.raw`(?:the\s+|our\s+|a\s+|an\s+)?(.{3,90}?)`;

const PATTERNS: RegExp[] = [
  // LinkedIn: "Your application to Graduate Engineer at Acme"
  new RegExp(String.raw`^your application to\s+${CORE}\s+at\s+.+$`, "i"),
  // "application (was) submitted/sent/received for X"
  new RegExp(String.raw`\bapplication\s+(?:was\s+|has been\s+)?(?:submitted|sent|received|confirmed)\s+for\s+${CORE}${TAIL}`, "i"),
  // "Thank you for applying for the X position", "your application for X"
  new RegExp(String.raw`\b(?:applying|application|applied)\s+for\s+${CORE}${TAIL}`, "i"),
  // "Application received: X - Auckland"
  new RegExp(String.raw`\bapplication\s+(?:received|submitted|confirmation)\s*[:–—-]\s*(.{3,90})$`, "i"),
  // "the position of X", "the role of X"
  new RegExp(String.raw`\b(?:position|role)\s+of\s+(?:an?\s+|the\s+)?(.{3,90}?)(?:\s+(?:at|with)\s+|\s[-–—|:]\s|[,.!?(\[]|\s*$)`, "i"),
  // "for the X position/role"
  new RegExp(String.raw`\bfor\s+the\s+(.{3,90}?)\s+(?:position|role|vacancy|opportunity)\b`, "i"),
  // "X position at Acme" / "X role with Acme"
  new RegExp(String.raw`^(?:re:\s*)?(?:your\s+)?(.{3,80}?)\s+(?:position|role)\s+(?:at|with)\s+`, "i"),
  // "Interview for X", "Assessment for X"
  new RegExp(String.raw`\b(?:interview|assessment|screening|offer)\s+(?:for|regarding)\s+${CORE}${TAIL}`, "i"),
];

const NOT_A_ROLE = /^(the|your|our|this|a|an|you|us|it|jobs?|work|roles?|positions?|more|update|status)$/i;

export function cleanRole(raw: string): string | null {
  let r = raw
    .replace(/[“”"‘’]/g, "")
    .replace(/\s*\((?:ref|req|id|job|#)[^)]*\)\s*$/i, "")
    .replace(/\s*[-–—|]\s*(?:ref|req|job id)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  r = r.replace(/^(?:the\s+)?(?:position|role|post)\s+of\s+(?:an?\s+|the\s+)?/i, "");
  r = r.replace(/\s+(?:at|with|@)\s+[^,]{2,60}$/i, "").trim(); // never keep the company in the title
  r = (r.split(/\s[-–—|]\s/)[0] ?? r).replace(/^(?:the|our)\s+/i, "").trim();
  if (r.length < 3 || r.length > 90 || !/\p{L}/u.test(r) || NOT_A_ROLE.test(r)) return null;
  if (/\b(application|applying|apply|thank|received|submitted|confirmation)\b/i.test(r)) return null;
  return r.charAt(0).toUpperCase() + r.slice(1);
}

export function extractRole(subject: string): string | null {
  const s = subject.replace(/^\s*(?:re|fw|fwd):\s*/i, "").trim();
  for (const re of PATTERNS) {
    const m = re.exec(s);
    const role = m?.[1] ? cleanRole(m[1]) : null;
    if (role) return role;
  }
  return null;
}

/** Where the application came from, judged by the sender's domain. "email" = a direct employer/ATS email. */
export function sourceForDomain(domain: string): "seek" | "linkedin" | "other" | "email" {
  if (!domain) return "email";
  if (domainMatches(domain, "seek.co.nz") || domainMatches(domain, "seek.com.au") || /(^|\.)seek\./i.test(domain)) return "seek";
  if (domainMatches(domain, "linkedin.com")) return "linkedin";
  if (["indeed.com", "trademe.co.nz", "jora.com", "glassdoor.com", "employmenthero.com"].some((d) => domainMatches(domain, d))) return "other";
  return "email";
}
