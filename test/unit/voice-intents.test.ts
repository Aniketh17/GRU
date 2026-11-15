// Voice V1 command grammar: deterministic parsing, Auckland dates, DST-safe, casing preserved.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aucklandToEpoch, composeBrief, composeBriefScript, parseIntent, parseWhen } from "../../apps/web/src/lib/voice-intents.ts";

// Tuesday 15 Dec 2026, 10:00 NZDT.
const NOW = Math.floor(Date.parse("2026-12-14T21:00:00Z") / 1000);
const at = (y: number, m: number, d: number, h: number, min = 0) => aucklandToEpoch(y, m, d, h, min);

describe("parseWhen", () => {
  it("tomorrow at 2pm", () => assert.equal(parseWhen("call recruiter tomorrow at 2pm", NOW).epoch, at(2026, 12, 16, 14)));
  it("weekday and 24h time", () => assert.equal(parseWhen("on friday at 10:30", NOW).epoch, at(2026, 12, 18, 10, 30)));
  it("same weekday means next week", () => assert.equal(parseWhen("tuesday", NOW, 9).epoch, at(2026, 12, 22, 9)));
  it("day and month, rolling into next year when past", () => {
    assert.equal(parseWhen("20 december", NOW, 17).epoch, at(2026, 12, 20, 17));
    assert.equal(parseWhen("3 march", NOW, 9).epoch, at(2027, 3, 3, 9));
  });
  it("in N days / weeks", () => {
    assert.equal(parseWhen("in 3 days", NOW, 9).epoch, at(2026, 12, 18, 9));
    assert.equal(parseWhen("in two weeks", NOW, 9).epoch, at(2026, 12, 29, 9));
  });
  it("returns null when there is no date or time, and keeps the text", () => {
    const w = parseWhen("call the recruiter", NOW);
    assert.equal(w.epoch, null);
    assert.equal(w.rest, "call the recruiter");
  });
  it("keeps original casing in the leftover text", () => assert.equal(parseWhen("Email Priya tomorrow", NOW).rest, "Email Priya"));
  it("is DST-safe: the day after NZ daylight saving starts is 09:00 NZDT", () => {
    const eve = Math.floor(Date.parse("2026-09-26T08:00:00Z") / 1000); // Sat 26 Sep 20:00 NZST
    assert.equal(parseWhen("tomorrow at 9am", eve).epoch, Math.floor(Date.parse("2026-09-26T20:00:00Z") / 1000));
  });
});

describe("parseIntent: writes become structured intents", () => {
  it("task with due date", () => {
    assert.deepEqual(parseIntent("Add a task to call the recruiter tomorrow at 2pm", NOW), { kind: "create_task", title: "Call the recruiter", due: at(2026, 12, 16, 14) });
  });
  it("remind me", () => {
    assert.deepEqual(parseIntent("Remind me to send the thank you email on 20 december", NOW), { kind: "create_task", title: "Send the thank you email", due: at(2026, 12, 20, 17) });
  });
  it("note keeps names capitalised", () => assert.deepEqual(parseIntent("Note that Priya prefers email.", NOW), { kind: "create_note", body: "Priya prefers email" }));
  it("application with role", () => {
    assert.deepEqual(parseIntent("I applied to Acme Robotics as a graduate engineer", NOW), { kind: "create_application", company: "Acme Robotics", role: "Graduate engineer" });
  });
  it("application with role at company", () => {
    assert.deepEqual(parseIntent("I just applied for junior developer at Kōwhai Labs", NOW), { kind: "create_application", company: "Kōwhai Labs", role: "Junior developer" });
  });
  it("status change", () => assert.deepEqual(parseIntent("Move Acme to interview", NOW), { kind: "set_status", company: "Acme", status: "interview" }));
  it("rejected me / offer", () => {
    assert.deepEqual(parseIntent("Harbourline rejected me", NOW), { kind: "set_status", company: "Harbourline", status: "rejected" });
    assert.deepEqual(parseIntent("I got an offer from Northgate", NOW), { kind: "set_status", company: "Northgate", status: "offer" });
  });
  it("interview with a time", () => {
    assert.deepEqual(parseIntent("Interview with Acme on Friday at 10am", NOW), { kind: "create_interview", company: "Acme", at: at(2026, 12, 18, 10) });
  });
  it("wake word and politeness are ignored", () => assert.equal(parseIntent("Hey GRU, please add a task to buy milk", NOW).kind, "create_task"));
});

describe("parseIntent: reads and control", () => {
  it("brief", () => {
    for (const p of ["read my brief", "catch me up", "what's on today", "morning briefing"]) assert.equal(parseIntent(p, NOW).kind, p === "x" ? "" : "brief", p);
  });
  it("lists", () => {
    assert.equal(parseIntent("what are my tasks", NOW).kind, "tasks");
    assert.equal(parseIntent("any interviews coming up", NOW).kind, "interviews");
    assert.equal(parseIntent("show me the top jobs", NOW).kind, "jobs");
    assert.equal(parseIntent("what's on my agenda", NOW).kind, "agenda");
  });
  it("search notes", () => assert.deepEqual(parseIntent("search notes for wellington", NOW), { kind: "search_notes", q: "wellington" }));
  it("stop, greet, help, unknown", () => {
    assert.equal(parseIntent("stop", NOW).kind, "stop");
    assert.equal(parseIntent("hello", NOW).kind, "greet");
    assert.equal(parseIntent("what can you do", NOW).kind, "help");
    assert.deepEqual(parseIntent("the weather in paris", NOW), { kind: "unknown", heard: "the weather in paris" });
  });
});

