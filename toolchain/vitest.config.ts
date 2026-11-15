// Integration tests (Node 22 lane): run inside workerd via @cloudflare/vitest-plugin with a local D1.
import { webcrypto } from "node:crypto";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { deriveProof } from "../apps/web/src/derive.ts";

const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const rand = (n: number) => webcrypto.getRandomValues(new Uint8Array(n));

export default defineConfig(async () => {
  const migrations = await readD1Migrations("../migrations");

  // Synthetic credentials, generated fresh per run with the real browser KDF, so the
  // server-relief protocol is tested end to end (D-018). OWASP-minimum params keep it fast.
  const salt = b64url(rand(16));
  const kdf = { m: 19456, t: 2, p: 1, salt };
  const password = "synthetic test passphrase " + b64url(rand(6));
  const proof = await deriveProof(password, kdf);
  const digest = b64url(new Uint8Array(await webcrypto.subtle.digest("SHA-256", Buffer.from(proof, "base64url"))));
  const verifier = `gru1$argon2id$v=19$m=${kdf.m},t=${kdf.t},p=${kdf.p}$${salt}$${digest}`;

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "../wrangler.jsonc" },
        miniflare: {
          bindings: {
            APP_ORIGIN: "http://localhost:8787",
            DATA_KEY_V1: b64url(rand(32)),
            INDEX_KEY: b64url(rand(32)),
            SESSION_SECRET: b64url(rand(32)),
            AUTH_USERNAME: "testuser",
            AUTH_VERIFIER: verifier,
            TEST_PROOF: proof,
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/setup.ts"],
    },
  };
});
