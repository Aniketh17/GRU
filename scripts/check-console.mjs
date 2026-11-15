// Spec section 7: raw console.* is banned in app code outside the allowlisted logger.
// Dependency-free stand-in for ESLint's no-console on the Node 20 lane (D-028).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const ROOTS = ["apps/worker/src", "apps/web/src"];
const ALLOWED = [join("apps", "worker", "src", "log") + sep];
const RE = /\bconsole\s*\.\s*[a-zA-Z]+\s*\(/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) yield p;
  }
}

const hits = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (ALLOWED.some((a) => file.startsWith(a))) continue;
    readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "");
      if (RE.test(code)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
}
if (hits.length) {
  console.error("console.* is only allowed in apps/worker/src/log/:\n" + hits.join("\n"));
  process.exit(1);
}
console.log(`no-console: OK (${ROOTS.join(", ")})`);
