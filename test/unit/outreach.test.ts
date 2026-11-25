import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asksForJob, draft, nameFromResume } from "../../apps/worker/src/lib/outreach.ts";

const base = { personName: "Priya Nair", role: "Data Engineer", company: "Xero", skills: ["python", "sql"], yourName: "Aniketh Kumar" };

describe("outreach drafts", () => {
  it("a connection note fits LinkedIn's 200 characters and never asks for a job", () => {
    const d = draft("connect", base);
    assert.ok(d.text.length <= 200, `${d.text.length} chars`);
    assert.equal(d.limit, 200);
    assert.ok(d.text.startsWith("Hi Priya"));
    assert.equal(asksForJob(d.text), false);
  });
  it("every kind is curiosity-first: no ask for a job, referral or opening", () => {
    for (const kind of ["connect", "coffee", "followup", "thanks", "questions"] as const) assert.equal(asksForJob(draft(kind, base).text), false, kind);
  });
  it("the question list asks about their work, skills, problems and path", () => {
    const q = draft("questions", base).text;
    assert.match(q, /normal week/);
    assert.match(q, /problem/);
    assert.match(q, /skills/);
    assert.match(q, /get into this/);
  });
  it("works with little information and signs with the resume name when there is one", () => {
    const d = draft("coffee", { personName: "Sam", role: null, company: null, skills: [], yourName: null });
    assert.ok(d.text.includes("Hi Sam"));
    assert.ok(draft("coffee", base).text.includes("Aniketh Kumar"));
  });
  it("detects drafts that drift into asking for work", () => {
    assert.equal(asksForJob("Are you hiring? I'd love a referral."), true);
  });
  it("reads a name from the top of a resume only when it looks like a name", () => {
    assert.equal(nameFromResume("Aniketh Kumar\nBSc"), "Aniketh Kumar");
    assert.equal(nameFromResume("Curriculum Vitae of a candidate\n"), null);
  });
});
