import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { judge, sameCompany, titleSimilarity } from "../../apps/worker/src/lib/dedupe.ts";

const app = (company: string, role: string | null) => ({ id: 1, company, company_norm: company.toLowerCase(), role, status: "applied", applied_at: 1700000000, source: "seek" });

describe("dedupe", () => {
  it("scores title similarity on meaningful words", () => {
    assert.ok(titleSimilarity("Data Engineer (Remote)", "Data Engineer") >= 0.99);
    assert.ok(titleSimilarity("Senior Data Engineer", "Data Engineer") < 0.75);
    assert.equal(titleSimilarity("Marketing Lead", "Data Engineer"), 0);
  });
  it("matches companies by equality or containment, not by short fragments", () => {
    assert.equal(sameCompany("acme robotics", "acme robotics ltd"), true);
    assert.equal(sameCompany("ai", "ai labs"), false);
    assert.equal(sameCompany(null, "x"), false);
  });
  it("needs both company and a similar role", () => {
    assert.equal(judge({ title: "Data Engineer", company_norm: "acme robotics" }, [app("Acme Robotics", "Data Engineer")]).status, "likely_applied");
    assert.equal(judge({ title: "Data Engineer", company_norm: "acme robotics" }, [app("Acme Robotics", "Chef")]).status, "none");
    assert.equal(judge({ title: "Data Engineer", company_norm: "other" }, [app("Acme Robotics", "Data Engineer")]).status, "none");
    assert.equal(judge({ title: "Data Engineer", company_norm: "acme robotics" }, [app("Acme Robotics", null)]).status, "none");
  });
});
