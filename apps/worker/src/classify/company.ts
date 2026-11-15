// Company extraction for linking and creating applications (spec §9, linking step 2).
import { normalizeName } from "../domain/normalize.ts";
import { domainMatches } from "./classify.ts";
import { ASSESSMENT_DOMAINS, ATS_DOMAINS, BOARD_DOMAINS, FREE_MAIL_DOMAINS, SCHEDULING_DOMAINS } from "./rules.ts";
import type { Sender } from "./types.ts";

const ROLE_WORDS =
  /\b(careers?|recruit(ment|ing|er|ers)?|talent( acquisition)?|team|hr|hiring|people( (and|&) culture)?|jobs?|no-?reply|notifications?|mailer|support|admin|graduate programme|graduates?|early careers)\b/gi;
const VIA = /\s+(via|from|@)\s+(greenhouse|lever|workday|smartrecruiters|ashby|workable|teamtailor|bamboohr|jobvite|icims|successfactors|pageup|jobadder|livehire|snaphire|recruitee)\b.*$/i;
const PLATFORM_ONLY = /^(greenhouse|lever|workday|smartrecruiters|ashby|workable|teamtailor|bamboohr|jobvite|icims|indeed|seek|linkedin|calendly|hackerrank|codility|hirevue)$/i;

export interface CompanyGuess {
  name: string;
  norm: string;
  source: "display_name" | "subject" | "domain";
  confident: boolean;
}

function fromDisplayName(name: string): string | null {
  let n = name.replace(VIA, "");
  // "Sam from Harbourline", "Sam Patel at Harbourline" (1–3 name words before from/at)
  const fromPerson = /^[\p{L}'’.-]+(?:\s[\p{L}'’.-]+){0,2}\s(?:from|at)\s(.+)$/u.exec(n);
  if (fromPerson?.[1]) n = fromPerson[1];
  n = n.replace(ROLE_WORDS, " ").replace(/[|·•,:-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!n || n.length < 2 || PLATFORM_ONLY.test(n)) return null;
  return n;
}

function fromSubject(subject: string): string | null {
  // "Harbourline has invited you to complete a coding challenge"
  const lead = /^([A-Z][\p{L}0-9&.'’-]*(?:\s+[A-Z&][\p{L}0-9&.'’-]*){0,3})\s+(?:has invited|invites|would like|is inviting)\b/u.exec(subject);
  if (lead?.[1]) return lead[1];
  const m =
    /\b(?:at|with|from|join)\s+([A-Z][\p{L}0-9&.'’-]*(?:\s+[A-Z&][\p{L}0-9&.'’-]*){0,3})/u.exec(subject) ??
    /\b(?:applying|application)\s+(?:to|for|at|with)\s+([A-Z][\p{L}0-9&.'’-]*(?:\s+[A-Z&][\p{L}0-9&.'’-]*){0,3})(?=\s*(?:[!.:,(–—-]|$))/u.exec(subject);
  const raw = m?.[1]?.trim();
  if (!raw || /^(the|our|your|a|an)$/i.test(raw)) return null;
  return raw;
}

function fromDomain(domain: string): string | null {
  if (!domain) return null;
  const platform = [...ATS_DOMAINS, ...BOARD_DOMAINS, ...ASSESSMENT_DOMAINS, ...SCHEDULING_DOMAINS, ...FREE_MAIL_DOMAINS];
  if (platform.some((d) => domainMatches(domain, d))) return null;
  const labels = domain.split(".").filter((l) => !/^(mail|email|e|jobs|careers|hr|notify|no-?reply|example|co|com|org|net|nz|au|govt|io|ac)$/i.test(l));
  return labels[labels.length - 1] ?? null;
}

export function extractCompanies(sender: Sender, subject: string): CompanyGuess[] {
  const out: CompanyGuess[] = [];
  const push = (name: string | null, source: CompanyGuess["source"], confident: boolean) => {
    if (!name) return;
    const norm = normalizeName(name);
    if (norm.length < 2 || out.some((g) => g.norm === norm)) return;
    out.push({ name: name.trim(), norm, source, confident });
  };
  push(fromDisplayName(sender.name), "display_name", true);
  push(fromSubject(subject), "subject", true);
  push(fromDomain(sender.domain), "domain", false);
  return out;
}

/** Word-boundary prefix match, so "fonterra" matches "fonterra te matapuna" but "ana" never matches "anaplan". */
export function companyMatches(appNorm: string, guessNorm: string): boolean {
  if (!appNorm || !guessNorm) return false;
  if (appNorm === guessNorm) return true;
  const [short, long] = appNorm.length < guessNorm.length ? [appNorm, guessNorm] : [guessNorm, appNorm];
  return short.length >= 4 && long.startsWith(short + " ");
}
