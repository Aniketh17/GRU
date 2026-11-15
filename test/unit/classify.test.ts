// Unit tests for classification rules, company extraction, linking and decision engine (spec §9, Phase 2 rev 2 §10).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classify } from "../../apps/worker/src/classify/classify.ts";
import { companyMatches, extractCompanies } from "../../apps/worker/src/classify/company.ts";
import { decide, canAutoTransition } from "../../apps/worker/src/classify/decide.ts";
import { resolveLink } from "../../apps/worker/src/classify/link.ts";
import type { MailMeta } from "../../apps/worker/src/classify/types.ts";

describe("Classification rules and negative penalties", () => {
  const baseMeta: MailMeta = {
    id: "m1",
    threadId: "t1",
    internalDate: 1700000000,
    labelIds: ["INBOX"],
    from: "Careers <careers@techcorp.com>",
    subject: "",
    listUnsubscribe: false,
    contentType: "text/plain",
    autoSubmitted: "",
  };

  it("classifies application confirmations", () => {
    const res = classify({ ...baseMeta, subject: "Thank you for applying to TechCorp" });
    assert.equal(res.cls, "application_received");
    assert.ok(res.confidence >= 0.8);
  });

  it("classifies rejections", () => {
    const res = classify({ ...baseMeta, subject: "Your application – unfortunately" });
    assert.equal(res.cls, "rejection");
    assert.ok(res.confidence >= 0.8);
  });

  it("classifies interview invitations", () => {
    const res = classify({ ...baseMeta, subject: "Invitation to interview for Junior Developer" });
    assert.equal(res.cls, "interview_invite");
  });

  it("classifies interview updates", () => {
    const res = classify({ ...baseMeta, subject: "Interview rescheduled – TechCorp" });
    assert.equal(res.cls, "interview_update");
  });

  it("classifies offers", () => {
    const res = classify({ ...baseMeta, subject: "Offer of employment – TechCorp" });
    assert.equal(res.cls, "offer");
  });

  it("penalises consumer / banking look-alikes to other", () => {
    const res = classify({ ...baseMeta, subject: "Your loan application has been received" });
    assert.equal(res.cls, "other");
  });

  it("penalises marketing look-alikes to other", () => {
    const res = classify({ ...baseMeta, subject: "Unfortunately, our 50% sale ends tonight" });
    assert.equal(res.cls, "other");
  });

  it("penalises failed payment alerts to other", () => {
    const res = classify({ ...baseMeta, subject: "Unfortunately your payment failed" });
    assert.equal(res.cls, "other");
  });

  it("marks forwarded emails as forwarded", () => {
    const res = classify({ ...baseMeta, subject: "Fwd: Interview invitation – TechCorp" });
    assert.equal(res.forwarded, true);
  });
});

describe("Company extraction", () => {
  it("extracts company from display name with recruiter role suffix removed", () => {
    const guesses = extractCompanies(
      { name: "Harbourline Careers", address: "jobs@harbourline.com", domain: "harbourline.com" },
      "Your application",
    );
    assert.ok(guesses.some((g) => g.norm === "harbourline"));
  });

  it("extracts company from subject line", () => {
    const guesses = extractCompanies(
      { name: "Talent Team", address: "jobs@greenhouse.io", domain: "greenhouse.io" },
      "Thank you for applying to Kōwhai Labs",
    );
    assert.ok(guesses.some((g) => g.norm === "kowhai labs"));
  });

  it("companyMatches handles macrons and prefix matching safely", () => {
    assert.equal(companyMatches("kowhai labs", "kowhai labs"), true);
    assert.equal(companyMatches("fonterra te matapuna", "fonterra"), true);
    assert.equal(companyMatches("anaplan", "ana"), false);
  });
});

describe("Link resolution", () => {
  const apps = [
    { id: 1, company_norm: "harbourline", status: "applied" as const },
    { id: 2, company_norm: "kowhai labs", status: "applied" as const },
    { id: 3, company_norm: "akau data", status: "applied" as const },
    { id: 4, company_norm: "akau data labs", status: "applied" as const },
  ];

  it("links by thread when thread match exists", () => {
    const res = resolveLink([], apps, 2);
    assert.equal(res.appId, 2);
    assert.equal(res.via, "thread");
    assert.equal(res.ambiguous, false);
  });

  it("links by company when exactly one company matches", () => {
    const guesses = [{ name: "Harbourline", norm: "harbourline", source: "subject" as const, confident: true }];
    const res = resolveLink(guesses, apps, null);
    assert.equal(res.appId, 1);
    assert.equal(res.via, "company");
    assert.equal(res.ambiguous, false);
  });

  it("flags ambiguous when multiple companies match without thread", () => {
    const guesses = [{ name: "Ākau Data", norm: "akau data", source: "subject" as const, confident: true }];
    const res = resolveLink(guesses, apps, null);
    assert.equal(res.appId, null);
    assert.equal(res.ambiguous, true);
  });
});

describe("Decision engine and forward-only state transitions", () => {
  it("prevents backward status transitions automatically", () => {
    assert.equal(canAutoTransition("interview", "assessment"), false);
    assert.equal(canAutoTransition("offer", "interview"), false);
    assert.equal(canAutoTransition("rejected", "interview"), false);
    assert.equal(canAutoTransition("applied", "interview"), true);
  });

  it("routes high-impact transitions (interview, rejection, offer) to review by default", () => {
    const link = { appId: 1, appStatus: "applied" as const, via: "company" as const, company: null, ambiguous: false };
    const classification = {
      cls: "interview_invite" as const,
      confidence: 0.95,
      ruleId: "interview.invite",
      tie: false,
      forwarded: false,
      sender: { name: "Recruiter", address: "recruiter@acme.com", domain: "acme.com" },
    };
    const decision = decide(classification, link, { autoApplyHighImpact: false });
    assert.equal(decision.action, "review");
  });

  it("routes ambiguous and forwarded emails to review", () => {
    const link = { appId: 1, appStatus: "applied" as const, via: "company" as const, company: null, ambiguous: false };
    const classification = {
      cls: "interview_invite" as const,
      confidence: 0.95,
      ruleId: "interview.invite",
      tie: false,
      forwarded: true, // forwarded
      sender: { name: "Friend", address: "friend@gmail.com", domain: "gmail.com" },
    };
    const decision = decide(classification, link);
    assert.equal(decision.action, "review");
  });
});
