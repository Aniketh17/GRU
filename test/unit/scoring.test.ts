// Deterministic job scoring (spec section 10): evidence-only, reproducible, provisional when thin.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bandFor, extractResumeFacts, scoreJob } from "../../apps/worker/src/jobs/scoring.ts";

const RESUME = `Ani Example. Graduate software engineer in Auckland, New Zealand.
BSc Computer Science. Projects: built a REST API in Python with FastAPI and PostgreSQL, deployed with Docker on AWS.
Built a React and TypeScript dashboard. Used Git and pytest. Interested in machine learning and backend roles.`;
const facts = extractResumeFacts(RESUME);

const DESC = `We are hiring a graduate backend engineer in Auckland. You will build APIs in Python and PostgreSQL, ship with Docker and write tests with pytest.
Requirements: Python, PostgreSQL, Docker, REST. A degree in computer science.
Nice to have: Kubernetes, Terraform.`;

describe("extractResumeFacts", () => {
  it("lists only skills literally present, with evidence snippets", () => {
    const names = facts.skills.map((s) => s.skill);
    assert.ok(names.includes("python") && names.includes("postgresql") && names.includes("docker"));
    assert.ok(!names.includes("kubernetes") && !names.includes("java"));
    assert.ok(facts.skills.find((s) => s.skill === "python")?.evidence.toLowerCase().includes("python"));
    assert.equal(facts.has_degree, true);
  });
  it("does not match skills inside other words (java vs javascript, r vs words)", () => {
    const f = extractResumeFacts("I know JavaScript and reasoning.");
    assert.deepEqual(f.skills.map((s) => s.skill), ["javascript"]);
  });
});

describe("scoreJob", () => {
  const strong = scoreJob(RESUME, facts, { title: "Graduate Backend Engineer", location: "Auckland", description: DESC });
  it("components sum to the total and stay within weights", () => {
    const c = strong.components;
    assert.equal(c.skills + c.role + c.experience + c.education + c.location + c.work_type + c.domain, strong.score);
    assert.ok(c.skills <= 35 && c.role <= 20 && c.experience <= 15 && c.education <= 10 && c.location <= 10 && c.work_type <= 5 && c.domain <= 5);
  });
  it("scores a well-matched graduate role highly with evidence and a preferred-skill gap", () => {
    assert.ok(strong.score >= 65, `score ${strong.score}`);
    assert.equal(strong.provisional, false);
    assert.ok(strong.matched.length >= 3);
    assert.ok(strong.gaps.some((g) => g.includes("kubernetes")));
  });
  it("is reproducible", () => {
    assert.deepEqual(scoreJob(RESUME, facts, { title: "Graduate Backend Engineer", location: "Auckland", description: DESC }), strong);
  });
  it("penalises missing required skills and senior roles", () => {
    const bad = scoreJob(RESUME, facts, { title: "Senior Java Architect", location: "London", description: "Requirements: Java, Spring Boot, Kafka, 8+ years experience leading teams. ".repeat(4) });
    assert.ok(bad.score < 50, `score ${bad.score}`);
    assert.ok(bad.gaps.some((g) => g.startsWith("Required skill not evidenced")));
    assert.ok(bad.gaps.some((g) => g.includes("Seniority")));
  });
  it("marks title-only vacancies provisional with low confidence", () => {
    const m = scoreJob(RESUME, facts, { title: "Graduate Software Engineer", location: "Auckland" });
    assert.equal(m.provisional, true);
    assert.equal(m.confidence, "low");
    assert.match(m.explanation, /Provisional/);
  });
});

describe("bandFor", () => {
  it("uses the spec bands", () => {
    assert.deepEqual([100, 80, 79, 65, 64, 50, 49, 0].map(bandFor), ["strong", "strong", "good", "good", "possible", "possible", "low", "low"]);
  });
});

describe("provisional (title-only) scores, e.g. vacancies from job-alert emails", () => {
  it("are scaled to 100 from what can be judged, so a genuinely suitable role can reach 'good' while staying labelled provisional", () => {
    const good = scoreJob(RESUME, facts, { title: "Graduate Software Engineer", location: "Auckland" });
    assert.equal(good.provisional, true);
    assert.equal(good.confidence, "low");
    assert.equal(good.components.skills, 0); // skills were not assessed, and not invented
    assert.ok(good.score >= 65, `score ${good.score}`);
  });
  it("still rank an unsuitable title low", () => {
    const bad = scoreJob(RESUME, facts, { title: "Senior Truck Driver", location: "London" });
    assert.ok(bad.score < 50, `score ${bad.score}`);
  });
});
