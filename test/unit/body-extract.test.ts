// Fact extraction from job-email text: position, meeting link, interview time. Plus a CPU-cost check (Workers Free = 10 ms).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countJobLinks, extractVacancies } from "../../apps/worker/src/classify/alerts.ts";
import { extractInterviewTimes, extractMeetingLink, extractRoleFromBody } from "../../apps/worker/src/classify/body.ts";
import { classifyBody } from "../../apps/worker/src/classify/bodyrules.ts";
import { extractDeadlines } from "../../apps/worker/src/classify/deadlines.ts";
import { GMAIL_FULL_FIELDS } from "../../apps/worker/src/gmail/constants.ts";
import { htmlToText, messageBody, mimeShape } from "../../apps/worker/src/gmail/body.ts";
import { aucklandToEpoch } from "../../apps/worker/src/lib/when.ts";
import { b64urlEncode, utf8 } from "../../apps/worker/src/crypto/b64.ts";

const REF = Math.floor(Date.parse("2026-11-12T00:00:00Z") / 1000); // Thu 12 Nov 2026 (NZ)

describe("extractRoleFromBody", () => {
  it("finds labelled and sentence forms", () => {
    assert.equal(extractRoleFromBody("Hi Ani,\nThanks for your interest.\nPosition: Data Analyst\nRegards"), "Data Analyst");
    assert.equal(extractRoleFromBody("Thank you for applying for the position of Graduate Software Engineer at Abano Healthcare. We will be in touch."), "Graduate Software Engineer");
    assert.equal(extractRoleFromBody("We received your application for Junior Data Engineer - Auckland. Next steps follow."), "Junior Data Engineer");
  });
  it("returns nothing rather than guessing", () => {
    assert.equal(extractRoleFromBody("Thanks for applying. We will review your CV and be in touch soon."), null);
  });
});

describe("extractMeetingLink", () => {
  it("finds known meeting hosts in html or text and ignores everything else", () => {
    const html = '<a href="https://acme.zoom.us/j/123456789?pwd=abc&amp;uname=Ani">Join</a> <a href="https://track.example.com/unsub">Unsubscribe</a>';
    assert.deepEqual(extractMeetingLink("", html), { url: "https://acme.zoom.us/j/123456789?pwd=abc&uname=Ani", kind: "Zoom" });
    assert.equal(extractMeetingLink("Join: https://meet.google.com/abc-defg-hij.", "")?.url, "https://meet.google.com/abc-defg-hij");
    assert.equal(extractMeetingLink("https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0?context=1", "")?.kind, "Teams");
    assert.equal(extractMeetingLink("See https://example.com/careers and https://calendly.com/x/y", ""), null);
  });
});

describe("extractInterviewTimes", () => {
  it("reads a day-month-time in Auckland time (NZDT)", () => {
    const r = extractInterviewTimes("Your interview is on Monday, 16 November 2026 at 10:30 AM NZDT via Zoom.", REF);
    assert.deepEqual(r.times, [aucklandToEpoch(2026, 11, 16, 10, 30)]);
  });
  it("handles month-first, 24h and d/m/y forms; assumes Auckland when no zone is given", () => {
    assert.deepEqual(extractInterviewTimes("Interview: November 17, 2:00pm", REF).times, [aucklandToEpoch(2026, 11, 17, 14, 0)]);
    assert.deepEqual(extractInterviewTimes("Time: 18 Nov 14:15", REF).times, [aucklandToEpoch(2026, 11, 18, 14, 15)]);
    assert.deepEqual(extractInterviewTimes("Date 19/11/2026 at 9am", REF).times, [aucklandToEpoch(2026, 11, 19, 9, 0)]);
  });
  it("skips times stated in another time zone and flags it", () => {
    const r = extractInterviewTimes("Interview on 16 November 2026 at 10:00 AM PST", REF);
    assert.deepEqual(r.times, []);
    assert.equal(r.foreign, true);
  });
  it("ignores dates without a time, and dates in the past", () => {
    assert.deepEqual(extractInterviewTimes("Applications close 30 November.", REF).times, []);
    assert.deepEqual(extractInterviewTimes("You applied on 3 November at 9am", REF).times, []);
  });
  it("returns several slots when offered several, so Ani picks", () => {
    assert.equal(extractInterviewTimes("Option 1: 16 Nov at 10am. Option 2: 17 Nov at 2pm.", REF).times.length, 2);
  });
});

