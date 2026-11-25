import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encText } from "../../apps/worker/src/lib/enc.ts";
import { call, clearAuthState, login } from "./helpers.ts";

let cookie = "";
beforeEach(async () => { cookie = await login(); });
afterEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM job_matches"), env.DB.prepare("DELETE FROM jobs"), env.DB.prepare("DELETE FROM events"),
    env.DB.prepare("DELETE FROM applications"), env.DB.prepare("DELETE FROM emails_seen"), env.DB.prepare("DELETE FROM sender_rules"),
  ]);
  await clearAuthState();
});

const addApp = (company: string, role: string | null, status = "applied") => env.DB.prepare(
  "INSERT INTO applications (company, company_norm, role, role_norm, source, status, applied_at, last_event_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'seek', ?, 1700000000, 1700000000, 1700000000, 1700000000)",
).bind(company, company.toLowerCase(), role, role?.toLowerCase() ?? null, status).run();

describe("already-applied detection", () => {
  it("hides a vacancy that matches an application, says why, and can be overridden", async () => {
    await addApp("Acme Robotics", "Data Engineer");
    const mk = (title: string, company: string, url: string) => call("/api/jobs", { json: { title, company, url }, cookie });
    const dup = (await (await mk("Data Engineer (Remote)", "Acme Robotics", "https://example.com/a")).json()) as { id: number };
    await mk("Marketing Lead", "Acme Robotics", "https://example.com/b");
    await mk("Data Engineer", "Other Co", "https://example.com/c");

    const q = (await (await call("/api/jobs/queue", { cookie })).json()) as { likely_applied: { id: number; dedupe: { reason: string } }[] };
    expect(q.likely_applied.map((j) => j.id)).toEqual([dup.id]);
    expect(q.likely_applied[0]?.dedupe.reason).toContain("Acme Robotics");

    const open = (await (await call("/api/jobs?status=open", { cookie })).json()) as { items: { id: number }[] };
    expect(open.items.map((j) => j.id)).not.toContain(dup.id);
    expect(open.items).toHaveLength(2);

    const ins = (await (await call(`/api/jobs/${dup.id}/insights`, { cookie })).json()) as { applied: { status: string } | null; company_history: unknown[] };
    expect(ins.applied?.status).toBe("likely_applied");
    expect(ins.company_history).toHaveLength(1);

    expect((await call(`/api/jobs/${dup.id}/not-same`, { json: {}, cookie })).status).toBe(200);
    const after = (await (await call("/api/jobs/queue", { cookie })).json()) as { likely_applied: unknown[] };
    expect(after.likely_applied).toHaveLength(0); // the override sticks
  });
});

describe("inbox triage", () => {
  const seed = async (gmailId: string, domain: string) => {
    await env.DB.prepare("INSERT INTO emails_seen (account_id, gmail_id, thread_id, internal_date, from_domain, class, confidence, rule_id, disposition, body_checked, body_chars, subject_enc, from_enc) VALUES (1, ?, 't', ?, ?, 'other', 0.5, 'x', 'candidate', 1, 120, ?, ?)")
      .bind(gmailId, Math.floor(Date.now() / 1000) - 3600, domain, await encText(env, "emails_seen", "subject_enc", `1:${gmailId}`, "An update from us"), await encText(env, "emails_seen", "from_enc", `1:${gmailId}`, `Talent <jobs@${domain}>`)).run();
  };

  it("lists unclassified mail with its subject, and classifying creates and updates an application", async () => {
    await seed("abcdef1", "hiring.example");
    const inbox = (await (await call("/api/inbox", { cookie })).json()) as { items: { subject: string; from: string }[] };
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]?.subject).toBe("An update from us");
    const r = (await (await call("/api/inbox/classify", { json: { account_id: 1, gmail_id: "abcdef1", class: "rejection", create: { company: "Hiring Example", role: "Analyst" } }, cookie })).json()) as { app_id: number };
    const app = await env.DB.prepare("SELECT status FROM applications WHERE id = ?").bind(r.app_id).first<{ status: string }>();
    expect(app?.status).toBe("rejected");
    const row = await env.DB.prepare("SELECT subject_enc, user_class, disposition FROM emails_seen WHERE gmail_id = 'abcdef1'").first<{ subject_enc: string | null; user_class: string; disposition: string }>();
    expect(row).toMatchObject({ subject_enc: null, user_class: "rejection", disposition: "linked" });
    expect(((await (await call("/api/inbox/count", { cookie })).json()) as { count: number }).count).toBe(0);
  });

  it("not-job-related forgets the mail and can block the sender so nothing else from it is kept", async () => {
    await seed("abcdef2", "newsletter.example");
    await seed("abcdef3", "newsletter.example");
    const r = (await (await call("/api/inbox/ignore", { json: { account_id: 1, gmail_id: "abcdef2", block_sender: true }, cookie })).json()) as { blocked: string };
    expect(r.blocked).toBe("newsletter.example");
    const rows = await env.DB.prepare("SELECT gmail_id, ignored, subject_enc FROM emails_seen ORDER BY gmail_id").all<{ ignored: number; subject_enc: string | null }>();
    expect(rows.results.every((x) => x.ignored === 1 && x.subject_enc === null)).toBe(true);
    expect((await env.DB.prepare("SELECT domain FROM sender_rules").first<{ domain: string }>())?.domain).toBe("newsletter.example");
    expect(((await (await call("/api/inbox", { cookie })).json()) as { items: unknown[]; blocked: string[] }).blocked).toEqual(["newsletter.example"]);
    await call("/api/inbox/rules/newsletter.example", { method: "DELETE", json: {}, cookie });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM sender_rules").first<{ n: number }>())?.n).toBe(0);
  });
});
