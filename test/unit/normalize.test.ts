import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeName } from "../../apps/worker/src/domain/normalize.ts";

describe("company/role normalisation (spec section 9)", () => {
  const cases: [string, string][] = [
    ["Kōwhai Labs Ltd", "kowhai labs"],
    ["ACME, Inc.", "acme"],
    ["Harbourline Limited", "harbourline"],
    ["Smith & Sons NZ Ltd", "smith and sons"],
    ["  Tidewater   Analytics  ", "tidewater analytics"],
    ["Pūriri Systems (NZ)", "puriri systems"],
    ["Graduate Software Engineer — Backend", "graduate software engineer backend"],
    ["Ltd", "ltd"], // a bare suffix is kept rather than erased to nothing
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => assert.equal(normalizeName(input), expected));
  }

  it("strips LIKE wildcards and punctuation", () => {
    assert.equal(normalizeName("100% Pure_Data"), "100 pure data");
    assert.equal(normalizeName("%"), "");
  });
});
