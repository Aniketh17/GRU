// Recruiter / hiring-contact detection from the sender header: a real person's name and address, never a system or no-reply sender.
import { domainMatches } from "./classify.ts";
import { ASSESSMENT_DOMAINS, ATS_DOMAINS, BOARD_DOMAINS, SCHEDULING_DOMAINS } from "./rules.ts";
import type { Sender } from "./types.ts";

const SYSTEM_LOCAL = /^(?:no-?reply|do-?not-?reply|donotreply|notifications?|mailer|bounce|support|info|jobs?|careers?|recruit(?:ment|ing)?|talent|hello|hi|admin|team|hr|alerts?|updates?|enquir(?:y|ies)|contact|apply|applications?|hiring|people|noreply\+.*)$/i;
const ROLE_WORDS = /\b(?:careers?|recruit(?:ment|ing|er|ers)?|talent|team|hr|hiring|people|jobs?|notifications?|support|admin|graduate programme|early careers|acquisition|culture)\b/i;
const SYSTEM_DOMAINS = [...ATS_DOMAINS, ...BOARD_DOMAINS, ...ASSESSMENT_DOMAINS, ...SCHEDULING_DOMAINS];

export interface Person { name: string; address: string }

export function personFromSender(s: Sender): Person | null {
  if (!s.address || !s.name) return null;
  const local = s.address.split("@")[0] ?? "";
  if (SYSTEM_LOCAL.test(local)) return null;
  if (SYSTEM_DOMAINS.some((d) => domainMatches(s.domain, d))) return null;
  // "Sam Patel from Harbourline", "Sam Patel | Acme" -> "Sam Patel"
  const name = s.name.replace(/\s+(?:from|at|\||-|–|—)\s+.*$/i, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (!/^\p{Lu}[\p{L}'’.-]+(?: \p{Lu}[\p{L}'’.-]+){1,2}$/u.test(name)) return null;
  if (ROLE_WORDS.test(name)) return null;
  return { name, address: s.address.toLowerCase() };
}
