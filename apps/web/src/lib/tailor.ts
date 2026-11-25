// Tailor analysis (Revamp 3B), computed on the device from the resume and the pasted posting. No network, no AI:
// every keyword is a term really in the posting, every achievement/bullet is a line really in the resume (grounded by construction).
import { extractSkills } from "../../../worker/src/jobs/scoring.ts";

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const termRe = (t: string, flags = "gi"): RegExp => new RegExp(`(?<![A-Za-z0-9+#])${esc(t)}(?![A-Za-z0-9+#])`, flags);
const count = (text: string, term: string): number => (text.match(termRe(term)) ?? []).length;

const CUE = /(?:experience (?:with|in|using)|knowledge of|proficien(?:t|cy) (?:in|with)|familiar(?:ity)? with|skilled in|understanding of|expertise in|exposure to)\s+([A-Za-z][A-Za-z0-9+#./ -]{2,38}?)(?=[,.;:)\n]| and | or |$)/gi;
const WEAK = new Set(["the", "a", "an", "our", "your", "this", "that", "some", "any", "other", "similar", "related", "strong", "good", "relevant", "working", "building"]);
const MUST = /\b(?:must|required|essential|requirements?|you will have|you have|minimum)\b/i;

export interface Keyword { keyword: string; state: "missing" | "buried" | "present"; importance: number; tip: string }
export interface Achievement { text: string; why: string }
export interface TailorAnalysis {
  keywords: Keyword[];          // the 8 that matter most and are missing or buried
  coverage: number;             // % of the posting's important keywords already in the resume
  achievements: Achievement[];  // 2 lines to lead with
  targets: string[];            // 3 resume bullets worth rewriting for this job
  layout: { sectionOrder: string[]; summary: string | null; skillsOrder: string[]; trim: string[]; length: string };
}

/** Resume lines that read like bullets or accomplishments. */
export function resumeBullets(resume: string): string[] {
  const lines = resume.split(/\r?\n/).map((l) => l.replace(/^[\s\-*•·▪●–]+/, "").replace(/\s+/g, " ").trim());
  const bullets = lines.filter((l) => l.length >= 25 && l.length <= 350 && /[a-z]/.test(l) && /\s/.test(l) && !/^(?:email|phone|linkedin|github|www\.)/i.test(l));
  return [...new Set(bullets)];
}

function candidates(posting: string, title: string): Map<string, number> {
  const out = new Map<string, number>();
  const add = (term: string, base: number) => {
    const t = term.trim().toLowerCase();
    if (t.length < 2 || out.has(t)) return;
    const n = Math.min(count(posting, t), 3);
    if (n === 0 && base === 0) return;
    let w = n + base;
    if (count(title, t) > 0) w += 2;
    for (const line of posting.split(/\n/)) if (MUST.test(line) && count(line, t) > 0) { w += 2; break; }
    out.set(t, w);
  };
  for (const s of extractSkills(posting)) add(s, 0);
  for (const m of posting.matchAll(CUE)) {
    const phrase = (m[1] ?? "").trim().replace(/\s+/g, " ").toLowerCase();
    const words = phrase.split(" ");
    if (words.length > 4 || words.every((w) => WEAK.has(w))) continue;
    add(words.filter((w, i) => !(i === 0 && WEAK.has(w))).join(" "), 1);
  }
  return out;
}

const tip = (state: Keyword["state"]): string =>
  state === "missing" ? "Not in your CV. Add it only if you have really used it (Skills line or a bullet)." : state === "buried" ? "Only mentioned once, low down. Move it into your summary or your top bullets." : "Already prominent.";

export function analyse(resume: string, posting: string, title = ""): TailorAnalysis {
  const cand = candidates(posting, title);
  const ranked = [...cand.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  const all: Keyword[] = ranked.map(([keyword, importance]) => {
    const n = count(resume, keyword);
    const first = n ? resume.search(termRe(keyword, "i")) : -1;
    const state: Keyword["state"] = n === 0 ? "missing" : n === 1 && first / Math.max(1, resume.length) > 0.45 ? "buried" : "present";
    return { keyword, state, importance, tip: tip(state) };
  });
  const present = all.filter((k) => k.state === "present").length;
  const coverage = all.length ? Math.round(((all.length - all.filter((k) => k.state === "missing").length) / all.length) * 100) : 0;
  const keywords = [...all.filter((k) => k.state === "missing"), ...all.filter((k) => k.state === "buried")].slice(0, 8);

  // Bullets scored by how much of the posting they speak to.
  const postWords = new Set((posting.toLowerCase().match(/[a-z][a-z+#.-]{3,}/g) ?? []));
  const scored = resumeBullets(resume).map((text) => {
    const hit = ranked.filter(([k]) => count(text, k) > 0);
    const overlap = Math.min(2, (text.toLowerCase().match(/[a-z][a-z+#.-]{3,}/g) ?? []).filter((w) => postWords.has(w)).length * 0.2);
    const quant = /\d/.test(text);
    return { text, hit: hit.map(([k]) => k), score: hit.reduce((n, [, w]) => n + w, 0) + overlap + (quant ? 1 : 0), quant };
  }).sort((a, b) => b.score - a.score);

  const achievements: Achievement[] = [...scored].sort((a, b) => Number(b.quant) * 2 + b.score - (Number(a.quant) * 2 + a.score)).slice(0, 2).map((b) => ({
    text: b.text,
    why: b.hit.length ? `Shows ${b.hit.slice(0, 3).join(", ")}, which the posting asks for${b.quant ? ", with a measurable result" : ""}.` : b.quant ? "A measurable result." : "Your strongest relevant line.",
  }));
  const targets = scored.slice(0, 3).map((b) => b.text);

  const entry = /\b(graduate|junior|intern|student|bsc|bachelor)\b/i.test(`${title} ${resume.slice(0, 1500)}`);
  const haveSkills = ranked.filter(([k]) => count(resume, k) > 0).map(([k]) => k);
  const topSkills = haveSkills.slice(0, 3);
  void present;
  return {
    keywords, coverage, achievements, targets,
    layout: {
      sectionOrder: entry ? ["Summary", "Education", "Projects", "Experience", "Skills"] : ["Summary", "Experience", "Projects", "Skills", "Education"],
      summary: topSkills.length ? `${title ? `${title} candidate` : "Candidate"} with hands-on ${topSkills.length === 1 ? topSkills[0] : `${topSkills.slice(0, -1).join(", ")} and ${topSkills.at(-1)}`} experience.` : null,
      skillsOrder: haveSkills.slice(0, 12),
      trim: scored.filter((b) => b.score === 0).slice(-2).map((b) => b.text),
      length: entry ? "One page" : "One to two pages",
    },
  };
}

/** Plain-text/Markdown export of a kit, for pasting into a CV editor or LaTeX. */
export function exportKit(title: string, company: string | null, a: TailorAnalysis, rewrites: { text: string }[], summary: string | null): string {
  const L: string[] = [`# Resume tailoring: ${title}${company ? ` at ${company}` : ""}`, ""];
  L.push("## Keywords to work in (only if true)", ...a.keywords.map((k) => `- ${k.keyword} (${k.state})`), "");
  L.push("## Lead with", ...a.achievements.map((x) => `- ${x.text}`), "");
  if (rewrites.length) L.push("## Rewritten bullets", ...rewrites.map((r) => `- ${r.text}`), "");
  if (summary ?? a.layout.summary) L.push("## Summary line", summary ?? (a.layout.summary as string), "");
  L.push("## Layout", `- Section order: ${a.layout.sectionOrder.join(" > ")}`, `- Length: ${a.layout.length}`, `- Skills order: ${a.layout.skillsOrder.join(", ")}`);
  return L.join("\n");
}
