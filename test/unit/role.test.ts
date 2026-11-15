// Position and source extraction from headers only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractRole, sourceForDomain } from "../../apps/worker/src/classify/role.ts";

describe("extractRole", () => {
  const cases: [string, string | null][] = [
    ["Your application to Graduate Software Engineer at Acme Robotics", "Graduate Software Engineer"],
    ["Thank you for applying for the Junior Developer position at Kōwhai Labs", "Junior Developer"],
    ["Application submitted for Graduate Developer", "Graduate Developer"],
    ["Your application for Data Analyst (Ref 4471) has been received", "Data Analyst"],
    ["Application received: Backend Engineer - Auckland", "Backend Engineer"],
    ["Interview for Graduate Data Engineer at Northgate Health", "Graduate Data Engineer"],
    ["Re: Your application for the Machine Learning Engineer role", "Machine Learning Engineer"],
    ["Thank you for applying to Acme Robotics", null],
    ["Your application was sent to Acme Robotics", null],
    ["We received your application", null],
    ["Update on your application", null],
    ["Weekly job alert: 12 new jobs for you", null],
  ];
  for (const [subject, want] of cases) it(`${subject}`, () => assert.equal(extractRole(subject), want));
});

describe("sourceForDomain", () => {
  it("recognises job boards, otherwise a direct email", () => {
    assert.equal(sourceForDomain("s.seek.co.nz"), "seek");
    assert.equal(sourceForDomain("jobs-noreply.linkedin.com"), "linkedin");
    assert.equal(sourceForDomain("indeed.com"), "other");
    assert.equal(sourceForDomain("careers.acme.co.nz"), "email");
    assert.equal(sourceForDomain(""), "email");
  });
});
