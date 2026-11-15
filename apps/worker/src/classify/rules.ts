// Classification rules as data (spec §9), headers only. All patterns are simple, anchored
// alternations without nested quantifiers (no catastrophic backtracking); inputs are capped
// at 300 characters before matching.
import type { MailClass } from "./types.ts";

export interface Rule {
  id: string;
  cls: MailClass;
  weight: number;
  subject?: RegExp[];
  fromName?: RegExp[];
  domains?: string[];
  /** Rule only fires when the sender domain is one of `domains`. */
  domainRequired?: boolean;
  calendar?: boolean;
}

export const ATS_DOMAINS = [
  "greenhouse.io", "greenhouse-mail.io", "lever.co", "myworkday.com", "myworkdayjobs.com", "smartrecruiters.com",
  "ashbyhq.com", "workable.com", "teamtailor.com", "bamboohr.com", "jobvite.com", "icims.com", "successfactors.com",
  "pageuppeople.com", "jobadder.com", "livehire.com", "snaphire.com", "recruitee.com", "breezy.hr", "applynow.net.au",
];
export const BOARD_DOMAINS = [
  "seek.co.nz", "seek.com.au", "indeed.com", "linkedin.com", "employmenthero.com", "trademe.co.nz", "jora.com",
  "glassdoor.com", "talent.com", "ziprecruiter.com", "workingin.com",
];
export const ASSESSMENT_DOMAINS = ["hackerrank.com", "codility.com", "hirevue.com", "testgorilla.com", "pymetrics.ai", "codesignal.com"];
export const SCHEDULING_DOMAINS = ["calendly.com", "goodtime.io", "modernloop.io", "yello.co"];
export const FREE_MAIL_DOMAINS = ["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "live.com", "xtra.co.nz", "proton.me"];

export const RULES: Rule[] = [
  {
    id: "received.thanks", cls: "application_received", weight: 0.85,
    subject: [
      /\bthanks? (you )?for (your )?(applying|application|applying to|submitting)/i,
      /\bapplication (has been |was )?(received|submitted|confirmed)\b/i,
      /\bwe(’|')?ve (received|got) your application\b/i,
      /\bapplication confirmation\b/i,
      /\byour application (to|for|at|with) .{1,60} (has been received|was submitted|is in)/i,
      /\byour application for .{1,60} is in\b/i,
      /\bconfirmation: application submitted\b/i,
    ],
  },
  {
    id: "assessment.subject", cls: "assessment", weight: 0.85,
    subject: [
      /\b(online|technical|coding|cognitive|psychometric|video) (assessment|test|challenge|interview task)\b/i,
      /\btake[- ]home (task|test|exercise|assignment)\b/i,
      /\bcomplete (your|the) (assessment|test|challenge)\b/i,
      /\b(hackerrank|codility|hirevue|testgorilla|codesignal)\b/i,
    ],
  },
  { id: "assessment.domain", cls: "assessment", weight: 0.85, domains: ASSESSMENT_DOMAINS, domainRequired: true },
  {
    id: "interview.invite", cls: "interview_invite", weight: 0.85,
    subject: [
      /\binvitation to (an? )?(interview|phone screen|video call)\b/i,
      /\binterview invitation\b/i,
      /\binvite you to (an? )?interview\b/i,
      /\b(schedule|book) (an?|your) (interview|call|time)\b/i,
      /\binterview request\b/i,
      /^invitation: .{1,80}(interview|screen)/i,
      /\b(next round|technical interview|coding interview|final round)\b/i,
      /\binterview (with|for)\b/i,
      /\blet('?|’?)s chat\b/i,
      /\b(your )?availability for a (call|chat|interview|phone screen)\b/i,
    ],
  },
  { id: "interview.scheduler", cls: "interview_invite", weight: 0.8, domains: SCHEDULING_DOMAINS, domainRequired: true },
  { id: "interview.calendar", cls: "interview_invite", weight: 0.8, calendar: true, subject: [/\b(interview|screen|chat)\b/i] },
  {
    id: "interview.update", cls: "interview_update", weight: 0.85,
    subject: [
      /\binterview (rescheduled|update|change|moved|cancell?ed|confirmed|reminder)\b/i,
      /\b(rescheduled|cancell?ed|updated invitation|new time|change of time)\b.{0,60}\binterview\b/i,
      /^(updated invitation|cancell?ed event|canceled event): .{1,80}(interview|screen)/i,
      /\breschedule( request)?\b/i,
    ],
  },
  {
    id: "update.generic", cls: "application_update", weight: 0.75,
    subject: [
      /\b(update|news|status|outcome) (on|regarding|about|of) your application\b/i,
      /\byour application (to|for|at|with) /i,
      /\byour application for\b/i,
      /\bapplication (status|update)\b/i,
      /\bregarding your (application|candidacy)\b/i,
      /\byour candidacy\b/i,
      /\ban update on your application\b/i,
      /\bfollowing up\b/i,
      /\bthank you for your interest in\b/i,
    ],
  },
  // A recruiting platform that matched nothing specific: ambiguous, so it goes to review.
  { id: "update.ats", cls: "application_update", weight: 0.6, domains: ATS_DOMAINS, domainRequired: true },
  {
    id: "rejection.subject", cls: "rejection", weight: 0.85,
    subject: [
      /\bunfortunately\b/i,
      /\b(unsuccessful|not successful)\b/i,
      /\bnot (be )?(moving|progressing|proceeding) (forward|further)\b/i,
      /\bregret to (inform|advise)\b/i,
      /\b(position|role) has (now )?been filled\b/i,
      /\bother candidates\b/i,
    ],
  },
  {
    id: "offer.subject", cls: "offer", weight: 0.85,
    subject: [
      /\b(job|employment|letter of) offer\b/i,
      /\boffer of employment\b/i,
      /\boffer letter\b/i,
      /\bpleased to offer\b/i,
      /\b(updated|revised|signed|final) offer\b/i,
      /\boffer (details|next steps|acceptance)\b/i,
      /\byour offer from\b/i,
      /\bemployment agreement\b/i,
      /\bcongratulations from\b/i,
    ],
  },
  {
    id: "outreach.subject", cls: "recruiter_outreach", weight: 0.75,
    subject: [
      /\b(i|we) came across your profile\b/i,
      /\b(exciting|new) (opportunity|role) (for you|at|with)\b/i,
      /\bare you open to\b/i,
      /\bquick (chat|call) about\b/i,
      /\binterested in (a|an|this) (new )?(role|opportunity)\b/i,
      /\bthought of you\b/i,
    ],
  },
  {
    id: "info.request", cls: "info_request", weight: 0.85,
    subject: [
      /\b(additional|more|further) (information|details|documents?) (required|needed|requested)\b/i,
      /\baction required\b/i,
      /\bplease (provide|upload|send|complete) (your|the|a)\b/i,
      /\b(reference|referee) (check|details|request)\b/i,
      /\b(right to work|work rights|proof of eligibility)\b/i,
      /\bdocuments? required\b/i,
      /\b(need|require) (a few |more |additional )?(details|information|documents?)\b/i,
    ],
  },
  {
    id: "alert.board", cls: "alert", weight: 0.9, domains: BOARD_DOMAINS, domainRequired: true,
    subject: [
      /\bjobs?\b/i, /\bhiring\b/i, /\b(match|matches|could be a match)\b/i, /\brole\b/i, /\binternship\b/i, /\bopportunit/i,
      /\brecommended\b/i, /\bsaved (search|alert)\b/i, /\bapply\b/i, /\bposition\b/i,
    ],
  },
  {
    id: "alert.digest", cls: "alert", weight: 0.8,
    subject: [
      /\b(job alert|jobs? for you|jobs you may like|recommended jobs|new jobs|job matches|jobs hiring now)\b/i,
      /\b\d+ new .{1,60} jobs\b/i,
      /\bmatch(es)? your (profile|saved search|job alert)\b/i,
    ],
  },
];

/** Applied after matching: patterns that mean "probably not a real application update". */
export const NEGATIVES: { id: string; penalty: number; subject: RegExp }[] = [
  { id: "neg.consumer", penalty: 0.45, subject: /\b(loan|credit card|mortgage|bank account|tenancy|rental|visa|passport|scholarship|enrol(l)?ment|admission|course|membership|insurance|claim|refund|order|subscription|warranty|trial|payment|invoice|bill|receipt|shipping)\b/i },
  { id: "neg.marketing", penalty: 0.45, subject: /(%\s?off|\bsale\b|\bdeal\b|\bdiscount\b|\blimited time\b|\bwebinar\b|\bnewsletter\b|\bexclusive offer\b|\bspecial offer\b|\boffer ends\b|\bfree shipping\b|\bpodcast\b|\bepisode\b)/i },
];
