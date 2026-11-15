import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveProof } from "../../apps/web/src/derive.ts";

const params = { m: 19456, t: 2, p: 1, salt: "c2FsdHNhbHRzYWx0c2FsdA" }; // "saltsaltsaltsalt"

describe("browser Argon2id derivation (D-018)", () => {
  it("is deterministic and 32 bytes", async () => {
    const a = await deriveProof("copper kettle river saffron lantern", params);
    assert.match(a, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(await deriveProof("copper kettle river saffron lantern", params), a);
  });

  it("changes with the password, the salt and the parameters", async () => {
    const base = await deriveProof("pass phrase one two three", params);
    assert.notEqual(await deriveProof("pass phrase one two four", params), base);
    assert.notEqual(await deriveProof("pass phrase one two three", { ...params, salt: "b3RoZXJzYWx0b3RoZXJzYQ" }), base);
    assert.notEqual(await deriveProof("pass phrase one two three", { ...params, t: 3 }), base);
  });

  it("normalises Unicode (NFC), so the same password typed on different keyboards matches", async () => {
    assert.equal(
      await deriveProof("café passphrase long enough", params),
      await deriveProof("café passphrase long enough", params),
    );
  });
});
