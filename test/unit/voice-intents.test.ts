// Voice V1 command grammar: deterministic parsing, Auckland dates, DST-safe, casing preserved.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aucklandToEpoch, composeBriefScript, parseIntent, parseWhen } from "../../apps/web/src/lib/voice-intents.ts";

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
