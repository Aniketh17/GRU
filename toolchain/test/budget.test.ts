import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { BudgetExhausted, SubrequestBudget } from "../../apps/worker/src/db/budget.ts";
import { Db } from "../../apps/worker/src/db/client.ts";

describe("SubrequestBudget", () => {
  it("allows 40 calls and rejects the 41st", () => {
    const b = new SubrequestBudget();
    for (let i = 0; i < 40; i++) b.take();
    expect(b.remaining).toBe(0);
    expect(() => b.take()).toThrow(BudgetExhausted);
  });

  it("charges D1 calls, and a batch counts once", async () => {
    const db = new Db(env.DB, new SubrequestBudget(3));
    await db.first("SELECT 1 AS x");
    await db.batch([db.stmt("SELECT 1"), db.stmt("SELECT 2"), db.stmt("SELECT 3")]);
    expect(db.budget.usedCount).toBe(2);
    await db.all("SELECT 1");
    await expect(db.run("SELECT 1")).rejects.toBeInstanceOf(BudgetExhausted);
  });

  it("an empty batch costs nothing", async () => {
    const db = new Db(env.DB, new SubrequestBudget(1));
    await db.batch([]);
    expect(db.budget.usedCount).toBe(0);
  });
});

describe("D1 batch atomicity (D-004)", () => {
  it("rolls back earlier statements when a later one fails", async () => {
    await expect(
      env.DB.batch([
        env.DB.prepare("INSERT INTO kv (k, v) VALUES ('atomic_probe', 'x')"),
        env.DB.prepare("INSERT INTO table_that_does_not_exist VALUES (1)"),
      ]),
    ).rejects.toThrow();
    const row = await env.DB.prepare("SELECT v FROM kv WHERE k = 'atomic_probe'").first();
    expect(row).toBeNull();
  });
});
