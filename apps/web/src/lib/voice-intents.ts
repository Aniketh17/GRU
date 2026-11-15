// Voice V1 (ROADMAP "Voice"): a deterministic command grammar, no AI. Pure functions, no browser APIs.
// Anything that would change data becomes a confirm card; nothing happens until Ani taps (SPEC section 19).

const TZ = "Pacific/Auckland";
const STATUSES = ["applied", "assessment", "interview", "offer", "accepted", "declined", "rejected", "withdrawn"] as const;
export type VoiceStatus = (typeof STATUSES)[number];

export type Intent =
  | { kind: "brief" }
  | { kind: "agenda" }
  | { kind: "tasks" }
  | { kind: "interviews" }
  | { kind: "jobs" }
  | { kind: "stop" }
  | { kind: "help" }
  | { kind: "greet" }
  | { kind: "search_notes"; q: string }
  | { kind: "create_task"; title: string; due: number | null }
  | { kind: "create_note"; body: string }
  | { kind: "create_application"; company: string; role: string | null }
  | { kind: "set_status"; company: string; status: VoiceStatus }
  | { kind: "create_interview"; company: string; at: number | null }
  | { kind: "yes" }
  | { kind: "no" }
  | { kind: "review_list" }
  | { kind: "weekly" }
  | { kind: "calendar"; at: number | null; week: boolean }
  | { kind: "unknown"; heard: string };

