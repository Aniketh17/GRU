// Synthetic, header-only email dataset for classifier/decision evaluation (Phase 2 rev 2 §9).
// Deterministic (seeded), fictional people/companies (.example domains); public ATS and job-board
// domains only. Never contains real personal data. Output files (eval/generated/) are git-ignored.
import type { Status } from "../../../apps/worker/src/domain/applications.ts";
import type { MailClass, MailMeta } from "../../../apps/worker/src/classify/types.ts";
import type { Decision } from "../../../apps/worker/src/classify/decide.ts";

export type Category =
  | "confirmation" | "rejection" | "interview_invite" | "scheduling_change" | "offer" | "recruiter_outreach"
  | "info_request" | "assessment" | "job_alert" | "newsletter" | "personal" | "look_alike" | "duplicate"
  | "forwarded" | "ambiguous" | "conflicting";

export type Ctx = "applied" | "assessment" | "interview" | "offer" | "terminal" | "new" | "ambiguous" | "none";

export interface SyntheticEmail {
  meta: MailMeta;
  category: Category;
  ctx: Ctx;
  company: string | null;
  expectedClass: MailClass;
  expectedDecision: Decision["action"];
  expectedSuggested?: Status | null;
  split: "tune" | "heldout";
  /** Synthetic vacancy text for job alerts (used from Phase 5; never fetched in Phase 2). */
  body?: string;
}

export interface SeededApp {
  id: number;
  company: string;
  status: Status;
}

/** Applications that exist before the synthetic mail arrives (linking context). */
export const SEEDED_APPS: SeededApp[] = [
  { id: 1, company: "Harbourline", status: "applied" },
  { id: 2, company: "Kōwhai Labs", status: "applied" },
  { id: 3, company: "Northgate Health", status: "applied" },
  { id: 4, company: "Pūriri Systems", status: "assessment" },
  { id: 5, company: "Tidewater Analytics", status: "interview" },
  { id: 6, company: "Southern Cross Freight", status: "offer" },
  { id: 7, company: "Mātai Insights", status: "rejected" },
  { id: 8, company: "Ākau Data", status: "applied" },
  { id: 9, company: "Ākau Data Labs", status: "applied" },
];

const BY_CTX: Record<Exclude<Ctx, "none">, string[]> = {
  applied: ["Harbourline", "Kōwhai Labs", "Northgate Health"],
  assessment: ["Pūriri Systems"],
  interview: ["Tidewater Analytics"],
  offer: ["Southern Cross Freight"],
  terminal: ["Mātai Insights"],
  new: ["Kererū Cloud", "Tūī Software", "Rimu Digital", "Wētā Analytics", "Kauri Systems", "Moana Payments"],
  ambiguous: ["Ākau Data"],
};

const ROLES = ["Graduate Software Engineer", "Junior Backend Developer", "AI Platform Intern", "Graduate Data Analyst", "Junior ML Engineer", "Software Engineering Intern"];
const PEOPLE = ["Sam Patel", "Mere Tane", "Jordan Lee", "Priya Nair", "Tom Fischer", "Hana Kim"];
const ATS = ["greenhouse.io", "lever.co", "myworkdayjobs.com", "smartrecruiters.com", "workable.com", "jobadder.com", "snaphire.com"];

const slug = (c: string) => c.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


type Expect = { decision: Decision["action"]; suggested?: Status | null };

interface Template {
  category: Category;
  cls: MailClass;
  ctxs: Ctx[];
  subject: (c: string, role: string, person: string) => string;
  from: (c: string, person: string, ats: string) => string;
  expect: (ctx: Ctx) => Expect;
  listUnsubscribe?: boolean;
  labels?: string[];
  contentType?: string;
  alertBody?: boolean;
}

const LINKED: Ctx[] = ["applied", "assessment", "interview", "offer", "terminal"];
const r = (suggested: Status | null = null): Expect => ({ decision: "review", suggested });