describe("message body decoding and cost", () => {
  const b64 = (s: string) => b64urlEncode(utf8.encode(s));
  it("prefers text/plain, falls back to converted HTML, and decodes entities", () => {
    const html = "<html><head><style>p{}</style></head><body><p>Interview &amp; next steps</p><br>Position: Data Analyst</body></html>";
    const msg = { id: "1", threadId: "t", internalDate: "0", payload: { mimeType: "multipart/alternative", parts: [{ mimeType: "text/html", body: { data: b64(html) } }] } };
    assert.match(messageBody(msg).text, /Interview & next steps\nPosition: Data Analyst/);
    const both = { ...msg, payload: { mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: b64("plain wins") } }, { mimeType: "text/html", body: { data: b64(html) } }] } };
    assert.equal(messageBody(both).text.trim(), "plain wins");
    assert.equal(htmlToText("<script>alert(1)</script>Hi&nbsp;there"), "Hi there");
  });

  it("the whole understanding pipeline on a worst-case email stays far below the 10 ms Workers Free CPU limit", () => {
    const jobs = Array.from({ length: 110 }, (_, i) => `<table><tr><td><a href="https://www.linkedin.com/comm/jobs/view/37123${String(i).padStart(5, "0")}/?trackingId=${"x".repeat(80)}">Software Engineer ${i}</a></td></tr><tr><td>Company ${i} · Auckland</td></tr></table><div>${"Lorem ipsum dolor sit amet. ".repeat(12)}</div>`).join("");
    const html = `<html><body>${jobs}<p>Position: Data Analyst</p><p>Interview on 16 November 2026 at 10:30 AM NZDT</p><a href="https://acme.zoom.us/j/1">Join</a></body></html>`;
    const msg = { id: "1", threadId: "t", internalDate: "0", payload: { mimeType: "text/html", body: { data: b64(html) } } };
    const once = () => {
      const { text, html: h } = messageBody(msg);
      classifyBody(text, countJobLinks(h));
      extractVacancies(h);
      extractRoleFromBody(text);
      extractMeetingLink(text, h);
      extractInterviewTimes(text, REF);
      extractDeadlines(text, REF, "assessment");
    };
    once(); // warm up
    // Best of several batches, so a busy machine (other tests running) doesn't fail an honest measurement.
    let best = Infinity;
    for (let batch = 0; batch < 5; batch++) {
      const t0 = performance.now();
      for (let i = 0; i < 4; i++) once();
      best = Math.min(best, (performance.now() - t0) / 4);
    }
    assert.ok(html.length > 50_000, "fixture exceeds the html cap");
    assert.ok(best < 8, `pipeline ${best.toFixed(2)} ms per email`);
  });
});

describe("reading real-world emails", () => {
  const b64 = (t: string) => b64urlEncode(utf8.encode(t));
  it("asks Gmail for the MIME tree 8 levels deep (mixed > related > alternative > html and forwards need more than 3)", () => {
    assert.equal((GMAIL_FULL_FIELDS.match(/parts\(/g) ?? []).length, 8);
  });
  it("reads text from a deeply nested message", () => {
    const html = { mimeType: "text/html", body: { data: b64("<p>We chose another candidate.</p>") } };
    const msg = { id: "1", threadId: "t", internalDate: "0", payload: { mimeType: "multipart/mixed", parts: [{ mimeType: "multipart/mixed", parts: [{ mimeType: "multipart/related", parts: [{ mimeType: "multipart/alternative", parts: [html] }] }] }] } };
    assert.match(messageBody(msg).text, /We chose another candidate/);
  });
  it("does not mistake <header> for <head> and wipe the page", () => {
    assert.equal(htmlToText("<html><body><header>Hi Ani</header><p>We regret to inform you</p></body></html>"), "Hi Ani We regret to inform you".replace("Hi Ani ", "Hi Ani ") );
    assert.match(htmlToText("<html><head><title>x</title></head><body>Body text</body></html>"), /^Body text$/);
  });
  it("describes an email's shape (types and sizes only) for diagnosis", () => {
    const shape = mimeShape({ mimeType: "multipart/mixed", parts: [{ mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { size: 120 } }, { mimeType: "text/html", body: { size: 9800 } }] }, { mimeType: "application/pdf", body: { size: 5000, attachmentId: "x" } }] });
    assert.equal(shape, "multipart/mixed[multipart/alternative[text/plain:120,text/html:9800],application/pdf:5000*]");
  });
});