describe("composeBriefScript", () => {
  const base = { review_count: 0, interviews_upcoming: [], missing_debriefs: [], follow_ups: [], tasks_due: 0, health: { summary: "", needs_reauth: false }, jobs: { queue_count: 0, new_count: 0, top: [], closing_soon: 0 } };
  it("is calm when nothing needs attention", () => {
    const s = composeBriefScript(base, "Good morning");
    assert.equal(s[0], "Good morning, Ani.");
    assert.ok(s.includes("Nothing is waiting on you right now."));
    assert.ok(s.at(-1)?.includes("one thing"));
  });
  it("reads out what matters, with correct plurals", () => {
    const s = composeBriefScript({ ...base, review_count: 1, tasks_due: 2, follow_ups: [{ company: "Acme", days_stale: 15 }], jobs: { queue_count: 3, new_count: 1, top: [{ title: "Graduate Engineer", company: "Acme", score: 82 }], closing_soon: 0 } }, "Good evening", "Send the CV");
    const text = s.join(" ");
    assert.match(text, /1 email waiting for your review and 2 tasks due/);
    assert.match(text, /1 follow-up due\. The longest wait is Acme, at 15 days/);
    assert.match(text, /Top match: Graduate Engineer at Acme, 82 out of 100/);
    assert.match(text, /Your focus today: Send the CV/);
  });
});

describe("parseIntent: replies to an offer, and the new questions", () => {
  it("yes and no", () => {
    for (const t of ["yes", "Yeah", "sure", "open it", "go ahead", "yes please"]) assert.equal(parseIntent(t, NOW).kind, "yes", t);
    for (const t of ["no", "not now", "skip", "next", "not interested", "no thanks"]) assert.equal(parseIntent(t, NOW).kind, "no", t);
  });
  it("asks about emails to review", () => {
    for (const t of ["what are my emails to review", "what are the unread emails", "which emails need me", "what are they", "how many new emails are waiting"]) assert.equal(parseIntent(t, NOW).kind, "review_list", t);
  });
  it("weekly summary", () => {
    for (const t of ["give me my weekly summary", "how did I do this week", "weekly review"]) assert.equal(parseIntent(t, NOW).kind, "weekly", t);
  });
  it("calendar questions pick the day", () => {
    assert.deepEqual(parseIntent("what's on my calendar tomorrow", NOW), { kind: "calendar", at: at(2026, 12, 16, 9), week: false });
    assert.deepEqual(parseIntent("what's on my calendar", NOW), { kind: "calendar", at: null, week: true });
    assert.equal(parseIntent("what's on today", NOW).kind, "brief"); // unchanged
  });
  it("commands that merely contain those words still win", () => {
    assert.equal(parseIntent("add a task to review the emails tomorrow", NOW).kind, "create_task");
  });
});

describe("composeBrief: conversational, says what it found and offers next steps", () => {
  const base = { review_count: 0, interviews_upcoming: [], missing_debriefs: [], follow_ups: [], tasks_due: 0, health: { summary: "", needs_reauth: false }, jobs: { queue_count: 0, new_count: 0, top: [], closing_soon: 0 } };
  it("reports mail events and alert vacancies, and offers to open them", () => {
    const { sentences, offers } = composeBrief({
      ...base,
      found: {
        email_events: [{ app_id: 5, company: "Fonterra", what: "rejection", moved_automatically: true }, { app_id: 7, company: "Chubb", what: "interview_invite", moved_automatically: false }],
        alert_job_count: 4,
        alert_jobs: [{ id: 11, title: "Graduate Data Analyst", company: "Acme Robotics", location: "Auckland", source: "seek", score: 78, confidence: "low" }, { id: 12, title: "Junior Developer", company: "Beta", location: null, source: "seek", score: 60, confidence: "low" }],
      },
    }, "Good morning");
    const text = sentences.join(" ");
    assert.match(text, /While you were away I read your job mail\./);
    assert.match(text, /Fonterra sent a rejection\. I've moved it to rejected, and you can undo that from Today\./);
    assert.match(text, /Chubb invited you to an interview\./);
    assert.match(text, /4 new jobs came in on your Seek alerts\./);
    assert.match(text, /The standout is Graduate Data Analyst at Acme Robotics, in Auckland, scoring 78 out of 100, so it could suit you\. Want me to open it\?/);
    assert.deepEqual(offers.map((o) => [o.kind, o.id]), [["application", 5], ["application", 7], ["job", 11], ["job", 12]]);
  });
  it("mentions deadlines and times that need confirming; a rejection awaiting review says so", () => {
    const { sentences } = composeBrief({
      ...base,
      interviews_proposed: [{ company: "Abano" }],
      deadlines_soon: [{ kind: "assessment", company: "Acme", due_at: at(2026, 12, 18, 17) }],
      found: { alert_jobs: [], alert_job_count: 0, email_events: [{ app_id: 1, company: "HelloFresh", what: "rejection", moved_automatically: false }] },
    }, "Good evening");
    const text = sentences.join(" ");
    assert.match(text, /HelloFresh sent a rejection\. It's waiting in Review for you to confirm\./);
    assert.match(text, /Abano sent interview details that need your confirmation\./);
    assert.match(text, /The assessment for Acme is due Friday at 5:00 pm\./);
  });
});
