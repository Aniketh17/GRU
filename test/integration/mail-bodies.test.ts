// Body reading (D-058): only job-application mail linked to an application, only with read access, nothing stored but facts.
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { b64urlEncode, utf8 } from "../../apps/worker/src/crypto/b64.ts";
import { aadFor, encryptField, keyringFromEnv } from "../../apps/worker/src/crypto/envelope.ts";
import { aucklandToEpoch } from "../../apps/worker/src/lib/when.ts";
import { runTick } from "../../apps/worker/src/tick.ts";
import { call, clearAuthState, login, testEnv } from "./helpers.ts";

// Dates in fixtures are relative to today: the reader only accepts times in the next ~90 days.
const future = (days: number) => { const d = new Date(Date.now() + days * 86400_000); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), month: d.toLocaleString("en-US", { month: "long", timeZone: "UTC" }) }; };


const EMAIL = "ani.primary@gmail.com";
const READONLY = "openid email https://www.googleapis.com/auth/gmail.readonly";
const mockEnv = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", ALLOWED_EMAILS: EMAIL };
let cookie = "";
let now = 0;

async function addAccount(scope: string | null) {
  const enc = await encryptField(keyringFromEnv(testEnv()), "tok", aadFor("mail_accounts", "access_token", EMAIL));
  await env.DB.prepare(
    "INSERT INTO mail_accounts (email, label, access_token_enc, access_expires_at, status, backfill_done, history_id, granted_scope, created_at) VALUES (?, ?, ?, ?, 'active', 1, 'h1', ?, ?)",
  ).bind(EMAIL, EMAIL, enc, now + 3600, scope, now).run();
}