// ---------------------------------------------------------------- Auckland calendar helpers
const partsFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const tzOffsetMs = (ms: number): number => {
  const p = partsFmt.formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - ms;
};
/** Auckland wall-clock (y, m 1-12, d, h, min) to UTC epoch seconds, DST-safe. */
export function aucklandToEpoch(y: number, m: number, d: number, h: number, min: number): number {
  const asUtc = Date.UTC(y, m - 1, d, h, min);
  let guess = asUtc;
  for (let i = 0; i < 2; i++) guess = asUtc - tzOffsetMs(guess);
  return Math.floor(guess / 1000);
}
const todayParts = (nowSec: number): { y: number; m: number; d: number; dow: number } => {
  const p = partsFmt.formatToParts(new Date(nowSec * 1000));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const y = g("year"), m = g("month"), d = g("day");
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
};
const addDays = (y: number, m: number, d: number, n: number) => {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

export interface When { epoch: number | null; hasTime: boolean; rest: string }

/** Finds a date and/or time phrase ("tomorrow at 2pm", "on friday", "20 december at 10:30") and removes it from the text. */
export function parseWhen(input: string, nowSec: number, defaultHour = 9): When {
  // `low` is matched against; `orig` is edited in lock-step so the leftover text keeps its casing.
  let low = ` ${input.toLowerCase()} `;
  let orig = ` ${input} `;
  const drop = (mm: RegExpExecArray) => {
    low = low.slice(0, mm.index) + " " + low.slice(mm.index + mm[0].length);
    orig = orig.slice(0, mm.index) + " " + orig.slice(mm.index + mm[0].length);
  };
  const find = (re: RegExp): RegExpExecArray | null => re.exec(low);
  const t = todayParts(nowSec);
  let date: { y: number; m: number; d: number } | null = null;
  let m: RegExpExecArray | null;
  let evening = false;

  if ((m = find(/\b(today|tonight|this evening)\b/))) { evening = m[1] !== "today"; date = { y: t.y, m: t.m, d: t.d }; drop(m); }
  else if ((m = find(/\bday after tomorrow\b/))) { date = addDays(t.y, t.m, t.d, 2); drop(m); }
  else if ((m = find(/\btomorrow\b/))) { date = addDays(t.y, t.m, t.d, 1); drop(m); }
  else if ((m = find(/\bin (\d+|one|two|three|four|five|six|seven|eight|nine|ten) (day|days|week|weeks)\b/))) {
    const n = NUM_WORDS[m[1] as string] ?? Number(m[1]);
    date = addDays(t.y, t.m, t.d, m[2]?.startsWith("week") ? n * 7 : n);
    drop(m);
  } else if ((m = find(new RegExp(String.raw`\b(?:(next|this|on) )?(${DAYS.join("|")})\b`)))) {
    const target = DAYS.indexOf(m[2] as string);
    let diff = (target - t.dow + 7) % 7;
    if (diff === 0 && m[1] !== "this") diff = 7;
    date = addDays(t.y, t.m, t.d, diff);
    drop(m);
  } else if ((m = find(new RegExp(String.raw`\b(?:on )?(\d{1,2})(?:st|nd|rd|th)? (?:of )?(${MONTHS.join("|")})\b`))) || (m = find(new RegExp(String.raw`\b(?:on )?(${MONTHS.join("|")}) (\d{1,2})(?:st|nd|rd|th)?\b`)))) {
    const dayFirst = /^\d/.test(m[1] as string);
    const day = Number(dayFirst ? m[1] : m[2]);
    const mon = MONTHS.indexOf((dayFirst ? m[2] : m[1]) as string) + 1;
    let y = t.y;
    if (mon < t.m || (mon === t.m && day < t.d)) y += 1;
    date = { y, m: mon, d: day };
    drop(m);
  }

  let hour: number | null = null;
  let minute = 0;
  if ((m = find(/\b(?:at |by |@ )?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/))) {
    hour = (Number(m[1]) % 12) + (/^p/.test(m[3] as string) ? 12 : 0);
    minute = Number(m[2] ?? 0);
    drop(m);
  } else if ((m = find(/\bat (\d{1,2}):(\d{2})\b/))) {
    hour = Number(m[1]); minute = Number(m[2]); drop(m);
  } else if ((m = find(/\b(?:at )?(noon|midday)\b/))) { hour = 12; drop(m); }
  else if ((m = find(/\b(?:at )?midnight\b/))) { hour = 0; drop(m); }
  else if ((m = find(/\bin the morning\b/))) { hour = 9; drop(m); }
  else if ((m = find(/\bin the afternoon\b/))) { hour = 15; drop(m); }
  else if (evening) hour = 18;

  const rest = orig.replace(/\s+/g, " ").replace(/\b(by|due|on|at|for|before)\s*$/i, "").trim();
  if (!date && hour === null) return { epoch: null, hasTime: false, rest: input.trim() };
  if (!date) {
    // Time only: today if still ahead, else tomorrow.
    let d = { y: t.y, m: t.m, d: t.d };
    if (aucklandToEpoch(d.y, d.m, d.d, hour ?? defaultHour, minute) <= nowSec) d = addDays(t.y, t.m, t.d, 1);
    date = d;
  }
  return { epoch: aucklandToEpoch(date.y, date.m, date.d, hour ?? defaultHour, minute), hasTime: hour !== null, rest };
}

// ---------------------------------------------------------------- grammar
const clean = (s: string) => s.replace(/[.!?]+$/g, "").replace(/\s+/g, " ").trim();
const stripLead = (s: string) => s.replace(/^(hey |ok |okay )?(gru|grew|grue)[,:]? /i, "").replace(/^(please|can you|could you|i want to|i'd like to|i would like to) /i, "").replace(/ please$/i, "");

export function parseIntent(raw: string, nowSec: number): Intent {
  const original = clean(raw);
  const o = stripLead(original); // original casing, same length as `s`
  const s = o.toLowerCase();
  if (!s) return { kind: "unknown", heard: original };
  let m: RegExpExecArray | null;
  /** Capture group `i` of a match against `s`, in its original casing (`o` has the same length as `s`). */
  const grp = (mm: RegExpExecArray, i: number): string => {
    const t = mm[i];
    if (!t) return "";
    const p = s.indexOf(t, mm.index);
    return o.slice(p, p + t.length);
  };

  if (/^(stop|cancel|be quiet|quiet|enough|never ?mind|shut up|pause)$/.test(s)) return { kind: "stop" };
  if (/^(hi|hello|hey|good (morning|afternoon|evening)|yo)( gru)?$/.test(s)) return { kind: "greet" };
  if (/^(help|what can you do|what can i say|commands)$/.test(s)) return { kind: "help" };

  // Writes first, so "add task call recruiter" isn't mistaken for a read.
  if ((m = /^(?:remind me to|remind me about) (.+)$/.exec(s)) || (m = /^(?:add|create|make|new|set)(?: me)?(?: a| an)? (?:task|reminder|to-?do)(?: to| for| called| named|:)? (.+)$/.exec(s))) {
    const w = parseWhen(grp(m, 1), nowSec, 17);
    const title = clean(w.rest.replace(/\b(me )?to\b\s*$/i, "")).replace(/^to /i, "");
    return title ? { kind: "create_task", title: cap1(title), due: w.epoch } : { kind: "unknown", heard: original };
  }
  if ((m = /^(?:add |make |take |save )?(?:a )?note(?: that| about| to self| saying|:)? (.+)$/.exec(s)) || (m = /^(?:remember|note) that (.+)$/.exec(s))) {
    return { kind: "create_note", body: cap1(clean(grp(m, 1))) };
  }
  if ((m = /^(?:i )?(?:just )?applied (?:to|for|at) (.+)$/.exec(s)) || (m = /^(?:add|log|record)(?: an?)? application (?:to|for|at|with) (.+)$/.exec(s))) {
    const body = grp(m, 1);
    let company = body;
    let role: string | null = null;
    let mm: RegExpExecArray | null;
    if ((mm = /^(.+?) as (?:an? )?(.+)$/i.exec(body))) { company = mm[1] as string; role = mm[2] as string; }
    else if ((mm = /^(?:an? )?(.+?) (?:role |position |job )?(?:at|with) (.+)$/i.exec(body))) { role = mm[1] as string; company = mm[2] as string; }
    return { kind: "create_application", company: company.trim(), role: role ? cap1(role.trim()) : null };
  }
  if ((m = new RegExp(`^(?:move|mark|set|update|change) (.+?) (?:to|as) (${STATUSES.join("|")})$`).exec(s))) {
    return { kind: "set_status", company: clean(grp(m, 1).replace(/^(my )?(application )?(with |at |for )?/i, "")), status: m[2] as VoiceStatus };
  }
  if ((m = /^(.+?) (?:has )?rejected me$/.exec(s))) return { kind: "set_status", company: grp(m, 1), status: "rejected" };
  if ((m = /^i (?:got|received|have) an offer (?:from|at) (.+)$/.exec(s))) return { kind: "set_status", company: grp(m, 1), status: "offer" };
  if ((m = /^i (?:got|have|received) an? (?:interview|assessment) (?:invite |invitation )?(?:from|at|with) (.+)$/.exec(s))) {
    const w = parseWhen(grp(m, 1), nowSec, 10);
    return { kind: "create_interview", company: clean(w.rest), at: w.epoch };
  }
  if ((m = /^(?:add |schedule |book |set up |log )?(?:an? )?interview (?:with|at|for) (.+)$/.exec(s))) {
    const w = parseWhen(grp(m, 1), nowSec, 10);
    return { kind: "create_interview", company: clean(w.rest), at: w.epoch };
  }

  // Short answers to something GRU just offered ("want me to open it?").
  if (/^(?:yes|yeah|yep|yup|sure|ok|okay|please do|go ahead|do it|sounds good|open it|open that|show me|show it|yes please|yes open it)$/.test(s)) return { kind: "yes" };
  if (/^(?:no|nope|nah|not now|skip(?: it)?|next(?: one)?|not interested|no thanks|not for me|maybe later)$/.test(s)) return { kind: "no" };

  // Reads.
  if (/\b(?:review|unread|new|waiting|pending)\b[^.]{0,20}\b(?:e-?mails?|mails?)\b/.test(s) || /\b(?:e-?mails?|mails?)\b[^.]{0,30}\b(?:to review|need(?:s)? (?:me|my|a)|waiting|i should)\b/.test(s) || /^what (?:are|were) (?:they|those|these)$/.test(s)) return { kind: "review_list" };
  if (/\b(?:weekly|week'?s) (?:summary|review|recap)\b|how did i do this week|how'?s my week/.test(s)) return { kind: "weekly" };
  if (/\bcalendar\b/.test(s) || /\bwhat'?s (?:on|happening|coming up) (?:tomorrow|this week|next week|on \w+day)\b/.test(s)) {
    const w = parseWhen(s, nowSec);
    return { kind: "calendar", at: w.epoch, week: /\bweek\b/.test(s) || w.epoch === null };
  }
  if ((m = /^(?:search|find|look up|look for)(?: my)? notes?(?: for| about| on)? (.+)$/.exec(s))) return { kind: "search_notes", q: m[1] as string };
  if (/\b(agenda|schedule)\b/.test(s)) return { kind: "agenda" };
  if (/\b(brief|briefing|catch me up|morning update|what'?s (on|happening)( today)?|what is (on|happening)( today)?|my day|start my day)\b/.test(s)) return { kind: "brief" };
  if (/\b(tasks?|to-?dos?|reminders?)\b/.test(s) && /\b(what|show|list|read|any|my|do i have)\b/.test(s)) return { kind: "tasks" };
  if (/\binterviews?\b/.test(s) && /\b(what|when|any|upcoming|next|do i have|show|list)\b/.test(s)) return { kind: "interviews" };
  if (/\b(jobs?|vacancies|matches|apply tomorrow)\b/.test(s)) return { kind: "jobs" };
  return { kind: "unknown", heard: original };
}

function cap1(s: string): string { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// ---------------------------------------------------------------- spoken output
export interface BriefLike {
  review_count: number;
  interviews_upcoming: { company: string; at: number }[];
  missing_debriefs: { company: string }[];
  follow_ups: { company: string; days_stale: number }[];
  jobs: { queue_count: number; new_count: number; top: { title: string; company: string | null; score: number | null }[]; closing_soon: number };
  tasks_due: number;
  health: { summary: string; needs_reauth: boolean };
  interviews_proposed?: { company: string }[];
  deadlines_soon?: { kind: string; company: string | null; due_at: number }[];
  found?: {
    alert_jobs: { id: number; title: string; company: string | null; location: string | null; source: string; score: number | null; confidence: string | null }[];
    alert_job_count: number;
    email_events: { app_id: number; company: string; what: string; moved_automatically: boolean }[];
  };
}

/** A next step GRU offers after talking about something ("want me to open it?"). A plain "yes" takes the first one. */
export interface Offer { kind: "job" | "application"; id: number; label: string }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sayTime = (epoch: number) => {
  const d = new Date(epoch * 1000);
  const day = new Intl.DateTimeFormat("en-NZ", { timeZone: TZ, weekday: "long" }).format(d);
  const time = new Intl.DateTimeFormat("en-NZ", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(d);
  return `${day} at ${time}`;
};
const SOURCE_NAME: Record<string, string> = { seek: "Seek", linkedin: "LinkedIn", indeed: "Indeed", trademe: "Trade Me", jora: "Jora" };
const DEADLINE_SAY: Record<string, string> = { assessment: "The assessment", offer_reply: "Your reply to the offer", interview_reply: "Confirming the interview", other: "An action" };

/** The brief as short spoken chapters plus the next steps it offers. Warm and specific: it says what it found, and where. */
export function composeBrief(b: BriefLike, greeting: string, focus?: string | null): { sentences: string[]; offers: Offer[] } {
  const out: string[] = [`${greeting}, Ani.`];
  const offers: Offer[] = [];
  if (b.health.needs_reauth) out.push("Heads up: a Gmail account needs reconnecting, so new mail isn't syncing.");

  const events = b.found?.email_events ?? [];
  if (events.length) {
    out.push("While you were away I read your job mail.");
    for (const e of events.slice(0, 3)) {
      if (e.what === "rejection") out.push(`${e.company} sent a rejection.${e.moved_automatically ? " I've moved it to rejected, and you can undo that from Today." : " It's waiting in Review for you to confirm."}`);
      else if (e.what === "offer") out.push(`Good news: ${e.company} sent an offer. It's worth a careful read.`);
      else if (e.what === "interview_invite") out.push(`${e.company} invited you to an interview.`);
      else if (e.what === "interview_update") out.push(`${e.company} changed something about your interview.`);
      else if (e.what === "assessment") out.push(`${e.company} sent an assessment for you to complete.`);
      else continue;
      if (offers.length < 2) offers.push({ kind: "application", id: e.app_id, label: e.company });
    }
  }

  const needs: string[] = [];
  if (b.review_count > 0) needs.push(`${plural(b.review_count, "email")} waiting for your review`);
  if (b.tasks_due > 0) needs.push(`${plural(b.tasks_due, "task")} due`);
  const somethingElse = events.length > 0 || (b.interviews_proposed?.length ?? 0) > 0 || (b.deadlines_soon?.length ?? 0) > 0 || b.interviews_upcoming.length > 0 || b.follow_ups.length > 0 || (b.found?.alert_jobs.length ?? 0) > 0;
  if (needs.length) out.push(`You have ${needs.join(" and ")}.`);
  else if (!somethingElse) out.push("Nothing is waiting on you right now.");
  for (const i of b.interviews_upcoming.slice(0, 3)) out.push(`Interview with ${i.company}, ${sayTime(i.at)}.`);
  for (const i of (b.interviews_proposed ?? []).slice(0, 2)) out.push(`${i.company} sent interview details that need your confirmation.`);
  for (const d of (b.deadlines_soon ?? []).slice(0, 2)) out.push(`${DEADLINE_SAY[d.kind] ?? "A deadline"}${d.company ? ` for ${d.company}` : ""} is due ${sayTime(d.due_at)}.`);
  if (b.missing_debriefs.length) out.push(`You haven't debriefed ${b.missing_debriefs.slice(0, 2).map((d) => d.company).join(" or ")} yet.`);
  if (b.follow_ups.length) {
    const f = b.follow_ups[0]!;
    out.push(`${plural(b.follow_ups.length, "follow-up")} due. The longest wait is ${f.company}, at ${f.days_stale} days.`);
  }

  const alerts = b.found?.alert_jobs ?? [];
  const top = alerts[0];
  if (top) {
    const count = b.found?.alert_job_count ?? alerts.length;
    const src = SOURCE_NAME[top.source] ?? "job";
    out.push(`${plural(count, "new job")} came in on your ${src} alert${count === 1 ? "" : "s"}.`);
    const fit = top.score ? `, scoring ${top.score} out of 100${top.score >= 65 ? ", so it could suit you" : ""}` : ", and I haven't scored it yet";
    out.push(`The standout is ${top.title}${top.company ? ` at ${top.company}` : ""}${top.location ? `, in ${top.location}` : ""}${fit}. Want me to open it?`);
    for (const j of alerts.slice(0, 3)) offers.push({ kind: "job", id: j.id, label: `${j.title}${j.company ? ` at ${j.company}` : ""}` });
  } else if (b.jobs.queue_count > 0) {
    const t = b.jobs.top[0];
    out.push(`${plural(b.jobs.queue_count, "job")} in your apply list${b.jobs.new_count ? `, ${b.jobs.new_count} new` : ""}.${t ? ` Top match: ${t.title}${t.company ? ` at ${t.company}` : ""}${t.score ? `, ${t.score} out of 100` : ""}.` : ""}${b.jobs.closing_soon ? ` ${plural(b.jobs.closing_soon, "job")} closing soon.` : ""}`);
  }
  out.push(focus ? `Your focus today: ${focus}` : "What's the one thing that has to happen today?");
  return { sentences: out, offers };
}

/** The brief as short spoken chapters (sentences only). */
export function composeBriefScript(b: BriefLike, greeting: string, focus?: string | null): string[] {
  return composeBrief(b, greeting, focus).sentences;
}

export interface Reply { text: string }
export const HELP_TEXT =
  "You can say: read my brief. What are my emails to review? What's on my calendar tomorrow? How was my week? Add a task to call the recruiter tomorrow at 2pm. Note that Priya prefers email. I applied to Acme as a graduate engineer. Move Acme to interview. Interview with Acme on Friday at 10am. What are my tasks? Any interviews coming up? Top jobs. Search notes for Wellington.";