const receivedExpect = (ctx: Ctx): Expect => (ctx === "new" ? { decision: "create_application" } : ctx === "ambiguous" ? r() : { decision: "link_only" });
const statusExpect = (target: Status) => (ctx: Ctx): Expect => {
  const order: Record<string, number> = { applied: 0, assessment: 1, interview: 2, offer: 3 };
  if (ctx === "new" || ctx === "ambiguous") return r(ctx === "new" ? target : null);
  if (ctx === "terminal") return target === "rejected" ? { decision: "link_only" } : r(null);
  const cur = order[ctx] ?? 0;
  const tgt = target === "rejected" ? 99 : (order[target] ?? 0);
  if (cur === tgt) return { decision: "link_only" };
  if (tgt < cur) return r(null); // would move backwards: conflict → review
  if (target === "assessment") return { decision: "auto_status" };
  return r(target);
};

/** Templates the rules were written against (tuning set). */
const TUNING_TEMPLATES: Template[] = [
  // ---- Confirmations (application_received)
  { category: "confirmation", cls: "application_received", ctxs: [...LINKED, "new", "ambiguous"], subject: (c) => `Thank you for applying to ${c}`, from: (c, _p, ats) => `${c} Careers <no-reply@${ats}>`, expect: receivedExpect },
  { category: "confirmation", cls: "application_received", ctxs: ["applied", "new"], subject: (_c, role) => `Application received – ${role}`, from: (c) => `${c} Recruitment Team <careers@${slug(c)}.example>`, expect: receivedExpect },
  { category: "confirmation", cls: "application_received", ctxs: ["applied", "new", "interview"], subject: (c) => `Your application to ${c} has been received`, from: (c) => `${c} Talent <talent@${slug(c)}.example>`, expect: receivedExpect },
  { category: "confirmation", cls: "application_received", ctxs: ["new"], subject: (_c, role) => `Thanks for applying for the ${role} role`, from: (c, _p, ats) => `${c} via Greenhouse <no-reply@${ats}>`, expect: receivedExpect },
  { category: "confirmation", cls: "application_received", ctxs: ["none"], subject: () => "Thank you for your application", from: (_c, _p, ats) => `Recruitment Team <no-reply@${ats}>`, expect: () => r() },

  // ---- Assessments
  { category: "assessment", cls: "assessment", ctxs: ["applied", "assessment", "interview", "new"], subject: (c) => `${c} has invited you to complete a coding challenge`, from: () => "HackerRank <support@hackerrank.com>", expect: statusExpect("assessment") },
  { category: "assessment", cls: "assessment", ctxs: ["applied", "new"], subject: (_c, role) => `Next step: online assessment for ${role}`, from: (c, _p, ats) => `${c} Careers <careers@${ats}>`, expect: statusExpect("assessment") },

  // ---- Interview invitations
  { category: "interview_invite", cls: "interview_invite", ctxs: ["applied", "assessment", "interview", "offer", "terminal", "new"], subject: (c) => `Interview invitation – ${c}`, from: (c, p) => `${p} from ${c} <${slug(p)}@${slug(c)}.example>`, expect: statusExpect("interview") },
  { category: "interview_invite", cls: "interview_invite", ctxs: ["applied", "assessment"], subject: (_c, role) => `We'd like to invite you to interview for ${role}`, from: (c, _p, ats) => `${c} Talent <talent@${ats}>`, expect: statusExpect("interview") },
  { category: "interview_invite", cls: "interview_invite", ctxs: ["applied"], subject: (c) => `Invitation: Interview with ${c} @ Tue 18 Nov 2pm`, from: (c, p) => `${p} <${slug(p)}@${slug(c)}.example>`, contentType: "text/calendar; method=REQUEST", expect: statusExpect("interview") },
  { category: "interview_invite", cls: "interview_invite", ctxs: ["applied", "new"], subject: (c) => `Schedule your interview with ${c}`, from: () => "Calendly <notifications@calendly.com>", expect: statusExpect("interview") },

  // ---- Scheduling changes
  { category: "scheduling_change", cls: "interview_update", ctxs: ["interview", "new"], subject: (c) => `Interview rescheduled – ${c}`, from: (c, p) => `${p} from ${c} <${slug(p)}@${slug(c)}.example>`, expect: () => r() },
  { category: "scheduling_change", cls: "interview_update", ctxs: ["interview"], subject: (c) => `Updated invitation: Interview with ${c} @ Thu 20 Nov 10am`, from: (c, p) => `${p} <${slug(p)}@${slug(c)}.example>`, contentType: "text/calendar; method=REQUEST", expect: () => r() },
  { category: "scheduling_change", cls: "interview_update", ctxs: ["interview"], subject: (c) => `Interview cancelled – ${c}`, from: (c, _p, ats) => `${c} Talent <talent@${ats}>`, expect: () => r() },

  // ---- Rejections
  { category: "rejection", cls: "rejection", ctxs: ["applied", "assessment", "interview", "terminal", "new"], subject: (c) => `Your application to ${c} – unfortunately`, from: (c, _p, ats) => `${c} Careers <no-reply@${ats}>`, expect: statusExpect("rejected") },
  { category: "rejection", cls: "rejection", ctxs: ["applied", "interview"], subject: (_c, role) => `${role}: we will not be moving forward`, from: (c) => `${c} Recruitment <recruitment@${slug(c)}.example>`, expect: statusExpect("rejected") },
  { category: "rejection", cls: "rejection", ctxs: ["applied"], subject: (_c, role) => `Application unsuccessful – ${role}`, from: (c, _p, ats) => `${c} <jobs@${ats}>`, expect: statusExpect("rejected") },
  { category: "rejection", cls: "rejection", ctxs: ["offer"], subject: (c) => `${c}: the position has been filled`, from: (c) => `${c} HR <hr@${slug(c)}.example>`, expect: statusExpect("rejected") },

  // ---- Offers and offer updates
  { category: "offer", cls: "offer", ctxs: ["interview", "applied", "offer", "terminal", "new"], subject: (c) => `Offer of employment – ${c}`, from: (c, p) => `${p} from ${c} <${slug(p)}@${slug(c)}.example>`, expect: statusExpect("offer") },
  { category: "offer", cls: "offer", ctxs: ["offer"], subject: (_c, role) => `Updated offer – ${role}`, from: (c) => `${c} People & Culture <people@${slug(c)}.example>`, expect: statusExpect("offer") },
  { category: "offer", cls: "offer", ctxs: ["offer", "interview"], subject: () => "Your offer letter and next steps", from: (c, _p, ats) => `${c} Careers <careers@${ats}>`, expect: statusExpect("offer") },

  // ---- Recruiter outreach, information requests
  { category: "recruiter_outreach", cls: "recruiter_outreach", ctxs: ["none"], subject: () => "I came across your profile – graduate developer role", from: (_c, p) => `${p} <${slug(p)}@talentbridge.example>`, expect: () => r() },
  { category: "recruiter_outreach", cls: "recruiter_outreach", ctxs: ["none"], subject: () => "Are you open to a new opportunity in Auckland?", from: (_c, p) => `${p} <${slug(p)}@peoplefirstrecruitment.example>`, expect: () => r() },
  { category: "info_request", cls: "info_request", ctxs: ["applied", "new"], subject: (c) => `Action required: additional information needed for ${c}`, from: (c, _p, ats) => `${c} Careers <careers@${ats}>`, expect: () => r() },
  { category: "info_request", cls: "info_request", ctxs: ["interview"], subject: () => "Reference check request", from: (c, p) => `${p} from ${c} <${slug(p)}@${slug(c)}.example>`, expect: () => r() },
  { category: "info_request", cls: "info_request", ctxs: ["applied"], subject: () => "Please provide your right to work documents", from: (c) => `${c} HR <hr@${slug(c)}.example>`, expect: () => r() },

  // ---- Job alerts (various board styles) and newsletters
  { category: "job_alert", cls: "alert", ctxs: ["none"], subject: (_c, role) => `${role} at Moana Payments could be a match`, from: () => "Indeed <donotreply@match.indeed.com>", listUnsubscribe: true, expect: () => ({ decision: "alert" }), alertBody: true },
  { category: "job_alert", cls: "alert", ctxs: ["none"], subject: () => "21 new software engineering, intern jobs in Auckland", from: () => "Indeed <alert@indeed.com>", listUnsubscribe: true, expect: () => ({ decision: "alert" }), alertBody: true },
  { category: "job_alert", cls: "alert", ctxs: ["none"], subject: () => "Alex, Jobs Hiring Now!", from: () => "Employment Hero <jobs@employmenthero.com>", listUnsubscribe: true, labels: ["CATEGORY_PROMOTIONS"], expect: () => ({ decision: "alert" }), alertBody: true },
  { category: "job_alert", cls: "alert", ctxs: ["none"], subject: () => "New jobs for you: Graduate Developer", from: () => "SEEK <noreply@s.seek.co.nz>", listUnsubscribe: true, expect: () => ({ decision: "alert" }), alertBody: true },
  { category: "job_alert", cls: "alert", ctxs: ["none"], subject: () => "Be an early applicant: 5 new roles match your saved search", from: () => "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>", listUnsubscribe: true, expect: () => ({ decision: "alert" }), alertBody: true },
  { category: "newsletter", cls: "other", ctxs: ["none"], subject: () => "Your weekly tech digest: 10 stories", from: () => "Byte Weekly <news@byteweekly.example>", listUnsubscribe: true, labels: ["CATEGORY_PROMOTIONS"], expect: () => ({ decision: "ignore" }) },
  { category: "newsletter", cls: "other", ctxs: ["none"], subject: () => "LinkedIn: you appeared in 9 searches this week", from: () => "LinkedIn <notifications-noreply@linkedin.com>", listUnsubscribe: true, expect: () => ({ decision: "ignore" }) },

  // ---- Unrelated personal mail
  { category: "personal", cls: "other", ctxs: ["none"], subject: () => "Dinner on Friday?", from: (_c, p) => `${p} <${slug(p)}@gmail.com>`, expect: () => ({ decision: "ignore" }) },
  { category: "personal", cls: "other", ctxs: ["none"], subject: () => "Your trip receipt", from: () => "RideShare <receipts@rideshare.example>", expect: () => ({ decision: "ignore" }) },
  { category: "personal", cls: "other", ctxs: ["none"], subject: () => "Flight itinerary: AKL to WLG", from: () => "SkyKiwi Airlines <bookings@skykiwi.example>", expect: () => ({ decision: "ignore" }) },

  // ---- Look-alikes (recruitment-ish words, not application updates)
  { category: "look_alike", cls: "other", ctxs: ["none"], subject: () => "Your loan application has been received", from: () => "Pōhutukawa Bank <noreply@pohutukawabank.example>", expect: () => ({ decision: "ignore" }) },
  { category: "look_alike", cls: "other", ctxs: ["none"], subject: () => "Unfortunately, our sale ends tonight", from: () => "Gadget Barn <deals@gadgetbarn.example>", listUnsubscribe: true, labels: ["CATEGORY_PROMOTIONS"], expect: () => ({ decision: "ignore" }) },
  { category: "look_alike", cls: "other", ctxs: ["none"], subject: () => "Exclusive offer: 40% off annual membership", from: () => "FitHub <hello@fithub.example>", listUnsubscribe: true, labels: ["CATEGORY_PROMOTIONS"], expect: () => ({ decision: "ignore" }) },
  { category: "look_alike", cls: "other", ctxs: ["none"], subject: () => "Thank you for your application to the Data Science course", from: () => "Code Academy NZ <admissions@codeacademy.example>", expect: () => ({ decision: "ignore" }) },
  { category: "look_alike", cls: "other", ctxs: ["none"], subject: () => "Action required: verify your bank account", from: () => "Pōhutukawa Bank <alerts@pohutukawabank.example>", expect: () => ({ decision: "ignore" }) },
  { category: "look_alike", cls: "other", ctxs: ["none"], subject: () => "Interview with our CEO – podcast episode 42", from: () => "Startup Stories <podcast@startupstories.example>", listUnsubscribe: true, expect: () => ({ decision: "ignore" }) },
  { category: "look_alike", cls: "other", ctxs: ["none"], subject: () => "Your rental application has been received", from: () => "City Tenancies <apply@citytenancies.example>", expect: () => ({ decision: "ignore" }) },

  // ---- Forwarded (never applied automatically)
  { category: "forwarded", cls: "interview_invite", ctxs: ["applied"], subject: (c) => `Fwd: Interview invitation – ${c}`, from: (_c, p) => `${p} <${slug(p)}@gmail.com>`, expect: () => r() },
  { category: "forwarded", cls: "rejection", ctxs: ["applied"], subject: (c) => `FW: Your application to ${c} – unfortunately`, from: (_c, p) => `${p} <${slug(p)}@gmail.com>`, expect: () => r() },
  { category: "forwarded", cls: "alert", ctxs: ["none"], subject: () => "Fwd: 12 new jobs for you", from: (_c, p) => `${p} <${slug(p)}@gmail.com>`, expect: () => ({ decision: "ignore" }) },

  // ---- Ambiguous (should go to manual review)
  { category: "ambiguous", cls: "application_update", ctxs: ["applied", "new"], subject: (c) => `Update on your application to ${c}`, from: (c, _p, ats) => `${c} Careers <no-reply@${ats}>`, expect: () => r() },
  { category: "ambiguous", cls: "application_update", ctxs: ["applied"], subject: () => "Regarding your candidacy", from: (c) => `${c} Recruitment <recruitment@${slug(c)}.example>`, expect: () => r() },
  { category: "ambiguous", cls: "application_update", ctxs: ["applied", "new"], subject: () => "Next steps", from: (c, _p, ats) => `${c} via Lever <no-reply@${ats}>`, expect: () => r() },

  // ---- Conflicting / misleading wording
  { category: "conflicting", cls: "rejection", ctxs: ["applied", "new"], subject: (_c, role) => `Application received – unfortunately the ${role} position has been filled`, from: (c, _p, ats) => `${c} Careers <no-reply@${ats}>`, expect: () => r() },
  { category: "conflicting", cls: "offer", ctxs: ["interview"], subject: (c) => `Your offer from ${c} – regret to inform you it is withdrawn`, from: (c, p) => `${p} from ${c} <${slug(p)}@${slug(c)}.example>`, expect: () => r() },
  { category: "conflicting", cls: "interview_invite", ctxs: ["offer"], subject: (c) => `Interview invitation – ${c}`, from: (c, _p, ats) => `${c} Talent <talent@${ats}>`, expect: statusExpect("interview") },
  { category: "conflicting", cls: "assessment", ctxs: ["interview"], subject: (c) => `${c} has invited you to complete a coding challenge`, from: () => "HackerRank <support@hackerrank.com>", expect: statusExpect("assessment") },
];

