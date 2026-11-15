// End-to-end check of the server-relief protocol (D-018) on Node 20:
// the real browser KDF (hash-wasm) -> set-password verifier -> the Worker's verification code.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { deriveProof } from "../../apps/web/src/derive.ts";
import { kdfParamsFor, parseVerifier, verifyLogin } from "../../apps/worker/src/auth/password.ts";
import type { Env } from "../../apps/worker/src/env.ts";
import { buildVerifier } from "../../scripts/set-password.ts";

const PASSWORD = "copper kettle river saffron lantern";
let env: Env;
let proof: string;

before(async () => {
  const verifier = await buildVerifier(PASSWORD, 19456, 2);
  env = {
    APP_ORIGIN: "http://localhost:8787",
    AUTH_USERNAME: "testuser",
    AUTH_VERIFIER: verifier,
    SESSION_SECRET: "unit-test-session-secret",
  } as Env;
  const v = parseVerifier(verifier);
  proof = await deriveProof(PASSWORD, { m: v.m, t: v.t, p: v.p, salt: v.salt });
});

describe("verifier parsing", () => {
  it("parses a verifier produced by set-password", () => {
    const v = parseVerifier(env.AUTH_VERIFIER);
    assert.equal(v.m, 19456);
    assert.equal(v.t, 2);
    assert.equal(v.digest.length, 32);
  });

  it("rejects malformed or weak verifiers", () => {
    assert.throws(() => parseVerifier(undefined));
    assert.throws(() => parseVerifier("bcrypt$whatever"));
    assert.throws(() => parseVerifier((env.AUTH_VERIFIER as string).replace("m=19456", "m=1024")), /weak_verifier_params/);
  });
});

describe("login verification", () => {
  it("accepts the browser-derived proof for the right username (case/space-insensitive)", async () => {
    assert.equal(await verifyLogin(env, "testuser", proof), true);
    assert.equal(await verifyLogin(env, "  TestUser ", proof), true);
  });

  it("rejects a wrong password, a wrong username, and garbage", async () => {
    const v = parseVerifier(env.AUTH_VERIFIER);
    const wrong = await deriveProof("not the password at all!!", { m: v.m, t: v.t, p: v.p, salt: v.salt });
    assert.equal(await verifyLogin(env, "testuser", wrong), false);
    assert.equal(await verifyLogin(env, "someoneelse", proof), false);
    assert.equal(await verifyLogin(env, "testuser", "not-base64-!!"), false);
    assert.equal(await verifyLogin(env, "testuser", ""), false);
  });

  it("rejects everything when no username is configured", async () => {
    assert.equal(await verifyLogin({ ...env, AUTH_USERNAME: "" } as Env, "", proof), false);
  });
});

describe("KDF params do not reveal whether a username exists", () => {
  it("unknown users get identical params and a same-length deterministic fake salt", async () => {
    const real = await kdfParamsFor(env, "testuser");
    const fake1 = await kdfParamsFor(env, "intruder");
    const fake2 = await kdfParamsFor(env, "intruder");
    const other = await kdfParamsFor(env, "another");
    assert.equal(real.salt, parseVerifier(env.AUTH_VERIFIER).salt);
    assert.deepEqual({ ...fake1, salt: "" }, { ...real, salt: "" });
    assert.equal(fake1.salt, fake2.salt);
    assert.notEqual(fake1.salt, real.salt);
    assert.notEqual(fake1.salt, other.salt);
    assert.equal(fake1.salt.length, real.salt.length);
  });
});
