import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkGrounded } from "../../apps/worker/src/lib/grounding.ts";
import { analyse, resumeBullets } from "../../apps/web/src/lib/tailor.ts";

const RESUME = `Aniketh
BSc Computer Science, University of Auckland

Projects
- Built GRU, a job-search assistant on Cloudflare Workers with TypeScript and D1, handling 5,000 emails a day
- Trained a PyTorch image classifier reaching 92% accuracy on a public dataset
- Organised the student robotics club and ran weekly meetings for 40 members

Skills
Python, TypeScript, SQL, Git, Docker
`;
const POSTING = `Graduate Data Engineer. Requirements: experience with Python and SQL. You must know Kafka and Airflow.
Nice to have: Docker, Kubernetes. We use Kafka heavily. Airflow pipelines are core to the role.`;

describe("tailor analysis", () => {
  it("finds the keywords the posting stresses that the resume lacks, most important first", () => {
    const a = analyse(RESUME, POSTING, "Graduate Data Engineer");
    const missing = a.keywords.filter((k) => k.state === "missing").map((k) => k.keyword);
    assert.ok(missing.includes("kafka") && missing.includes("airflow"));
    assert.ok(!a.keywords.some((k) => k.keyword === "python" && k.state === "missing"));
    assert.ok(a.keywords.length <= 8);
    assert.ok(a.coverage > 0 && a.coverage < 100);
  });
  it("only offers resume lines that really exist as achievements and targets", () => {
    const a = analyse(RESUME, POSTING, "Graduate Data Engineer");
    const lines = resumeBullets(RESUME);
    assert.equal(a.achievements.length, 2);
    for (const x of a.achievements) assert.ok(lines.includes(x.text));
    for (const t of a.targets) assert.ok(lines.includes(t));
    assert.equal(a.targets.length, 3);
  });
  it("suggests an education-first layout for a graduate role and never invents skills in the summary line", () => {
    const a = analyse(RESUME, POSTING, "Graduate Data Engineer");
    assert.equal(a.layout.sectionOrder[1], "Education");
    assert.ok(!/kafka|airflow/i.test(a.layout.summary ?? ""));
  });
});

describe("grounding: no invented claims", () => {
  it("accepts a rewrite that only reuses facts from the resume", () => {
    const g = checkGrounded("Built GRU, a job-search assistant, with TypeScript on Cloudflare Workers and D1", RESUME);
    assert.deepEqual(g, { ok: true, flagged: [] });
  });
  it("flags invented numbers, tools and names", () => {
    const g = checkGrounded("Built GRU with Kafka, serving 10,000 users at Google", RESUME);
    assert.equal(g.ok, false);
    assert.ok(g.flagged.includes("kafka") && g.flagged.includes("10000") && g.flagged.includes("google"));
  });
  it("treats a number that is in the resume as grounded", () => {
    assert.equal(checkGrounded("Reached 92% accuracy with PyTorch", RESUME).ok, true);
  });
});

describe("resume bullets", () => {
  it("ignores skills lists, education lines and headings", () => {
    const lines = resumeBullets("Skills: Python, TypeScript, SQL, Docker, Git\nBSc Computer Science, University of Auckland\nProjects\n- Built a tool that saved the team five hours every week");
    assert.deepEqual(lines, ["Built a tool that saved the team five hours every week"]);
  });
});
