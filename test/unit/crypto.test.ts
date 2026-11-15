import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { b64urlDecode, b64urlEncode } from "../../apps/worker/src/crypto/b64.ts";
import { DecryptError, LockedError, aadFor, decryptField, encryptField, type Keyring } from "../../apps/worker/src/crypto/envelope.ts";
import { hmacSha256, sha256, timingSafeEqual } from "../../apps/worker/src/crypto/hmac.ts";

const key = () => b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
const ring = (k = key()): Keyring => ({ active: "k1", keys: { k1: k } });
const AAD = aadFor("notes", "body_enc", 7);
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

function flip(envelope: string, part: 2 | 3): string {
  const parts = envelope.split(".");
  const bytes = b64urlDecode(parts[part] as string);
  bytes[0] = (bytes[0] as number) ^ 0x01;
  parts[part] = b64urlEncode(bytes);
  return parts.join(".");
}

describe("AES-256-GCM field envelope", () => {
  it("round-trips unicode text", async () => {
    const r = ring();
    const text = "Interview prep: talk about the RAG project ✓ – kia ora";
    assert.equal(await decryptField(r, await encryptField(r, text, AAD), AAD), text);
  });

  it("uses the v1.<keyid>.<iv>.<ct> format", async () => {
    assert.match(await encryptField(ring(), "x", AAD), /^v1\.k1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
  });

  it("uses a fresh random IV every time", async () => {
    const r = ring();
    const [a, b] = [await encryptField(r, "same", AAD), await encryptField(r, "same", AAD)];
    assert.notEqual(a.split(".")[2], b.split(".")[2]);
  });

  it("detects a tampered ciphertext", async () => {
    const r = ring();
    await assert.rejects(decryptField(r, flip(await encryptField(r, "secret", AAD), 3), AAD), DecryptError);
  });

  it("detects a tampered IV", async () => {
    const r = ring();
    await assert.rejects(decryptField(r, flip(await encryptField(r, "secret", AAD), 2), AAD), DecryptError);
  });

  it("fails with the wrong AAD (row-swap protection)", async () => {
    const r = ring();
    const env = await encryptField(r, "secret", AAD);
    await assert.rejects(decryptField(r, env, aadFor("notes", "body_enc", 8)), DecryptError);
  });

  it("fails with the wrong key", async () => {
    await assert.rejects(decryptField(ring(), await encryptField(ring(), "secret", AAD), AAD), DecryptError);
  });

  it("rejects an unknown key id and malformed envelopes", async () => {
    const env = await encryptField(ring(), "secret", AAD);
    await assert.rejects(decryptField(ring(), env.replace(".k1.", ".k9."), AAD), /unknown_key/);
    await assert.rejects(decryptField(ring(), "v2.k1.aaa.bbb", AAD), /format/);
    await assert.rejects(decryptField(ring(), "garbage", AAD), /format/);
  });

  it("throws LockedError when the key is missing", async () => {
    const locked: Keyring = { active: "k1", keys: { k1: undefined } };
    await assert.rejects(encryptField(locked, "x", AAD), LockedError);
    await assert.rejects(decryptField(locked, await encryptField(ring(), "x", AAD), AAD), LockedError);
  });

  it("supports multiple key ids for rotation", async () => {
    const k1 = key();
    const old = await encryptField(ring(k1), "old data", AAD);
    const rotated: Keyring = { active: "k2", keys: { k1, k2: key() } };
    const fresh = await encryptField(rotated, "new data", AAD);
    assert.ok(fresh.startsWith("v1.k2."));
    assert.equal(await decryptField(rotated, old, AAD), "old data");
    assert.equal(await decryptField(rotated, fresh, AAD), "new data");
  });

  it("rejects a data key that isn't 32 bytes", async () => {
    await assert.rejects(encryptField(ring(b64urlEncode(new Uint8Array(16))), "x", AAD), /32_bytes/);
  });
});

describe("HMAC / SHA-256 / constant-time compare", () => {
  it("matches RFC 4231 test case 2 (HMAC-SHA256)", async () => {
    assert.equal(hex(await hmacSha256("Jefe", "what do ya want for nothing?")), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  });

  it("matches the SHA-256('abc') vector", async () => {
    assert.equal(hex(await sha256("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("timingSafeEqual handles equal, different and unequal lengths", () => {
    assert.equal(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
    assert.equal(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
    assert.equal(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])), false);
  });

  it("base64url rejects invalid input", () => {
    assert.throws(() => b64urlDecode("ab+c"));
    assert.throws(() => b64urlDecode("a"));
    assert.deepEqual(b64urlDecode(b64urlEncode(new Uint8Array([0, 255, 128]))), new Uint8Array([0, 255, 128]));
  });
});
