// Understanding job mail by its words: classes, vacancies in alerts, deadlines, contacts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countJobLinks, extractVacancies } from "../../apps/worker/src/classify/alerts.ts";
import { classifyBody } from "../../apps/worker/src/classify/bodyrules.ts";
import { parseFrom } from "../../apps/worker/src/classify/classify.ts";
import { extractDeadlines } from "../../apps/worker/src/classify/deadlines.ts";
import { personFromSender } from "../../apps/worker/src/classify/people.ts";
import { aucklandToEpoch } from "../../apps/worker/src/lib/when.ts";

describe("classifyBody", () => {
  const cases: [string, string | null][] = [
    ["Hi Ani, thank you for applying for the Data Analyst role. Unfortunately, we have decided to proceed with other candidates.", "rejection"],
    ["Thank you for your interest. We regret to inform you that your application has not been successful.", "rejection"],
    ["Your application was unsuccessful on this occasion.", "rejection"],
    ["We are pleased to offer you the position of Graduate Engineer. Please find your letter of offer attached.", "offer"],
    ["Thanks for applying! We would like to invite you to an interview next week. Please select a time that suits.", "interview_invite"],
    ["Your interview is confirmed for Friday. Join the Zoom meeting at the link below.", "interview_invite"],
    ["Your interview has been rescheduled to Monday at 3pm.", "interview_update"],
    ["Please complete the online coding assessment within 5 days.", "assessment"],
    ["Thank you for applying. We have received your application and will be in touch.", "application_received"],
    ["Your application is currently under review by the hiring team.", "application_update"],
    ["Hi Ani, 12 new jobs matching your search are waiting for you.", "alert"],
    ["I came across your profile and think you'd be a great fit for a role we have.", "recruiter_outreach"],
    ["Join our weekly newsletter for tips and tricks.", null],
  ];
  for (const [text, want] of cases) it(want ?? "no match", () => assert.equal(classifyBody(text)?.cls ?? null, want));

  it("an offer or rejection beats the polite 'thanks for applying' that opens many emails", () => {
    assert.equal(classifyBody("Thanks for applying. We have received your application. Unfortunately we will not be moving forward with your application.")?.cls, "rejection");
  });
  it("a digest of several job links is an alert whatever else it says", () => {
    assert.equal(classifyBody("Thank you for applying to jobs with us", 5)?.cls, "alert");
  });
  it("a negated offer is not an offer", () => {
    assert.notEqual(classifyBody("We are unable to offer you the role at this time.")?.cls, "offer");
  });
});

const SEEK = `<html><body><table>
<tr><td><a href="https://www.seek.co.nz/job/81234567?type=standard&amp;ref=email">Graduate Data Analyst</a></td></tr>
<tr><td>Acme Robotics</td></tr><tr><td>Auckland CBD, Auckland</td></tr><tr><td>$70k - $80k</td></tr>
<tr><td><a href="https://www.seek.co.nz/job/81234568?x=1">Junior Developer</a></td></tr>
<tr><td>Beta Ltd</td></tr><tr><td>Wellington</td></tr>
<tr><td><a href="https://www.seek.co.nz/job/81234568?x=2">View job</a></td></tr>
<tr><td><a href="https://www.seek.co.nz/profile">Manage job alerts</a></td></tr>
</table></body></html>`;

const LINKEDIN = `<html><body>
<a href="https://www.linkedin.com/comm/jobs/view/3712345678/?trackingId=abc&amp;refId=x">Software Engineer</a>
<p>Acme Robotics · Auckland, New Zealand</p><p>Promoted</p>
<a href="https://www.linkedin.com/comm/jobs/view/3712345999/?trackingId=abd">Data Engineer</a>
<p>Northgate Health · Wellington, New Zealand</p>
<a href="https://www.linkedin.com/comm/jobs/view/3712346000/?trackingId=abe">ML Engineer</a>
<p>Beta Ltd · Remote</p>
<a href="https://www.linkedin.com/comm/jobs/?keywords=x">See all jobs</a></body></html>`;

describe("extractVacancies", () => {
  it("reads Seek alerts: title, company, location, canonical link; ignores non-job links and duplicates", () => {
    const v = extractVacancies(SEEK);
    assert.deepEqual(v, [
      { title: "Graduate Data Analyst", company: "Acme Robotics", location: "Auckland CBD, Auckland", url: "https://www.seek.co.nz/job/81234567", source: "seek" },
      { title: "Junior Developer", company: "Beta Ltd", location: "Wellington", url: "https://www.seek.co.nz/job/81234568", source: "seek" },
    ]);
    assert.equal(countJobLinks(SEEK), 2);
  });
  it("reads LinkedIn alerts (company · location lines)", () => {
    const v = extractVacancies(LINKEDIN);
    assert.equal(v.length, 3);
    assert.deepEqual(v[0], { title: "Software Engineer", company: "Acme Robotics", location: "Auckland, New Zealand", url: "https://www.linkedin.com/jobs/view/3712345678", source: "linkedin" });
    assert.equal(v[2]?.location, "Remote");
    assert.equal(countJobLinks(LINKEDIN), 3);
  });
  it("finds nothing in an ordinary email", () => {
    assert.deepEqual(extractVacancies('<a href="https://example.com/news">Read more</a>'), []);
  });
});

describe("extractDeadlines", () => {
  const ref = Math.floor(Date.parse("2026-11-12T00:00:00Z") / 1000);
  it("assessment deadline with a date (default 5pm)", () => {
    assert.deepEqual(extractDeadlines("Please complete the assessment by 20 November 2026.", ref, "assessment"), [{ at: aucklandToEpoch(2026, 11, 20, 17, 0), kind: "assessment" }]);
  });
  it("a stated time is respected, and 'within N days' is relative to the email", () => {
    assert.equal(extractDeadlines("Please respond by 18 Nov at 9am.", ref, "offer")[0]?.at, aucklandToEpoch(2026, 11, 18, 9, 0));
    const w = extractDeadlines("Complete the test within 5 days.", ref, "assessment");
    assert.equal(w.length, 1);
    assert.ok(Math.abs((w[0]?.at ?? 0) - (ref + 5 * 86400)) <= 900);
  });
  it("ignores dates with no deadline wording and classes that have no deadlines", () => {
    assert.deepEqual(extractDeadlines("Our office opened on 3 November 2026.", ref, "assessment"), []);
    assert.deepEqual(extractDeadlines("Please complete by 20 November.", ref, "rejection"), []);
  });
});

describe("personFromSender", () => {
  const p = (from: string) => personFromSender(parseFrom(from));
  it("accepts a real person and strips the company suffix", () => {
    assert.deepEqual(p("Sam Patel <sam.patel@harbourline.co.nz>"), { name: "Sam Patel", address: "sam.patel@harbourline.co.nz" });
    assert.equal(p("Priya Nair from Acme <priya@acme.co.nz>")?.name, "Priya Nair");
  });
  it("rejects systems, no-reply addresses, teams and job boards", () => {
    assert.equal(p("Harbourline Careers <careers@harbourline.co.nz>"), null);
    assert.equal(p("Sam Patel <noreply@harbourline.co.nz>"), null);
    assert.equal(p("Sam Patel <sam@smartrecruiters.com>"), null);
    assert.equal(p("SEEK <noreply@seek.co.nz>"), null);
    assert.equal(p("Talent Acquisition Team <hr@acme.co.nz>"), null);
    assert.equal(p("<jobs@acme.co.nz>"), null);
  });
});
