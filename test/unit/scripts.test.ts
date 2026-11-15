import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it, mock } from "node:test";
import { generateAll, randomTopic } from "../../scripts/gen-keys.ts";
import { LOCK_SECRETS, lock } from "../../scripts/lock.ts";
import { buildVerifier, passwordProblems } from "../../scripts/set-password.ts";
import { MANUAL_CHECKLIST, plan, run } from "../../scripts/wipe.ts";

function captureLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = mock.method(console, "log", (m: string) => void lines.push(String(m)));
  return { lines, restore: () => spy.mock.restore() };
}

describe("gen-keys", () => {
  it("produces 32-byte base64url keys and a 40-char topic", () => {
    const k = generateAll();
    for (const name of ["DATA_KEY_V1", "INDEX_KEY", "SESSION_SECRET"]) {
      assert.match(k[name] as string, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(Buffer.from(k[name] as string, "base64url").length, 32);
    }
    assert.match(k.NTFY_TOPIC as string, /^gru-[a-z0-9]{36}$/);
    assert.equal(new Set([k.DATA_KEY_V1, k.INDEX_KEY, k.SESSION_SECRET]).size, 3);
    assert.notEqual(randomTopic(), randomTopic());
  });

  it("runs as a real process on this Node version and prints all four names", () => {
    const out = execFileSync(process.execPath, ["build/unit/scripts/gen-keys.js"], { encoding: "utf8" });
    for (const name of ["DATA_KEY_V1=", "INDEX_KEY=", "SESSION_SECRET=", "NTFY_TOPIC="]) assert.ok(out.includes(name), name);
  });
});

describe("set-password", () => {
  it("rejects weak passwords and accepts a long passphrase", () => {
    assert.notDeepEqual(passwordProblems("short", "ani"), []);
    assert.notDeepEqual(passwordProblems("aaaaaaaaaaaaaaaaaaaa", "ani"), []);
    assert.notDeepEqual(passwordProblems("my password is password123", "ani"), []);
    assert.notDeepEqual(passwordProblems("ani-likes-long-passphrases", "ani"), []);
    assert.deepEqual(passwordProblems("copper kettle river saffron lantern", "ani"), []);
  });

  it("builds a verifier in the format the Worker parses", async () => {
    const v = await buildVerifier("copper kettle river saffron lantern", 19456, 2);
    assert.match(v, /^gru1\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
  });
});

describe("wipe.ts (full teardown)", () => {
  it("--dry-run lists every step and never runs wrangler", async () => {
    const exec = mock.fn(() => 0);
    const log = captureLog();
    try {
      assert.equal(await run(exec, true), 0);
    } finally {
      log.restore();
    }
    assert.equal(exec.mock.callCount(), 0);
    const text = log.lines.join("\n");
    for (const step of plan()) assert.ok(text.includes(step.label), step.label);
    assert.ok(text.includes("7 days"));
  });

  it("covers secrets, the D1 database, the Worker, and the manual checklist", () => {
    const labels = plan().map((s) => s.label).join("\n");
    assert.ok(labels.includes("DATA_KEY_V1"));
    assert.ok(labels.includes("D1 database"));
    assert.ok(labels.includes('Worker "gru"'));
    assert.match(MANUAL_CHECKLIST.join(" "), /OAuth client.*permissions.*ntfy/s);
  });

  it("skips every step the human declines", async () => {
    const exec = mock.fn(() => 0);
    const log = captureLog();
    try {
      await run(exec, false, async () => false);
    } finally {
      log.restore();
    }
    assert.equal(exec.mock.callCount(), 0);
  });

  it("runs as a real process with --dry-run", () => {
    const out = execFileSync(process.execPath, ["build/unit/scripts/wipe.js", "--dry-run"], { encoding: "utf8" });
    assert.ok(out.includes("DRY RUN"));
  });
});

describe("lock.ts", () => {
  it("--dry-run deletes nothing", async () => {
    const exec = mock.fn(() => 0);
    const log = captureLog();
    try {
      assert.equal(await lock(exec, true), 0);
    } finally {
      log.restore();
    }
    assert.equal(exec.mock.callCount(), 0);
    assert.deepEqual(LOCK_SECRETS, ["DATA_KEY_V1", "INDEX_KEY"]);
  });
});

describe("secrets and real data are git-ignored (security check)", () => {
  const lines = readFileSync(".gitignore", "utf8").split(/\r?\n/);
  for (const entry of [".dev.vars", "eval/private/", ".wrangler/", "node_modules/", ".env", "build/"]) {
    it(entry, () => assert.ok(lines.includes(entry), entry));
  }
});
