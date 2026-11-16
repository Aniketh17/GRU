// Classifies a job email from the WORDS in its body (Ani, 2026-11-15: "understand by the words if it is a rejection,
// application, status change or job alert"). Deterministic, evidence-based. Returns the rule id, never the text.
import type { MailClass } from "./types.ts";

interface Rule { cls: MailClass; rule: string; w: number; re: RegExp }

const R = (cls: MailClass, rule: string, w: number, re: RegExp): Rule => ({ cls, rule, w, re });

const RULES: Rule[] = [
  // offer
  R("offer", "offer.pleased", 0.92, /\b(?:pleased|delighted|happy|thrilled|excited) to (?:offer|extend)\b/i),
  R("offer", "offer.letter", 0.9, /\b(?:letter of offer|offer of employment|employment offer|job offer|formal offer|contract of employment)\b/i),
  R("offer", "offer.like", 0.9, /\bwe(?:'d| would) like to (?:offer|extend an offer)\b/i),
  // rejection
  R("rejection", "reject.regret", 0.95, /\bwe regret to (?:inform|advise|let you know)\b|\bwe regret\b/i),
  R("rejection", "reject.decided", 0.95, /\b(?:decided|chosen|opted) (?:not )?to (?:proceed|move forward|go|continue) with (?:other|another|a different|someone)\b/i),
  R("rejection", "reject.unfortunately", 0.9, /\bunfortunately\b[^.]{0,220}\b(?:not|unable|unsuccessful|regret|decline|proceed|move forward|other candidates|filled|shortlist)/i),
  R("rejection", "reject.notprogress", 0.9, /\b(?:will not|won't|not) be (?:moving|progressing|proceeding|taking your application)\b/i),
  R("rejection", "reject.unsuccessful", 0.92, /\b(?:application|candidacy)\b[^.]{0,40}\b(?:unsuccessful|not successful|declined|not selected|not been successful)\b|\bnot been successful\b/i),
  R("rejection", "reject.filled", 0.9, /\b(?:position|role|vacancy) (?:has )?(?:now )?been filled\b/i),
  R("rejection", "reject.notshortlisted", 0.88, /\bnot (?:been )?(?:selected|shortlisted)\b/i),
  // "we chose another candidate", "we have selected someone else", "decided to progress with other applicants"
  R("rejection", "reject.chose", 0.95, /\bwe (?:have |'ve |had )?(?:chosen|chose|selected|decided on|gone with|went with|opted for|picked|appointed|offered the (?:role|position) to)\b[^.]{0,40}\b(?:another|other|a different|someone else|different|a stronger|a more experienced|an internal)\b/i),
  R("rejection", "reject.progress", 0.93, /\b(?:decided|chosen|chose|opted|elected) to (?:progress|proceed|move forward|go ahead|continue) with (?:other|another|different|a different|fewer|one of)\b/i),
  R("rejection", "reject.others", 0.9, /\b(?:other|another|different) (?:candidates?|applicants?)\b[^.]{0,80}\b(?:chosen|selected|progress|proceed|move forward|match|suit|fit|stronger|closely)/i),
  R("rejection", "reject.match", 0.9, /\bcandidates? (?:whose|who|with)\b[^.]{0,60}\b(?:more closely|better|closer)\b/i),
  R("rejection", "reject.successful", 0.92, /\b(?:successful|preferred) (?:candidate|applicant) (?:has been |was |is |have been )?(?:selected|chosen|appointed|identified|found|confirmed)\b/i),
  R("rejection", "reject.unable", 0.9, /\b(?:we are |we're |we will be |we'll be |i am |i'm )?(?:unable|not able) to (?:offer you|progress|proceed|move forward|take your application|continue)\b/i),
  R("rejection", "reject.wontprogress", 0.92, /\b(?:will not|won't|are not|aren't|cannot|can't) be (?:able to )?(?:progress|continu|proceed|mov|taking)\w* (?:with |forward with )?your (?:application|candidacy)\b/i),
  R("rejection", "reject.filled2", 0.9, /(?:\b(?:have|has)|['’]ve) (?:now )?(?:filled|appointed)\b/i),
  // interviews
  R("interview_update", "interview.changed", 0.88, /\binterview\b[^.]{0,80}\b(?:rescheduled|cancel+ed|postponed|moved to|new time|has changed)\b|\b(?:rescheduled|cancel+ed)\b[^.]{0,60}\binterview\b/i),
  R("interview_invite", "interview.invite", 0.92, /\b(?:invite|inviting|like to invite) you (?:to|for) (?:an? )?(?:\w+ ){0,2}(?:interview|chat|call|meeting|conversation|screen)/i),
  R("interview_invite", "interview.scheduled", 0.9, /\binterview (?:is |has been |will be )?(?:scheduled|confirmed|booked)\b/i),
  R("interview_invite", "interview.schedule", 0.85, /\b(?:schedule|book|arrange|set up) (?:an? |your |a )?(?:\w+ )?(?:interview|call|chat|conversation)\b/i),
  R("interview_invite", "interview.speak", 0.8, /\bwe(?:'d| would) (?:love|like) to (?:speak|chat|meet|talk) (?:with|to) you\b/i),
  R("interview_invite", "interview.slot", 0.82, /\b(?:select|choose|pick|book) (?:a |an )?(?:suitable )?(?:time|slot)\b/i),
  R("interview_invite", "interview.nextstage", 0.85, /\b(?:next|second|final|first) (?:stage|step|round)\b[^.]{0,80}\binterview/i),
  R("interview_invite", "interview.join", 0.85, /\bjoin (?:the |our |your )?(?:zoom|teams|google meet|video|webex) (?:call|meeting|interview)\b/i),
  // assessment
  R("assessment", "assess.complete", 0.9, /\bplease complete (?:the |this |our |an? )?(?:\w+ ){0,2}(?:assessment|test|challenge|questionnaire|exercise)\b/i),
  R("assessment", "assess.kind", 0.85, /\b(?:online|coding|technical|psychometric|cognitive|aptitude|skills?|video|personality|numerical|verbal) (?:assessment|test|challenge|exercise|screening)\b/i),
  R("assessment", "assess.link", 0.85, /\bassessment (?:link|invitation|platform)\b/i),
  // application received / updates
  R("application_received", "received.thanks", 0.85, /\bthank(?:s| you) for (?:applying|your application|submitting your application)\b/i),
  R("application_received", "received.we", 0.9, /\bwe(?:'ve| have) (?:successfully )?received your (?:application|cv|resume)\b/i),
  R("application_received", "received.your", 0.88, /\byour application (?:has been |was )?(?:successfully )?(?:received|submitted|sent)\b/i),
  R("application_update", "update.review", 0.75, /\byour application (?:is|has been|was) (?:currently )?(?:under review|being reviewed|reviewed|shortlisted|progress(?:ed)?|moved|forwarded)\b/i),
  R("application_update", "update.on", 0.6, /\bupdate (?:on|regarding) your application\b/i),
  // job alerts
  R("alert", "alert.matching", 0.8, /\b(?:new jobs?|jobs?) (?:matching|that match|for you|picked for you)\b/i),
  R("alert", "alert.words", 0.8, /\b(?:job alert|jobs you may like|recommended jobs|top job picks|similar jobs|jobs recommended)\b/i),
  R("alert", "alert.count", 0.8, /\b\d+ new jobs?\b/i),
  // recruiter outreach
  R("recruiter_outreach", "outreach.came", 0.8, /\bcame across your (?:profile|resume|cv|linkedin)\b/i),
  R("recruiter_outreach", "outreach.opportunity", 0.7, /\b(?:opportunity|role|position) (?:that|which) (?:i|we) (?:think|thought|believe|feel)\b/i),
];

/** Same ordering as the header classifier: the higher-impact class wins when several phrases appear. */
const IMPACT: Record<MailClass, number> = {
  offer: 9, rejection: 8, interview_update: 7, interview_invite: 6, assessment: 5, info_request: 4,
  application_update: 3, application_received: 2, recruiter_outreach: 1, alert: 0, other: -1,
};

export interface BodyClass { cls: MailClass; confidence: number; rule: string }

/**
 * @param jobLinks number of distinct job-posting links found in the email (a digest has several)
 */
export function classifyBody(text: string, jobLinks = 0): BodyClass | null {
  const head = text.replace(/[’‘`´]/g, "'").replace(/\s+/g, " ").slice(0, 4000);
  const hits: BodyClass[] = [];
  for (const r of RULES) if (r.re.test(head)) hits.push({ cls: r.cls, confidence: r.w, rule: r.rule });
  if (jobLinks >= 3) hits.push({ cls: "alert", confidence: 0.9, rule: "alert.links" });
  if (hits.length === 0) return null;
  // A digest of many jobs is an alert even if it says "thanks for applying" in a footer.
  const digest = hits.find((h) => h.rule === "alert.links");
  if (digest) return digest;
  hits.sort((a, b) => IMPACT[b.cls] - IMPACT[a.cls] || b.confidence - a.confidence);
  return hits[0] as BodyClass;
}