/**
 * Held-out templates: different phrasing families, written AFTER the rules and never used to tune
 * them (first-run results are recorded in docs/plans/PHASE-2.md). Several are deliberately hard for
 * a header-only classifier: subjects that don't reveal the outcome must end in review, not a guess.
 */
const HELDOUT_TEMPLATES: Template[] = [
  { category: "confirmation", cls: "application_received", ctxs: ["applied", "new"], subject: (_c, role) => `Thanks for applying to the ${role} (17584) position`, from: (c) => `${c} Careers <careers@${slug(c)}.example>`, expect: receivedExpect },
  { category: "confirmation", cls: "application_received", ctxs: ["applied", "new"], subject: () => "We've got your application!", from: (c, _p, ats) => `${c} Recruiting <no-reply@${ats}>`, expect: receivedExpect },
  { category: "confirmation", cls: "application_received", ctxs: ["new"], subject: (c) => `Confirmation: application submitted to ${c}`, from: (c, _p, ats) => `${c} <no-reply@${ats}>`, expect: receivedExpect },
  { category: "confirmation", cls: "application_received", ctxs: ["applied"], subject: (_c, role) => `Your application for ${role} is in`, from: (c) => `${c} Talent Team <talent@${slug(c)}.example>`, expect: receivedExpect },
  { category: "rejection", cls: "rejection", ctxs: ["applied", "interview"], subject: (_c, role) => `Your application for ${role}`, from: (c) => `${c} Recruitment Team <recruitment@${slug(c)}.example>`, expect: () => r() },
  { category: "rejection", cls: "rejection", ctxs: ["applied"], subject: (c) => `Thank you for your interest in ${c}`, from: (c, _p, ats) => `${c} Careers <no-reply@${ats}>`, expect: () => r() },
  { category: "rejection", cls: "rejection", ctxs: ["assessment"], subject: () => "An update on your application", from: (c, _p, ats) => `${c} Careers <no-reply@${ats}>`, expect: () => r() },
  { category: "rejection", cls: "rejection", ctxs: ["applied"], subject: (_c, role) => `${role} – outcome of your application`, from: (c) => `${c} HR <hr@${slug(c)}.example>`, expect: () => r() },
  { category: "interview_invite", cls: "interview_invite", ctxs: ["applied", "assessment"], subject: (_c, role) => `Next round: technical interview for ${role}`, from: (c, p) => `${p} from ${c} <${slug(p)}@${slug(c)}.example>`, expect: statusExpect("interview") },
  { category: "interview_invite", cls: "interview_invite", ctxs: ["applied"], subject: (c) => `Let's chat! Interview with ${c}`, from: (c, _p, ats) => `${c} Talent <talent@${ats}>`, expect: statusExpect("interview") },
  { category: "interview_invite", cls: "interview_invite", ctxs: ["applied"], subject: () => "Your availability for a call this week?", from: (c, p) => `${p} at ${c} <${slug(p)}@${slug(c)}.example>`, expect: () => r() },
  { category: "scheduling_change", cls: "interview_update", ctxs: ["interview"], subject: () => "Change of time for your interview", from: (c, p) => `${p} from ${c} <${slug(p)}@${slug(c)}.example>`, expect: () => r() },
  { category: "scheduling_change", cls: "interview_update", ctxs: ["interview"], subject: (c) => `Reschedule request – ${c} interview`, from: (c, _p, ats) => `${c} Talent <talent@${ats}>`, expect: () => r() },
  { category: "offer", cls: "offer", ctxs: ["interview"], subject: (_c, role) => `Employment agreement – ${role}`, from: (c) => `${c} People & Culture <people@${slug(c)}.example>`, expect: () => r() },
  { category: "offer", cls: "offer", ctxs: ["interview"], subject: (c) => `Congratulations from ${c}!`, from: (c, p) => `${p} from ${c} <${slug(p)}@${slug(c)}.example>`, expect: () => r() },
  { category: "recruiter_outreach", cls: "recruiter_outreach", ctxs: ["none"], subject: () => "Graduate developer role – thought of you", from: (_c, p) => `${p} <${slug(p)}@kiwitalent.example>`, expect: () => r() },
  { category: "info_request", cls: "info_request", ctxs: ["applied"], subject: () => "We need a few more details to continue", from: (c, _p, ats) => `${c} Careers <careers@${ats}>`, expect: () => r() },
  { category: "info_request", cls: "info_request", ctxs: ["applied"], subject: () => "Documents required to continue your application", from: (c) => `${c} HR <hr@${slug(c)}.example>`, expect: () => r() },
  { category: "job_alert", cls: "alert", ctxs: ["none"], subject: () => "3 new jobs match your preferences", from: () => "Trade Me Jobs <jobs@trademe.co.nz>", listUnsubscribe: true, expect: () => ({ decision: "alert" }), alertBody: true },
  { category: "job_alert", cls: "alert", ctxs: ["none"], subject: (_c, role) => `Alex, apply now: ${role}`, from: () => "Indeed <donotreply@match.indeed.com>", listUnsubscribe: true, expect: () => ({ decision: "alert" }), alertBody: true },
  { category: "job_alert", cls: "alert", ctxs: ["none"], subject: () => "Jobs you might be interested in", from: () => "Glassdoor Jobs <noreply@glassdoor.com>", listUnsubscribe: true, expect: () => ({ decision: "alert" }), alertBody: true },
  { category: "look_alike", cls: "other", ctxs: ["none"], subject: () => "Your credit card application is approved", from: () => "Pōhutukawa Bank <cards@pohutukawabank.example>", expect: () => ({ decision: "ignore" }) },
  { category: "look_alike", cls: "other", ctxs: ["none"], subject: () => "Unfortunately your payment failed", from: () => "StreamBox <billing@streambox.example>", expect: () => ({ decision: "ignore" }) },
  { category: "look_alike", cls: "other", ctxs: ["none"], subject: () => "5 interview tips from our career blog", from: () => "CareerCoach Weekly <news@careercoach.example>", listUnsubscribe: true, labels: ["CATEGORY_PROMOTIONS"], expect: () => ({ decision: "ignore" }) },
  { category: "look_alike", cls: "other", ctxs: ["none"], subject: () => "Job done! Your order has shipped", from: () => "Gadget Barn <orders@gadgetbarn.example>", expect: () => ({ decision: "ignore" }) },
  { category: "personal", cls: "other", ctxs: ["none"], subject: () => "Re: weekend plans", from: (_c, p) => `${p} <${slug(p)}@gmail.com>`, expect: () => ({ decision: "ignore" }) },
  { category: "ambiguous", cls: "application_update", ctxs: ["applied"], subject: () => "Following up", from: (c, _p, ats) => `${c} Talent <talent@${ats}>`, expect: () => r() },
  { category: "ambiguous", cls: "application_update", ctxs: ["applied"], subject: (c) => `Your candidacy at ${c}`, from: (c) => `${c} Recruitment <recruitment@${slug(c)}.example>`, expect: () => r() },
  { category: "conflicting", cls: "rejection", ctxs: ["applied"], subject: () => "Application received – we regret to inform you", from: (c, _p, ats) => `${c} Careers <no-reply@${ats}>`, expect: () => r() },
  { category: "forwarded", cls: "offer", ctxs: ["interview"], subject: (c) => `Fwd: Offer of employment – ${c}`, from: (_c, p) => `${p} <${slug(p)}@gmail.com>`, expect: () => r() },
];

