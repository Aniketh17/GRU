// Deployment-cost guard (DECISIONS A8, ARCHITECTURE section 9). Fails if wrangler.jsonc gains a
// paid-only setting, a billable binding, or a custom domain. Runs on Node 20, no Wrangler needed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/** Minimal JSONC: strips // and block comments outside strings, plus trailing commas. */
export function parseJsonc(src: string): Record<string, unknown> {
  let out = "";
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string;
    const next = src[i + 1];
    if (inStr) {
      out += ch;
      if (ch === "\\") out += src[++i] ?? "";
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
      out += ch;
    } else if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i++;
    } else out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")) as Record<string, unknown>;
}

const cfg = parseJsonc(readFileSync("wrangler.jsonc", "utf8"));
const has = (k: string) => Object.prototype.hasOwnProperty.call(cfg, k);

describe("wrangler.jsonc stays on the free tier", () => {
  it("Workers Logs / observability is explicitly disabled (D-020)", () => {
    assert.deepEqual(cfg.observability, { enabled: false });
  });

  it("has no billable or card-requiring bindings", () => {
    const forbidden = [
      "r2_buckets", "queues", "durable_objects", "browser", "vectorize", "hyperdrive",
      "analytics_engine_datasets", "mtls_certificates", "dispatch_namespaces", "workflows",
      "send_email", "images", "containers", "pipelines", "secrets_store_secrets", "tail_consumers",
    ];
    for (const key of forbidden) assert.ok(!has(key), key);
  });

  it("Workers AI is bound only as AI (natural voice, D-055); the Free plan hard-stops at 10,000 Neurons/day instead of billing", () => {
    assert.deepEqual(cfg.ai, { binding: "AI" });
  });

  it("uses only workers.dev: no routes or custom domains", () => {
    assert.ok(!has("routes") && !has("route"));
    assert.equal(cfg.workers_dev, true);
  });

  it("sets no Paid-only limits, placement, caching or usage model", () => {
    for (const key of ["limits", "placement", "cache", "usage_model"]) assert.ok(!has(key), key);
  });

  it("uses exactly one cron trigger (Free allows 5 per account)", () => {
    assert.deepEqual((cfg.triggers as { crons: string[] }).crons, ["*/5 * * * *"]);
  });

  it("binds only D1 and static assets", () => {
    assert.equal((cfg.d1_databases as unknown[]).length, 1);
    assert.equal((cfg.assets as { binding: string }).binding, "ASSETS");
    assert.ok(!has("kv_namespaces"));
  });
});

describe("dependencies", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as Record<string, Record<string, string> | undefined>;

  it("pins every dependency to an exact version", () => {
    for (const deps of [pkg.dependencies, pkg.devDependencies]) {
      for (const [name, v] of Object.entries(deps ?? {})) assert.match(v, /^\d+\.\d+\.\d+(-[\w.]+)?$/, name);
    }
  });

  it("ships only justified runtime dependencies (D-036)", () => {
    assert.deepEqual(Object.keys(pkg.dependencies ?? {}).sort(), [
      "@fontsource-variable/inter", "@tanstack/react-query", "hash-wasm", "hono", "mammoth", "pdfjs-dist", "react", "react-dom", "react-router", "zod",
    ]);
  });

  it("allows install scripts only for esbuild and workerd (D-031)", () => {
    assert.deepEqual(Object.keys((pkg.allowScripts ?? {}) as Record<string, unknown>).map((k) => k.replace(/@[^@]+$/, "")).sort(), ["esbuild", "workerd"]);
  });

  it("requires Node >= 22.12 (D-035)", () => {
    assert.equal((pkg.engines as unknown as Record<string, string>).node, ">=22.12.0");
  });
});
