// Header-only classifier (spec §9, Phase 2 rules). Deterministic and data-driven.
import { ASSESSMENT_DOMAINS, ATS_DOMAINS, BOARD_DOMAINS, NEGATIVES, RULES, SCHEDULING_DOMAINS } from "./rules.ts";
import type { Classification, MailClass, MailMeta, Sender } from "./types.ts";

const MAX_LEN = 300;
const KNOWN_DOMAINS = [...ATS_DOMAINS, ...BOARD_DOMAINS, ...ASSESSMENT_DOMAINS, ...SCHEDULING_DOMAINS];

/** Higher-impact classes win ties (spec: "ties go to the highest-impact class and are queued"). */
const IMPACT: Record<MailClass, number> = {
  offer: 9, rejection: 8, interview_update: 7, interview_invite: 6, assessment: 5, info_request: 4,
  application_update: 3, application_received: 2, recruiter_outreach: 1, alert: 0, other: -1,
};

export function parseFrom(raw: string): Sender {
  const s = raw.slice(0, MAX_LEN).trim();
  const m = /^(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(s);
  const name = (m ? m[1] ?? "" : "").replace(/^"|"$/g, "").trim();
  const address = (m ? m[2] ?? "" : /^[^\s@]+@[^\s@]+$/.test(s) ? s : "").toLowerCase();
  const domain = address.includes("@") ? (address.split("@")[1] ?? "") : "";
  return { name, address, domain };
}

/** True when `domain` is `base` or a subdomain of it (e.g. jobs-noreply.linkedin.com). */
export function domainMatches(domain: string, base: string): boolean {
  return domain === base || domain.endsWith("." + base);
}

const anyDomain = (domain: string, list: string[]) => list.some((d) => domainMatches(domain, d));

export function isForward(subject: string): boolean {
  return /^\s*(fwd?|fw)\s*:/i.test(subject);
}

export function classify(meta: MailMeta, ownAddresses: readonly string[] = []): Classification {
  const subject = meta.subject.slice(0, MAX_LEN);
  const sender = parseFrom(meta.from);
  const forwarded = isForward(subject);
  const calendar = /text\/calendar/i.test(meta.contentType);
  const promo = meta.labelIds.includes("CATEGORY_PROMOTIONS");

  if (sender.address && ownAddresses.includes(sender.address) && !forwarded) {
    return { cls: "other", confidence: 0.99, ruleId: "self", tie: false, forwarded, sender };
  }

  const scores = new Map<MailClass, { score: number; ruleId: string }>();
  for (const rule of RULES) {
    if (rule.domainRequired && !anyDomain(sender.domain, rule.domains ?? [])) continue;
    if (rule.calendar && !calendar) continue;
    const subjectHit = rule.subject ? rule.subject.some((r) => r.test(subject)) : true;
    if (!subjectHit) continue;
    let score = rule.weight;
    if (anyDomain(sender.domain, KNOWN_DOMAINS)) score += 0.1;
    const prev = scores.get(rule.cls);
    if (!prev || score > prev.score) scores.set(rule.cls, { score, ruleId: rule.id });
  }

  // A generic "update on your application" only stands when nothing more specific matched.
  if (scores.size > 1) scores.delete("application_update");

  for (const [cls, v] of scores) {
    if (cls === "alert" || cls === "other") continue;
    for (const n of NEGATIVES) if (n.subject.test(subject)) v.score -= n.penalty;
    if (promo) v.score -= 0.3;
    if (meta.listUnsubscribe && !anyDomain(sender.domain, ATS_DOMAINS)) v.score -= 0.15;
  }

  const ranked = [...scores.entries()].map(([cls, v]) => ({ cls, ...v })).sort((a, b) => b.score - a.score || IMPACT[b.cls] - IMPACT[a.cls]);
  const best = ranked[0];
  if (!best || best.score < 0.5) return { cls: "other", confidence: 0.6, ruleId: "none", tie: false, forwarded, sender };
  const second = ranked[1];
  // Compare in whole hundredths: 0.85 - 0.8 is 0.04999… in floating point.
  const gap = Math.round(best.score * 100) - Math.round((second?.score ?? 0) * 100);
  const tie = !!second && second.cls !== best.cls && gap < 5 && second.score >= 0.5;
  const top = tie && second && IMPACT[second.cls] > IMPACT[best.cls] ? second : best;
  return { cls: top.cls, confidence: Math.min(0.99, Math.round(top.score * 100) / 100), ruleId: top.ruleId, tie, forwarded, sender };
}
