// Runs compiled unit tests with Node's built-in runner. Passing explicit files works on
// Node 20 (directory args) and Node 22+ (file/glob args) alike.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const dir = join("build", "unit", "test", "unit");
const files = readdirSync(dir).filter((f) => f.endsWith(".test.js")).sort().map((f) => join(dir, f));
if (files.length === 0) {
  console.error(`no compiled tests found in ${dir}`);
  process.exit(1);
}
const extra = process.argv.slice(2);
const r = spawnSync(process.execPath, ["--test", ...extra, ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
