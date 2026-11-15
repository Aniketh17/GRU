// Prepares an isolated end-to-end environment: throwaway credentials in .e2e/ (git-ignored)
// and a fresh local D1 under .wrangler/e2e. Never touches .dev.vars or real data.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { generateAll } from "../build/unit/scripts/gen-keys.js";
import { buildVerifier } from "../build/unit/scripts/set-password.js";

const PORT = 8788;
const password = "e2e throwaway passphrase " + Math.random().toString(36).slice(2, 10);
const keys = generateAll();
const verifier = await buildVerifier(password, 19456, 2);

rmSync(".wrangler/e2e", { recursive: true, force: true });
mkdirSync(".e2e", { recursive: true });
writeFileSync(
  ".e2e/e2e.env",
  [
    `APP_ORIGIN=http://127.0.0.1:${PORT}`,
    `DATA_KEY_V1=${keys.DATA_KEY_V1}`,
    `INDEX_KEY=${keys.INDEX_KEY}`,
    `SESSION_SECRET=${keys.SESSION_SECRET}`,
    "AUTH_USERNAME=ani",
    // The verifier contains "$"; wrangler's dotenv-expand would expand "$name" (even quoted),
    // so escape each one as "\$", which dotenv-expand turns back into a literal "$".
    `AUTH_VERIFIER=${verifier.replaceAll("$", "\\$")}`,
  ].join("\n") + "\n",
);
writeFileSync(".e2e/creds.json", JSON.stringify({ username: "ani", password, port: PORT }));

const wrangler = process.platform === "win32" ? "npx.cmd" : "npx";
execFileSync(wrangler, ["wrangler", "d1", "migrations", "apply", "gru", "--local", "--persist-to", ".wrangler/e2e"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, CI: "1" },
});
console.log("e2e environment ready");