const BASE_TIME = Date.UTC(2026, 7, 18) / 1000; // 18 Aug 2026: start of a 90-day window

function alertText(rand: () => number): string {
  const jobs = ["Junior Software Engineer – Tōtara Insurance", "Data Engineer – FreshBox", "Graduate Developer – Kauri Systems", "Cloud Support Associate – Moana Payments", "Software Engineering Intern – Rimu Digital"];
  const n = 2 + Math.floor(rand() * 3);
  return jobs.slice(0, n).map((j) => `${j}\nAuckland City, Auckland\n${1 + Math.floor(rand() * 3)} days ago`).join("\n\n");
}

/** Builds the dataset. `copies` repeats every template/context with fresh names and ids. */
export function generateSynthetic(seed = 20261115, copies = 3): SyntheticEmail[] {
  const rand = rng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const out: SyntheticEmail[] = [];
  let n = 0;
  const sets: [Template[], SyntheticEmail["split"]][] = [[TUNING_TEMPLATES, "tune"], [HELDOUT_TEMPLATES, "heldout"]];
  for (let copy = 0; copy < copies; copy++) {
    for (const [templates, split] of sets) for (const t of templates) {
      for (const ctx of t.ctxs) {
        const company = ctx === "none" ? null : pick(BY_CTX[ctx]);
        const person = pick(PEOPLE);
        const role = pick(ROLES);
        const id = `syn${(n++).toString(16).padStart(6, "0")}`;
        const meta: MailMeta = {
          id,
          threadId: `t${id}`,
          internalDate: BASE_TIME + Math.floor(rand() * 90 * 86400),
          labelIds: ["INBOX", ...(t.labels ?? [])],
          from: t.from(company ?? "Kererū Cloud", person, pick(ATS)),
          subject: t.subject(company ?? "Kererū Cloud", role, person),
          listUnsubscribe: t.listUnsubscribe ?? false,
          contentType: t.contentType ?? "multipart/alternative",
          autoSubmitted: "",
        };
        const exp = t.expect(ctx);
        const email: SyntheticEmail = {
          meta,
          category: t.category,
          ctx,
          company,
          expectedClass: t.cls,
          expectedDecision: exp.decision,
          ...(exp.suggested !== undefined ? { expectedSuggested: exp.suggested } : {}),
          split,
          ...(t.alertBody ? { body: alertText(rand) } : {}),
        };
        out.push(email);
      }
    }
  }
  // Duplicates: exact re-deliveries of confirmations (new Gmail id, same thread) must not double-apply.
  const dupSource = out.filter((e) => e.category === "confirmation" && e.ctx === "applied").slice(0, 6);
  for (const e of dupSource) {
    out.push({ ...e, category: "duplicate", meta: { ...e.meta, id: `${e.meta.id}d`, internalDate: e.meta.internalDate + 60 }, expectedDecision: "link_only" });
  }
  return out;
}

export function summarize(ds: SyntheticEmail[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of ds) counts[e.category] = (counts[e.category] ?? 0) + 1;
  return counts;
}
