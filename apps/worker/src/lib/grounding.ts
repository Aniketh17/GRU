// "Without inventing anything" enforced in code (Revamp 3B): a rewritten bullet may only contain numbers, tools and names
// that already appear in Ani's resume. Anything else is flagged so it is never presented as a safe claim.
import { extractSkills } from "../jobs/scoring.ts";

const COMMON = new Set(["i", "a", "an", "the", "and", "or", "of", "in", "on", "to", "for", "with", "by", "at", "as", "using", "built", "led", "developed", "designed", "improved", "reduced", "increased", "delivered", "created", "managed", "worked", "implemented", "applied", "analysed", "analyzed"]);

const normNum = (s: string): string => s.replace(/[,\s]/g, "").toLowerCase();
const numbersIn = (text: string): Set<string> => new Set((text.match(/\d[\d,.]*\s?(?:%|k\b|m\b|x\b)?/gi) ?? []).map((n) => normNum(n).replace(/[.,]+$/, "")).filter(Boolean));

function wordsIn(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z][a-z0-9+#.\-/]*/g) ?? []).map((w) => w.replace(/[.\-/]+$/, "")));
}

/** Capitalised words that are not the first word of a sentence: names of tools, employers, places. */
function properNouns(text: string): string[] {
  const out: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  for (const s of sentences) {
    const words = s.trim().split(/\s+/);
    words.forEach((w, i) => {
      const clean = w.replace(/^[^A-Za-z]+|[^A-Za-z0-9+#.]+$/g, "");
      if (i > 0 && /^[A-Z][A-Za-z0-9+#.]{1,}$/.test(clean) && !COMMON.has(clean.toLowerCase())) out.push(clean.toLowerCase());
    });
  }
  return out;
}

export interface Grounding { ok: boolean; flagged: string[] }

/** Lists everything in `rewrite` that Ani's resume does not support. */
export function checkGrounded(rewrite: string, resume: string): Grounding {
  const flagged = new Set<string>();
  const resumeNums = numbersIn(resume);
  for (const n of numbersIn(rewrite)) if (!resumeNums.has(n)) flagged.add(n);
  const resumeWords = wordsIn(resume);
  for (const p of properNouns(rewrite)) if (!resumeWords.has(p)) flagged.add(p);
  const have = new Set(extractSkills(resume));
  for (const s of extractSkills(rewrite)) if (!have.has(s)) flagged.add(s);
  return { ok: flagged.size === 0, flagged: [...flagged].slice(0, 8) };
}
