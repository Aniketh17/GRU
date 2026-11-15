// Mail details: position and source from headers, real email timestamps, and one-time enrichment of existing rows.
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aadFor, encryptField, keyringFromEnv } from "../../apps/worker/src/crypto/envelope.ts";
import { runTick } from "../../apps/worker/src/tick.ts";
import { call, clearAuthState, login, testEnv } from "./helpers.ts";

const EMAIL = "ani.primary@gmail.com";
const mockEnv = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", ALLOWED_EMAILS: EMAIL };
let cookie = "";

beforeEach(async () => {
  cookie = await login();
  const now = Math.floor(Date.now() / 1000);
  const enc = await encryptField(keyringFromEnv(testEnv()), "tok", aadFor("mail_accounts", "access_token", EMAIL));
  await env.DB.prepare(
    "INSERT INTO mail_accounts (email, label, access_token_enc, access_expires_at, status, backfill_done, history_id, created_at) VALUES (?, ?, ?, ?, 'active', 1, 'h1', ?)",
  ).bind(EMAIL, EMAIL, enc, now + 3600, now).run();
});
afterEach(async () => {
  await env.DB.batch(["events", "applications", "review_queue", "emails_seen", "mail_accounts"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await clearAuthState();
});

interface Msg { id: string; thread: string; from: string; subject: string; at: number }
const gmail = (msgs: Msg[], history: boolean) => async (input: RequestInfo | URL) => {
  const u = typeof input === "string" ? input : input.toString();
  if (u.includes("/batch/gmail/v1")) {
    const b = "bb";
    const parts = msgs.flatMap((m, i) => [
      `--${b}`, "Content-Type: application/http", `Content-ID: <response-${i + 1}>`, "", "HTTP/1.1 200 OK", "Content-Type: application/json; charset=UTF-8", "",
      JSON.stringify({ id: m.id, threadId: m.thread, labelIds: ["INBOX"], internalDate: String(m.at * 1000), payload: { headers: [{ name: "From", value: m.from }, { name: "Subject", value: m.subject }] } }),
    ]);
    return new Response([...parts, `--${b}--`].join("\r\n"), { status: 200, headers: { "Content-Type": `multipart/mixed; boundary=${b}` } });
  }
  if (history && u.includes("/history?")) {
    return new Response(JSON.stringify({ historyId: "h2", history: [{ id: "1", messagesAdded: msgs.map((m) => ({ message: { id: m.id, threadId: m.thread } })) }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (u.includes("/history?")) return new Response(JSON.stringify({ historyId: "h2" }), { status: 200, headers: { "Content-Type": "application/json" } });
  return new Response("nf", { status: 404 });
};

describe("mail details", () => {
  it("creates the application with the position, source and the email's own date", async () => {
    const now = Math.floor(Date.now() / 1000);
    const at = now - 2 * 86400 - 3600;
    await runTick(testEnv(mockEnv), now, gmail([{ id: "m1", thread: "t1", from: "Acme Talent <no-reply@acme-careers.co.nz>", subject: "Thank you for applying for the Graduate Engineer position at Acme Robotics", at }], true) as unknown as typeof fetch);
    const app = await env.DB.prepare("SELECT company, role, source, applied_at, last_event_at FROM applications").first<Record<string, unknown>>();
    expect(app).toMatchObject({ role: "Graduate Engineer", source: "email", applied_at: at, last_event_at: at });
    const list = (await (await call("/api/applications?status=all", { cookie })).json()) as { items: { role: string; applied_at: number }[] };
    expect(list.items[0]).toMatchObject({ role: "Graduate Engineer", applied_at: at });
  });

  it("enriches already-imported emails once: fills a missing position, corrects the source, keeps Ani's edits", async () => {
    const now = Math.floor(Date.now() / 1000);
    const at = now - 86400;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO applications (id, company, company_norm, status, source, applied_at, last_event_at, created_at, updated_at) VALUES (1, 'Acme', 'acme', 'applied', 'email', ?1, ?1, ?1, ?1)").bind(at),
      env.DB.prepare("INSERT INTO applications (id, company, company_norm, role, role_norm, status, source, applied_at, last_event_at, created_at, updated_at) VALUES (2, 'Beta', 'beta', 'My own title', 'my own title', 'applied', 'email', ?1, ?1, ?1, ?1)").bind(at),
      env.DB.prepare("INSERT INTO emails_seen (account_id, gmail_id, thread_id, internal_date, from_domain, class, disposition, app_id) SELECT id, 'old1', 'to1', ?, 'seek.co.nz', 'application_received', 'auto_applied', 1 FROM mail_accounts").bind(at),
      env.DB.prepare("INSERT INTO emails_seen (account_id, gmail_id, thread_id, internal_date, from_domain, class, disposition, app_id) SELECT id, 'old2', 'to2', ?, 'beta.co.nz', 'application_received', 'auto_applied', 2 FROM mail_accounts").bind(at),
    ]);
    const msgs: Msg[] = [
      { id: "old1", thread: "to1", from: "SEEK <noreply@s.seek.co.nz>", subject: "Your application for Junior Backend Developer at Acme has been sent", at },
      { id: "old2", thread: "to2", from: "Beta <jobs@beta.co.nz>", subject: "Application submitted for Data Analyst", at },
    ];
    await runTick(testEnv(mockEnv), now, gmail(msgs, false) as unknown as typeof fetch);
    const a1 = await env.DB.prepare("SELECT role, source FROM applications WHERE id = 1").first();
    const a2 = await env.DB.prepare("SELECT role, source FROM applications WHERE id = 2").first();
    expect(a1).toEqual({ role: "Junior Backend Developer", source: "seek" });
    expect(a2).toEqual({ role: "My own title", source: "email" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM emails_seen WHERE enriched = 0").first<{ n: number }>())?.n).toBe(0);
  });

  it("review items show when the email actually arrived", async () => {
    const now = Math.floor(Date.now() / 1000);
    const at = now - 5 * 86400;
    await env.DB.prepare("INSERT INTO emails_seen (account_id, gmail_id, thread_id, internal_date, disposition) SELECT id, 'q1', 'tq1', ?, 'queued' FROM mail_accounts").bind(at).run();
    await env.DB.prepare("INSERT INTO review_queue (kind, account_id, gmail_id, proposal_json, created_at) SELECT 'classify', id, 'q1', '{}', ? FROM mail_accounts").bind(now).run();
    const r = (await (await call("/api/review", { cookie })).json()) as { items: { receivedAt: number; createdAt: number }[] };
    expect(r.items[0]?.receivedAt).toBe(at);
  });
});
