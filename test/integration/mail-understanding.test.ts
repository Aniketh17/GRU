// Understanding mail by its words: status from text (with undo), alerts to vacancies, deadlines, contacts, and the read boundary.
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { b64urlEncode, utf8 } from "../../apps/worker/src/crypto/b64.ts";
import { aadFor, encryptField, keyringFromEnv } from "../../apps/worker/src/crypto/envelope.ts";
import { aucklandToEpoch } from "../../apps/worker/src/lib/when.ts";
import { runTick } from "../../apps/worker/src/tick.ts";
import { call, clearAuthState, login, testEnv } from "./helpers.ts";

const EMAIL = "ani.primary@gmail.com";
const mockEnv = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", ALLOWED_EMAILS: EMAIL };
const READONLY = "openid email https://www.googleapis.com/auth/gmail.readonly";
let cookie = "";
let now = 0;

beforeEach(async () => {
  cookie = await login();
  now = Math.floor(Date.now() / 1000);
  const enc = await encryptField(keyringFromEnv(testEnv()), "tok", aadFor("mail_accounts", "access_token", EMAIL));
  await env.DB.prepare(
    "INSERT INTO mail_accounts (email, label, access_token_enc, access_expires_at, status, backfill_done, history_id, granted_scope, created_at) VALUES (?, ?, ?, ?, 'active', 1, 'h1', ?, ?)",
  ).bind(EMAIL, EMAIL, enc, now + 3600, READONLY, now).run();
});
afterEach(async () => {
  await env.DB.batch(["interviews", "events", "applications", "review_queue", "emails_seen", "mail_accounts", "jobs", "job_matches", "deadlines", "contacts"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await env.DB.prepare("DELETE FROM kv WHERE k = 'settings'").run();
  await clearAuthState();
});

const b64 = (s: string) => b64urlEncode(utf8.encode(s));
interface Msg { id: string; from?: string; subject?: string; text?: string; html?: string; threadId?: string }

/** Gmail mock: header fetches return From/Subject; full fetches also return the bodies. Records every request. */
function gmail(msgs: Msg[], requested: string[], history = false) {
  const byId = new Map(msgs.map((m) => [m.id, m]));
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof input === "string" ? input : input.toString();
    if (u.includes("/batch/gmail/v1")) {
      const req = String(init?.body ?? "");
      requested.push(req);
      const full = req.includes("format=full");
      const ids = [...req.matchAll(/messages\/([A-Za-z0-9_]+)\?/g)].map((m) => m[1] as string);
      const parts = ids.flatMap((id, i) => {
        const m = byId.get(id) ?? { id };
        const payload: Record<string, unknown> = { mimeType: m.html ? "text/html" : "text/plain", headers: [{ name: "From", value: m.from ?? "HR <hr@acme.co.nz>" }, { name: "Subject", value: m.subject ?? "Hello" }] };
        if (full) payload.body = { data: b64(m.html ?? m.text ?? "") };
        return [`--bb`, "Content-Type: application/http", `Content-ID: <response-${i + 1}>`, "", "HTTP/1.1 200 OK", "Content-Type: application/json; charset=UTF-8", "", JSON.stringify({ id, threadId: m.threadId ?? `t_${id}`, internalDate: String((now - 3600) * 1000), payload })];
      });
      return new Response([...parts, "--bb--"].join("\r\n"), { status: 200, headers: { "Content-Type": "multipart/mixed; boundary=bb" } });
    }
    if (u.includes("/history?")) {
      const added = history ? msgs.map((m) => ({ message: { id: m.id, threadId: m.threadId ?? `t_${m.id}` } })) : [];
      return new Response(JSON.stringify({ historyId: "h2", history: added.length ? [{ id: "1", messagesAdded: added }] : [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("nf", { status: 404 });
  };
}

const seedApp = (id = 1, company = "Acme Robotics") =>
  env.DB.prepare("INSERT INTO applications (id, company, company_norm, status, source, applied_at, last_event_at, created_at, updated_at) VALUES (?1, ?2, ?3, 'applied', 'email', ?4, ?4, ?4, ?4)").bind(id, company, company.toLowerCase(), now - 86400).run();
const seedMail = (id: string, thread: string, cls: string, disposition: string, appId: number | null, at = now - 3600) =>
  env.DB.prepare("INSERT INTO emails_seen (account_id, gmail_id, thread_id, internal_date, from_domain, class, disposition, app_id, enriched) SELECT id, ?, ?, ?, 'acme.co.nz', ?, ?, ?, 1 FROM mail_accounts").bind(id, thread, at, cls, disposition, appId).run();
const run = (msgs: Msg[], requested: string[] = [], history = false) => runTick(testEnv(mockEnv), now, gmail(msgs, requested, history) as unknown as typeof fetch);

describe("status from the email text", () => {
  const REJECT = "Hi Ani,\nThank you for applying for the Data Analyst role.\nWe regret to inform you that we have decided to proceed with other candidates.";

  it("marks a clear rejection (same thread as the application) automatically, shows it on the timeline, and can be undone", async () => {
    await seedApp();
    await seedMail("m_applied", "thread1", "application_received", "auto_applied", 1, now - 86400);
    await seedMail("m_reject", "thread1", "application_update", "queued", 1);
    await env.DB.prepare("INSERT INTO review_queue (kind, account_id, gmail_id, app_id, proposal_json, created_at) SELECT 'classify', id, 'm_reject', 1, '{}', ? FROM mail_accounts").bind(now).run();
    await run([{ id: "m_reject", text: REJECT, subject: "Update on your application", threadId: "thread1" }]);

    expect((await env.DB.prepare("SELECT status FROM applications WHERE id = 1").first<{ status: string }>())?.status).toBe("rejected");
    const ev = await env.DB.prepare("SELECT id, auto_applied, prev_status FROM events WHERE type = 'status:rejected'").first<{ id: number; auto_applied: number; prev_status: string }>();
    expect(ev).toMatchObject({ auto_applied: 1, prev_status: "applied" });
    expect((await env.DB.prepare("SELECT class, body_class, body_checked FROM emails_seen WHERE gmail_id = 'm_reject'").first())).toEqual({ class: "rejection", body_class: "reject.regret", body_checked: 1 });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'email:rejection'").first<{ n: number }>())?.n).toBe(1);
    expect((await env.DB.prepare("SELECT resolution FROM review_queue WHERE gmail_id = 'm_reject'").first<{ resolution: string }>())?.resolution).toBe("auto_from_text");
    // The email text itself is stored nowhere.
    for (const t of ["applications", "events", "emails_seen", "review_queue"]) expect(JSON.stringify((await env.DB.prepare(`SELECT * FROM ${t}`).all()).results)).not.toContain("proceed with other");

    expect((await call(`/api/events/${ev!.id}/undo`, { json: {}, cookie })).status).toBe(200);
    expect((await env.DB.prepare("SELECT status FROM applications WHERE id = 1").first<{ status: string }>())?.status).toBe("applied");
  });

  it("a rejection in the very email that created the application (subject said 'thank you for applying') is applied automatically, and an undo is respected on re-read", async () => {
    await seedApp(1, "F&P");
    await env.DB.prepare("INSERT INTO events (app_id, type, at, account_id, gmail_id, confidence, auto_applied, created_at) VALUES (1, 'status_change', ?1, 1, 'm_origin', 0.9, 1, ?1)").bind(now - 3600).run();
    await seedMail("m_origin", "t_origin", "application_received", "auto_applied", 1);
    const msg = { id: "m_origin", from: "F&P Careers <careers@fp.example.co.nz>", subject: "Thank you for applying to the role", text: "Thank you for applying to the Data Analyst role at F&P. After careful consideration we chose another candidate for this position." };
    await run([msg]);
    expect((await env.DB.prepare("SELECT status FROM applications WHERE id = 1").first<{ status: string }>())?.status).toBe("rejected");
    expect((await env.DB.prepare("SELECT class FROM emails_seen WHERE gmail_id = 'm_origin'").first<{ class: string }>())?.class).toBe("rejection");

    const ev = await env.DB.prepare("SELECT id FROM events WHERE type = 'status:rejected'").first<{ id: number }>();
    expect((await call(`/api/events/${ev!.id}/undo`, { json: {}, cookie })).status).toBe(200);
    const queued = (await (await call("/api/mail/recheck", { json: {}, cookie })).json()) as { queued: number };
    expect(queued.queued).toBeGreaterThan(0);
    await run([msg]);
    expect((await env.DB.prepare("SELECT status FROM applications WHERE id = 1").first<{ status: string }>())?.status).toBe("applied"); // Ani's undo stands
  });

  it("asks first when the setting is off, or when the rejection is not in a thread GRU already linked", async () => {
    await seedApp();
    await seedMail("m_applied", "thread1", "application_received", "auto_applied", 1, now - 86400);
    await seedMail("m_reject", "thread1", "application_update", "queued", 1);
    await call("/api/settings", { method: "PUT", json: { brief_time: "08:30", stale_days: 14, interview_stale_days: 7, shortlist_threshold: 65, auto_status_from_text: false }, cookie });
    await run([{ id: "m_reject", text: REJECT, threadId: "thread1" }]);
    expect((await env.DB.prepare("SELECT status FROM applications WHERE id = 1").first<{ status: string }>())?.status).toBe("applied");
    const q = await env.DB.prepare("SELECT kind, proposal_json FROM review_queue WHERE gmail_id = 'm_reject'").first<{ kind: string; proposal_json: string }>();
    expect(JSON.parse(q!.proposal_json)).toMatchObject({ class: "rejection", suggested: "rejected" });
  });

  it("recognises an application confirmation sitting in mail the headers could not classify, and creates the application", async () => {
    await env.DB.prepare("INSERT INTO emails_seen (account_id, gmail_id, thread_id, internal_date, from_domain, class, disposition, app_id, enriched) SELECT id, 'm_c', 'tc', ?, 'smartrecruiters.com', 'other', 'candidate', NULL, 1 FROM mail_accounts").bind(now - 3600).run();
    await run([{ id: "m_c", from: "Acme Robotics <no-reply@smartrecruiters.com>", subject: "Thanks from Acme Robotics", text: "Thank you for applying for the position of Data Analyst at Acme Robotics. We have received your application." }]);
    const app = await env.DB.prepare("SELECT company, role, source FROM applications").first();
    expect(app).toEqual({ company: "Acme Robotics", role: "Data Analyst", source: "email" });
  });
});

describe("job alerts become vacancies", () => {
  const HTML = `<table><tr><td><a href="https://www.seek.co.nz/job/81234567?ref=email">Graduate Data Analyst</a></td></tr><tr><td>Acme Robotics</td></tr><tr><td>Auckland CBD, Auckland</td></tr>
    <tr><td><a href="https://www.seek.co.nz/job/81234568">Junior Developer</a></td></tr><tr><td>Beta Ltd</td></tr><tr><td>Wellington</td></tr>
    <tr><td><a href="https://www.seek.co.nz/job/81234569">Data Engineer</a></td></tr><tr><td>Gamma NZ</td></tr><tr><td>Auckland</td></tr></table>`;

  it("extracts each vacancy once, remembers which alert it came from, and scores it against the resume", async () => {
    await env.DB.prepare("INSERT INTO emails_seen (account_id, gmail_id, thread_id, internal_date, from_domain, class, disposition, enriched) SELECT id, 'm_alert', 'ta', ?, 'seek.co.nz', 'alert', 'alert', 1 FROM mail_accounts").bind(now - 3600).run();
    await run([{ id: "m_alert", from: "SEEK <noreply@seek.co.nz>", subject: "3 new jobs for you", html: HTML }]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs").first<{ n: number }>())?.n).toBe(3);
    await env.DB.prepare("UPDATE emails_seen SET body_checked = 0").run();
    await run([{ id: "m_alert", from: "SEEK <noreply@seek.co.nz>", subject: "3 new jobs for you", html: HTML }]); // same alert again: no duplicates
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs").first<{ n: number }>())?.n).toBe(3);

    await call("/api/resume-profiles", { json: { label: "r", text: "Graduate engineer in Auckland. BSc Computer Science. Python, SQL, PostgreSQL, Docker and data analysis projects." }, cookie });
    const list = (await (await call("/api/jobs?status=all", { cookie })).json()) as { items: { title: string; company: string; source: string; score: number | null; alert: { gmail_id: string } | null; confidence: string }[] };
    const analyst = list.items.find((j) => j.title === "Graduate Data Analyst")!;
    expect(analyst).toMatchObject({ company: "Acme Robotics", source: "seek", alert: { gmail_id: "m_alert" } });
    expect(analyst.score).not.toBeNull();
    expect(analyst.confidence).toBe("low"); // no full description: provisional
  });
});

describe("deadlines, interviews and contacts", () => {
  it("saves an assessment deadline and an interview proposal with its link, from the text", async () => {
    await seedApp();
    await seedMail("m_a", "ta", "assessment", "auto_applied", 1);
    await seedMail("m_i", "ti", "interview_invite", "queued", 1);
    await run([
      { id: "m_a", text: "Please complete the online coding assessment by 25 November 2026." },
      { id: "m_i", text: "We would like to invite you to an interview on 24 November 2026 at 10:30 AM NZDT. Join: https://acme.zoom.us/j/12345678" },
    ]);
    const due = await env.DB.prepare("SELECT kind, due_at FROM deadlines").first<{ kind: string; due_at: number }>();
    expect(due).toEqual({ kind: "assessment", due_at: aucklandToEpoch(2026, 11, 25, 17, 0) });
    const iv = await env.DB.prepare("SELECT state, start_utc FROM interviews WHERE app_id = 1").first<{ state: string; start_utc: number }>();
    expect(iv).toEqual({ state: "proposed", start_utc: aucklandToEpoch(2026, 11, 24, 10, 30) });
  });

  it("builds a recruiter contact from a person's email (encrypted, no no-reply senders)", async () => {
    await run([
      { id: "p1", from: "Sam Patel <sam.patel@harbourline.co.nz>", subject: "Interview invitation for Data Analyst" },
      { id: "p2", from: "Harbourline Careers <noreply@harbourline.co.nz>", subject: "Interview invitation" },
    ], [], true);
    const rows = (await env.DB.prepare("SELECT name_enc, email_enc, msg_count FROM contacts").all<{ name_enc: string; email_enc: string; msg_count: number }>()).results;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name_enc).not.toContain("Sam");
    const api = (await (await call("/api/contacts", { cookie })).json()) as { items: { name: string; email: string }[] };
    expect(api.items[0]).toMatchObject({ name: "Sam Patel", email: "sam.patel@harbourline.co.nz" });
    expect((await call("/api/contacts")).status).toBe(401);
  });
});

describe("the read boundary", () => {
  it("never stores or opens mail from unknown senders that is not job-related", async () => {
    const requested: string[] = [];
    await run([{ id: "junk1", from: "Shop <news@randomshop.com>", subject: "Big sale this weekend" }], requested, true);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM emails_seen").first<{ n: number }>())?.n).toBe(0);
    expect(requested.some((r) => r.includes("format=full"))).toBe(false);
  });

  it("stores mail from a known job service as a candidate so its words can be checked, and opens only that", async () => {
    const requested: string[] = [];
    await run([{ id: "cand1", from: "SEEK <noreply@seek.co.nz>", subject: "Your weekly update" }], requested, true);
    expect(await env.DB.prepare("SELECT disposition, class FROM emails_seen WHERE gmail_id = 'cand1'").first()).toEqual({ disposition: "candidate", class: "other" });
    await run([{ id: "cand1", from: "SEEK <noreply@seek.co.nz>", subject: "Your weekly update", text: "Hi Ani, your Seek profile is looking great." }], requested);
    expect(requested.filter((r) => r.includes("format=full")).every((r) => r.includes("cand1"))).toBe(true);
  });
});

describe("call budget", () => {
  it("reads only as many bodies as the budget allows, finishes cleanly, releases the lock, and leaves the rest for the next tick", async () => {
    await seedApp();
    const ids = ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"];
    for (const [i, id] of ids.entries()) await seedMail(id, `t${id}`, "application_update", "queued", 1, now - 3600 - i * 60);
    const msgs = ids.map((id) => ({ id, text: "Thank you for applying. Unfortunately we have decided to proceed with other candidates.", threadId: `t${id}` }));
    const r = await runTick(testEnv(mockEnv), now, gmail(msgs, []) as unknown as typeof fetch);
    expect(r.ran).toBe(true);
    expect(await env.DB.prepare("SELECT v FROM kv WHERE k = 'tick_lock'").first()).toBeNull();
    const done = (await env.DB.prepare("SELECT COUNT(*) AS n FROM emails_seen WHERE body_checked = 1").first<{ n: number }>())!.n;
    expect(done).toBeGreaterThan(0);
    expect(done).toBeLessThan(ids.length); // not everything fits in one tick's budget
    // Nothing was lost: further ticks finish the job.
    for (let i = 0; i < 6; i++) await run(msgs);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM emails_seen WHERE body_checked = 0").first<{ n: number }>())!.n).toBe(0);
  });
});
