// RFC 5545 writer: escaping, folding, all-day vs timed, tentative events, alarms.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildIcs, escapeText, fold } from "../../apps/worker/src/lib/ics.ts";

const NOW = Math.floor(Date.parse("2026-11-16T00:00:00Z") / 1000);

describe("ics", () => {
  it("escapes commas, semicolons, backslashes and newlines", () => {
    assert.equal(escapeText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  });
  it("folds long lines at 75 octets without splitting characters", () => {
    const line = "SUMMARY:" + "Interview · Kōwhai Labs ".repeat(12);
    const folded = fold(line);
    for (const part of folded.split("\r\n")) assert.ok(new TextEncoder().encode(part).length <= 75);
    assert.equal(folded.replace(/\r\n /g, ""), line);
  });
  it("writes a timed, confirmed interview with link, location and alarm", () => {
    const ics = buildIcs([{ uid: "interview-1", summary: "Interview · Acme", start: 1795000000, end: 1795003600, url: "https://acme.zoom.us/j/1", location: "Zoom", alarmMinutes: 30 }], NOW);
    assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
    assert.match(ics, /UID:interview-1@gru/);
    assert.match(ics, /DTSTART:\d{8}T\d{6}Z/);
    assert.match(ics, /URL:https:\/\/acme\.zoom\.us\/j\/1/);
    assert.match(ics, /LOCATION:Zoom/);
    assert.match(ics, /STATUS:CONFIRMED/);
    assert.match(ics, /BEGIN:VALARM[\s\S]*TRIGGER:-PT30M[\s\S]*END:VALARM/);
    assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  });
  it("writes all-day events with an exclusive end date and tentative status", () => {
    const ics = buildIcs([{ uid: "task-2", summary: "Call recruiter", start: "2026-12-31", tentative: true }], NOW);
    assert.match(ics, /DTSTART;VALUE=DATE:20261231\r\n/);
    assert.match(ics, /DTEND;VALUE=DATE:20270101\r\n/);
    assert.match(ics, /STATUS:TENTATIVE/);
    assert.ok(!ics.includes("VALARM"));
  });
});
