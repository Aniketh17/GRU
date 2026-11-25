import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { aadFor, encryptField, keyringFromEnv } from "../../apps/worker/src/crypto/envelope.ts";
import { Db } from "../../apps/worker/src/db/client.ts";
import { REVOKE_URL, isWipeableTable, wipeAll } from "../../apps/worker/src/kill/wipe.ts";
import { call, clearAuthState, login, resetKillState, testEnv } from "./helpers.ts";

afterEach(async () => {
  await resetKillState();
  await clearAuthState();
});

const EXPECTED_TABLES = [
  "applications", "checkins", "contacts", "deadlines", "emails_seen", "events", "interviews", "job_kits", "job_matches", "jobs", "kv",
  "login_attempts", "mail_accounts", "net_companies", "net_people", "net_touches", "note_tokens", "notes", "notifications_sent", "oauth_states",
  "resume_profiles", "review_queue", "sender_rules", "sessions", "sync_runs", "tasks", "voice_log",
];

async function tableCounts(): Promise<Record<string, number>> {
  const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
  const out: Record<string, number> = {};
  for (const { name } of tables.results.filter((t) => isWipeableTable(t.name))) {
    out[name] = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).first<{ n: number }>())?.n ?? -1;
  }
  return out;
}

async function seedSynthetic(): Promise<void> {
  const ring = keyringFromEnv(testEnv());
  const now = 1_800_000_000;
  const tokenEnc = await encryptField(ring, "synthetic-refresh-token-1", aadFor("mail_accounts", "refresh_token_enc", 1));
  const noteEnc = await encryptField(ring, "synthetic note", aadFor("notes", "body_enc", 1));
  const resumeEnc = await encryptField(ring, "synthetic resume", aadFor("resume_profiles", "resume_text_enc", 1));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO mail_accounts (id, email, refresh_token_enc, status, created_at) VALUES (1, 'synthetic@example.test', ?, 'active', ?)").bind(tokenEnc, now),
    env.DB.prepare("INSERT INTO applications (company, company_norm, role, created_at, updated_at) VALUES ('Example Ltd', 'example', 'Graduate Engineer', ?, ?)").bind(now, now),
    env.DB.prepare("INSERT INTO notes (id, body_enc, created_at, updated_at) VALUES (1, ?, ?, ?)").bind(noteEnc, now, now),
    env.DB.prepare("INSERT INTO resume_profiles (id, version, label, resume_text_enc, created_at, updated_at) VALUES (1, 1, 'Synthetic', ?, ?, ?)").bind(resumeEnc, now, now),
    env.DB.prepare("INSERT INTO jobs (source, title, first_seen_at, last_seen_at, created_at, updated_at) VALUES ('seek', 'Junior Dev', ?, ?, ?, ?)").bind(now, now, now, now),
    env.DB.prepare("INSERT INTO job_matches (job_id, resume_profile_id, score, band, skills_score, role_score, experience_score, education_score, location_score, work_type_score, domain_score, evidence_json_enc, gaps_json_enc, confidence, scored_at) VALUES (1, 1, 70, 'good', 25, 14, 10, 8, 8, 3, 2, 'x', 'y', 'medium', ?)").bind(now),
  ]);
}

describe("in-app wipe", () => {
  it("rejects a wrong phrase", async () => {
    const cookie = await login();
    const res = await call("/api/admin/wipe", { json: { phrase: "wipe everything" }, cookie });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "wrong_phrase" });
  });

  it("runs on an empty DB: all tables kept but empty, state wiped, later calls 423", async () => {
    const cookie = await login();
    const res = await call("/api/admin/wipe", { json: { phrase: "WIPE EVERYTHING" }, cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ wiped: true, revoked: 0, revoke_failed: 0 });
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");

    const counts = await tableCounts();
    expect(Object.keys(counts).sort()).toEqual(EXPECTED_TABLES);
    for (const [t, n] of Object.entries(counts)) expect(n, t).toBe(t === "kv" ? 2 : 0);
    expect(await env.DB.prepare("SELECT v FROM kv WHERE k = 'kill_state'").first()).toEqual({ v: "wiped" });

    const after = await call("/api/health", { cookie });
    expect(after.status).toBe(423);
    expect(await after.json()).toEqual({ state: "wiped" });
    expect((await call("/auth/login", { json: { u: "testuser", p: env.TEST_PROOF } })).status).toBe(423);
  });

  it("purges seeded synthetic data and revokes the Gmail token at Google", async () => {
    await seedSynthetic();
    const calls: string[] = [];
    const fakeFetch = async (url: string) => {
      calls.push(url);
      return new Response(null, { status: 200 });
    };
    const result = await wipeAll(testEnv(), new Db(env.DB), fakeFetch);
    expect(result).toMatchObject({ wiped: true, revoked: 1, revoke_failed: 0 });
    expect(calls).toEqual([`${REVOKE_URL}?token=synthetic-refresh-token-1`]);
    const counts = await tableCounts();
    for (const [t, n] of Object.entries(counts)) expect(n, t).toBe(t === "kv" ? 2 : 0);
  });

  it("still purges everything when locked, and reports the revocation it couldn't do", async () => {
    await seedSynthetic();
    const result = await wipeAll(testEnv({ DATA_KEY_V1: undefined }), new Db(env.DB), async () => new Response(null));
    expect(result).toMatchObject({ wiped: true, revoked: 0, revoke_failed: 1 });
    expect((await tableCounts()).applications).toBe(0);
  });

  it("never touches D1 internals", () => {
    expect(isWipeableTable("d1_migrations")).toBe(false);
    expect(isWipeableTable("_cf_KV")).toBe(false);
    expect(isWipeableTable("sqlite_sequence")).toBe(false);
    expect(isWipeableTable("notes")).toBe(true);
  });
});
