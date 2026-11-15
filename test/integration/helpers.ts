import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../apps/worker/src/index.ts";
import type { Env } from "../../apps/worker/src/env.ts";

export const ORIGIN = "http://localhost:8787";

export interface CallInit {
  method?: string;
  json?: unknown;
  body?: string;
  cookie?: string;
  headers?: Record<string, string>;
  /** Set false to omit the JSON/X-App/Origin hygiene headers on mutating requests. */
  hygiene?: boolean;
}

export function testEnv(override: Partial<Env> = {}): Env {
  return {
    DB: env.DB,
    ASSETS: env.ASSETS,
    APP_ORIGIN: env.APP_ORIGIN,
    DATA_KEY_V1: env.DATA_KEY_V1,
    INDEX_KEY: env.INDEX_KEY,
    SESSION_SECRET: env.SESSION_SECRET,
    AUTH_USERNAME: env.AUTH_USERNAME,
    AUTH_VERIFIER: env.AUTH_VERIFIER,
    ...override,
  } as Env;
}

/** Invokes the real Worker entrypoint (security-header wrapper included). */
export async function call(path: string, init: CallInit = {}, envOverride: Partial<Env> = {}): Promise<Response> {
  const method = init.method ?? (init.json !== undefined ? "POST" : "GET");
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("Cookie", init.cookie);
  if (method !== "GET" && init.hygiene !== false) {
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (!headers.has("X-App")) headers.set("X-App", "gru");
    if (!headers.has("Origin")) headers.set("Origin", ORIGIN);
  }
  const body = init.json !== undefined ? JSON.stringify(init.json) : init.body;
  const req = new Request(ORIGIN + path, { method, headers, ...(body !== undefined ? { body } : {}) });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req as Parameters<typeof worker.fetch>[0], testEnv(envOverride), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export async function login(ip = "198.51.100.10"): Promise<string> {
  const res = await call("/auth/login", {
    json: { u: env.AUTH_USERNAME, p: env.TEST_PROOF },
    headers: { "CF-Connecting-IP": ip },
  });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  const cookie = res.headers.get("Set-Cookie") ?? "";
  return cookie.split(";")[0] as string;
}

export async function resetKillState(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO kv (k, v) VALUES ('kill_state', 'running') ON CONFLICT(k) DO UPDATE SET v = 'running'"),
    env.DB.prepare("INSERT INTO kv (k, v) VALUES ('paused', '0') ON CONFLICT(k) DO UPDATE SET v = '0'"),
  ]);
}

export async function clearAuthState(): Promise<void> {
  await env.DB.batch([env.DB.prepare("DELETE FROM login_attempts"), env.DB.prepare("DELETE FROM sessions")]);
}