beforeEach(async () => {
  cookie = await login();
  now = Math.floor(Date.now() / 1000);
});
afterEach(async () => {
  await env.DB.batch(["interviews", "events", "applications", "review_queue", "emails_seen", "mail_accounts"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await clearAuthState();
});

const b64 = (s: string) => b64urlEncode(utf8.encode(s));
const seed = async (id: string, appId: number, cls: string, at: number) => {
  await env.DB.prepare("INSERT INTO emails_seen (account_id, gmail_id, thread_id, internal_date, from_domain, class, disposition, app_id, enriched) SELECT id, ?, ?, ?, 'acme.co.nz', ?, 'auto_applied', ?, 1 FROM mail_accounts").bind(id, `t_${id}`, at, cls, appId).run();
};
const seedApp = (id: number) =>
  env.DB.prepare("INSERT INTO applications (id, company, company_norm, status, source, applied_at, last_event_at, created_at, updated_at) VALUES (?1, 'Abano Healthcare', 'abano healthcare', 'applied', 'email', ?2, ?2, ?2, ?2)").bind(id, now - 86400).run();

function gmail(bodies: Record<string, string>, requested: string[]) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof input === "string" ? input : input.toString();
    if (u.includes("/batch/gmail/v1")) {
      const reqBody = String(init?.body ?? "");
      requested.push(reqBody);
      const wantsFull = reqBody.includes("format=full");
      const ids = [...reqBody.matchAll(/messages\/([A-Za-z0-9_]+)\?/g)].map((m) => m[1] as string);
      const b = "bb";
      const parts = ids.flatMap((id, i) => [
        `--${b}`, "Content-Type: application/http", `Content-ID: <response-${i + 1}>`, "", "HTTP/1.1 200 OK", "Content-Type: application/json; charset=UTF-8", "",
        JSON.stringify({
          id, threadId: `t_${id}`, internalDate: String((now - 3600) * 1000),
          payload: { mimeType: "text/plain", headers: [{ name: "From", value: "HR <hr@acme.co.nz>" }, { name: "Subject", value: "Update on your application" }], ...(wantsFull ? { body: { data: b64(bodies[id] ?? "") } } : {}) },
        }),
      ]);
      return new Response([...parts, `--${b}--`].join("\r\n"), { status: 200, headers: { "Content-Type": `multipart/mixed; boundary=${b}` } });
    }
    if (u.includes("/history?")) return new Response(JSON.stringify({ historyId: "h2" }), { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response("nf", { status: 404 });
  };
}

describe("body reading", () => {
  it("fills the position and records a proposed interview with its meeting link, storing no email text", async () => {
    await addAccount(READONLY);
    await seedApp(1);
    await seed("m_interview", 1, "interview_invite", now - 3600);
    const f = future(10);
    const text = `Kia ora Ani,\nThank you for applying for the position of Data Analyst at Abano Healthcare.\nWe would like to invite you to an interview on ${f.d} ${f.month} ${f.y} at 2:30 PM NZDT.\nJoin: https://abano.zoom.us/j/987654321?pwd=xyz\nNgā mihi`;
    const requested: string[] = [];
    await runTick(testEnv(mockEnv), now, gmail({ m_interview: text }, requested) as unknown as typeof fetch);

    expect(await env.DB.prepare("SELECT role FROM applications WHERE id = 1").first()).toEqual({ role: "Data Analyst" });
    const iv = await env.DB.prepare("SELECT state, start_utc, link_enc FROM interviews WHERE app_id = 1").first<{ state: string; start_utc: number; link_enc: string }>();
    expect(iv?.state).toBe("proposed");
    expect(iv?.start_utc).toBe(aucklandToEpoch(f.y, f.m, f.d, 14, 30));
    expect(iv?.link_enc).not.toContain("zoom"); // encrypted at rest

    const list = (await (await call("/api/interviews?app_id=1", { cookie })).json()) as { items: { state: string; link: { url: string; kind: string } | null }[] };
    expect(list.items[0]?.link).toEqual({ url: "https://abano.zoom.us/j/987654321?pwd=xyz", kind: "Zoom" });
    const brief = (await (await call("/api/brief", { cookie })).json()) as { interviews_proposed: { company: string }[] };
    expect(brief.interviews_proposed[0]?.company).toBe("Abano Healthcare");

    // Nothing from the email text was persisted anywhere.
    for (const table of ["applications", "interviews", "emails_seen", "events", "review_queue"]) {
      const dump = JSON.stringify((await env.DB.prepare(`SELECT * FROM ${table}`).all()).results);
      expect(dump, table).not.toContain("Kia ora");
      expect(dump, table).not.toContain("Ngā mihi");
    }
    expect((await env.DB.prepare("SELECT body_checked FROM emails_seen WHERE gmail_id = 'm_interview'").first<{ body_checked: number }>())?.body_checked).toBe(1);
    expect(requested.some((r) => r.includes("format=full"))).toBe(true);
  });

  it("never opens a body without read access (older metadata-only connection)", async () => {
    await addAccount(null);
    await seedApp(1);
    await seed("m1", 1, "application_received", now - 3600);
    const requested: string[] = [];
    await runTick(testEnv(mockEnv), now, gmail({ m1: "Position: Data Analyst" }, requested) as unknown as typeof fetch);
    expect(requested.some((r) => r.includes("format=full"))).toBe(false);
    expect((await env.DB.prepare("SELECT role FROM applications WHERE id = 1").first<{ role: string | null }>())?.role).toBeNull();
  });

  it("keeps Ani's own role, and creates only one time-less proposal across several emails", async () => {
    await addAccount(READONLY);
    await seedApp(1);
    await env.DB.prepare("UPDATE applications SET role = 'My own title', role_norm = 'my own title' WHERE id = 1").run();
    await seed("a", 1, "interview_invite", now - 7200);
    await seed("b", 1, "interview_update", now - 3600);
    const body = "Position: Something Else\nPlease pick a slot: 20 Nov at 10am or 21 Nov at 3pm.\nhttps://meet.google.com/abc-defg-hij";
    await runTick(testEnv(mockEnv), now, gmail({ a: body, b: body }, []) as unknown as typeof fetch);
    expect((await env.DB.prepare("SELECT role FROM applications WHERE id = 1").first<{ role: string }>())?.role).toBe("My own title");
    const ivs = (await env.DB.prepare("SELECT state, start_utc FROM interviews").all<{ state: string; start_utc: number | null }>()).results;
    expect(ivs).toHaveLength(1);
    expect(ivs[0]).toEqual({ state: "proposed", start_utc: null });
  });

  it("falls back to header-only when Gmail refuses body access", async () => {
    await addAccount(READONLY);
    await seedApp(1);
    await seed("m1", 1, "application_received", now - 3600);
    const denied = async (input: RequestInfo | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("/batch/gmail/v1")) return new Response("forbidden", { status: 403 });
      if (u.includes("/history?")) return new Response(JSON.stringify({ historyId: "h2" }), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response("nf", { status: 404 });
    };
    await runTick(testEnv(mockEnv), now, denied as unknown as typeof fetch);
    const acc = await env.DB.prepare("SELECT granted_scope FROM mail_accounts").first<{ granted_scope: string | null }>();
    expect(acc?.granted_scope).toBeNull();
    const api = (await (await call("/api/mail/accounts", { cookie })).json()) as { accounts: { body_access: boolean }[] };
    expect(api.accounts[0]?.body_access).toBe(false);
  });

  it("opens a stored job email inside GRU (live, text only), and refuses anything else", async () => {
    await addAccount(READONLY);
    await seedApp(1);
    await seed("view_1", 1, "interview_invite", now - 3600);
    const accountId = (await env.DB.prepare("SELECT id FROM mail_accounts").first<{ id: number }>())!.id;
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("/messages/view_1")) {
        return Response.json({
          id: "view_1", threadId: "thread_view_1", internalDate: String((now - 3600) * 1000),
          payload: { mimeType: "text/plain", headers: [{ name: "From", value: "HR <hr@acme.co.nz>" }, { name: "Subject", value: "Interview invitation" }],
            body: { data: b64("Kia ora Ani, please join: https://acme.zoom.us/j/555?pwd=a on 20 Nov 2027 at 2pm.") } },
        });
      }
      return original(input, init);
    }) as typeof fetch;
    try {
      const ok = (await (await call(`/api/mail/view?account=${accountId}&gmail=view_1`, { cookie })).json()) as Record<string, unknown>;
      expect(ok).toMatchObject({ subject: "Interview invitation", body_access: true, class: "interview_invite" });
      expect(String(ok.text)).toContain("Kia ora Ani");
      expect(ok.meeting_link).toEqual({ url: "https://acme.zoom.us/j/555?pwd=a", kind: "Zoom" });
      expect(String(ok.gmail_url)).toContain("#all/t_view_1");
      expect((await call(`/api/mail/view?account=${accountId}&gmail=unknown_id_1`, { cookie })).status).toBe(404); // not filed as job mail
      expect((await call("/api/mail/view?account=1&gmail=x", { cookie })).status).toBe(400);
      expect((await call(`/api/mail/view?account=${accountId}&gmail=view_1`)).status).toBe(401);
      const dump = JSON.stringify((await env.DB.prepare("SELECT * FROM emails_seen").all()).results);
      expect(dump).not.toContain("Kia ora");
    } finally {
      globalThis.fetch = original;
    }
  });
});
