// Prints the synthetic evaluation report and writes the dataset + report to eval/generated/
// (git-ignored). Usage: npm run eval:synthetic
import { mkdirSync, writeFileSync } from "node:fs";
import { generateSynthetic, summarize } from "../test/fixtures/synthetic/generate.ts";
import { evaluate, formatReport } from "../test/fixtures/synthetic/evaluate.ts";
import { isMain } from "./lib/main.ts";

if (isMain(import.meta.url)) {
  const ds = generateSynthetic();
  const tune = ds.filter((e) => e.split === "tune");
  const heldout = ds.filter((e) => e.split === "heldout");
  const reports = { tune: evaluate(tune), heldout: evaluate(heldout) };
  mkdirSync("eval/generated", { recursive: true });
  writeFileSync("eval/generated/dataset.json", JSON.stringify(ds, null, 2));
  writeFileSync("eval/generated/report.json", JSON.stringify(reports, null, 2));
  console.log(`Synthetic dataset: ${ds.length} emails · tune ${tune.length} · held-out ${heldout.length}`);
  console.log(JSON.stringify(summarize(ds)));
  console.log("\n" + formatReport("TUNING SET", reports.tune));
  console.log("\n" + formatReport("HELD-OUT SET", reports.heldout));
  const h = reports.heldout;
  console.log("\nHeld-out confusion matrix (rows = expected, columns = predicted, non-zero only):");
  for (const [exp, row] of Object.entries(h.confusion)) {
    const cells = Object.entries(row).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`);
    if (cells.length) console.log(`  ${exp.padEnd(22)} ${cells.join("  ")}`);
  }
  if (reports.tune.decisionMismatches.length) {
    console.log("\nTuning decision mismatches:");
    for (const m of reports.tune.decisionMismatches) console.log(`  [${m.category}] "${m.subject}" expected ${m.expected}, got ${m.got}`);
  }
  if (h.decisionMismatches.length) {
    console.log("\nHeld-out decision mismatches:");
    for (const m of h.decisionMismatches) console.log(`  [${m.category}] "${m.subject}" expected ${m.expected}, got ${m.got}`);
  }
}
