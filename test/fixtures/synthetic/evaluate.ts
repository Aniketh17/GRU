// Evaluation harness: runs the real classifier → linker → decision engine over a dataset and
// reports per-class precision/recall/F1, a confusion matrix, decision accuracy and safety violations.
import { classify } from "../../../apps/worker/src/classify/classify.ts";
import { extractCompanies } from "../../../apps/worker/src/classify/company.ts";
import { decide, type Decision } from "../../../apps/worker/src/classify/decide.ts";
import { resolveLink, type AppRef } from "../../../apps/worker/src/classify/link.ts";
import { CLASSES, type MailClass } from "../../../apps/worker/src/classify/types.ts";
import { normalizeName } from "../../../apps/worker/src/domain/normalize.ts";
import { SEEDED_APPS, type SyntheticEmail } from "./generate.ts";

export interface Outcome {
  email: SyntheticEmail;
  cls: MailClass;
  confidence: number;
  decision: Decision;
}

export interface ClassMetrics {
  support: number;
  predicted: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface Report {
  n: number;
  perClass: Record<string, ClassMetrics>;
  macroF1: number;
  classAccuracy: number;
  decisionAccuracy: number;
  confusion: Record<string, Record<string, number>>;
  safetyViolations: { id: string; category: string; subject: string; problem: string }[];
  decisionMismatches: { id: string; category: string; subject: string; expected: string; got: string }[];
  routedToReview: number;
}

export const seededAppRefs = (): AppRef[] => SEEDED_APPS.map((a) => ({ id: a.id, company_norm: normalizeName(a.company), status: a.status }));

const RISKY = new Set(["ambiguous", "conflicting", "forwarded", "look_alike"]);
const round = (x: number) => Math.round(x * 1000) / 1000;

export function runOne(e: SyntheticEmail, apps: AppRef[] = seededAppRefs()): Outcome {
  const c = classify(e.meta, ["alex.candidate@gmail.example"]);
  const link = resolveLink(extractCompanies(c.sender, e.meta.subject), apps, null);
  return { email: e, cls: c.cls, confidence: c.confidence, decision: decide(c, link) };
}

export function evaluate(ds: SyntheticEmail[]): Report {
  const outcomes = ds.map((e) => runOne(e));
  const confusion: Record<string, Record<string, number>> = {};
  for (const a of CLASSES) {
    confusion[a] = {};
    for (const b of CLASSES) (confusion[a] as Record<string, number>)[b] = 0;
  }
  let classOk = 0;
  let decisionOk = 0;
  const safetyViolations: Report["safetyViolations"] = [];
  const decisionMismatches: Report["decisionMismatches"] = [];
  for (const o of outcomes) {
    const row = confusion[o.email.expectedClass] as Record<string, number>;
    row[o.cls] = (row[o.cls] ?? 0) + 1;
    if (o.cls === o.email.expectedClass) classOk++;
    const got = o.decision.action;
    const auto = got === "auto_status" || got === "create_application";
    if (got === o.email.expectedDecision) decisionOk++;
    else decisionMismatches.push({ id: o.email.meta.id, category: o.email.category, subject: o.email.meta.subject, expected: o.email.expectedDecision, got });
    if (auto && got !== o.email.expectedDecision) {
      safetyViolations.push({ id: o.email.meta.id, category: o.email.category, subject: o.email.meta.subject, problem: `unexpected automatic ${got}` });
    }
    if (auto && RISKY.has(o.email.category)) {
      safetyViolations.push({ id: o.email.meta.id, category: o.email.category, subject: o.email.meta.subject, problem: `automatic action on a ${o.email.category} email` });
    }
  }
  const perClass: Record<string, ClassMetrics> = {};
  let f1Sum = 0;
  let f1N = 0;
  for (const cls of CLASSES) {
    const tp = (confusion[cls] as Record<string, number>)[cls] ?? 0;
    const support = Object.values(confusion[cls] as Record<string, number>).reduce((a, b) => a + b, 0);
    const predicted = CLASSES.reduce((a, k) => a + ((confusion[k] as Record<string, number>)[cls] ?? 0), 0);
    const precision = predicted ? tp / predicted : 0;
    const recall = support ? tp / support : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    perClass[cls] = { support, predicted, precision: round(precision), recall: round(recall), f1: round(f1) };
    if (support) {
      f1Sum += f1;
      f1N++;
    }
  }
  return {
    n: outcomes.length,
    perClass,
    macroF1: round(f1N ? f1Sum / f1N : 0),
    classAccuracy: round(classOk / outcomes.length),
    decisionAccuracy: round(decisionOk / outcomes.length),
    confusion,
    safetyViolations,
    decisionMismatches,
    routedToReview: outcomes.filter((o) => o.decision.action === "review").length,
  };
}

export function formatReport(title: string, r: Report): string {
  const lines = [`${title}  (n=${r.n})`, "", "class                 support  pred  precision  recall   F1"];
  for (const [cls, m] of Object.entries(r.perClass)) {
    if (!m.support && !m.predicted) continue;
    lines.push(`${cls.padEnd(22)}${String(m.support).padStart(6)}${String(m.predicted).padStart(6)}${m.precision.toFixed(3).padStart(11)}${m.recall.toFixed(3).padStart(8)}${m.f1.toFixed(3).padStart(7)}`);
  }
  lines.push("", `macro F1 ${r.macroF1}  ·  class accuracy ${r.classAccuracy}  ·  decision accuracy ${r.decisionAccuracy}  ·  routed to review ${r.routedToReview}`);
  lines.push(`safety violations: ${r.safetyViolations.length}`);
  lines.push("", "Synthetic data says nothing about real-world accuracy. High-impact auto-apply stays OFF.");
  return lines.join("\n");
}
