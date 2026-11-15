// Deterministic, reproducible 100-point resume-to-vacancy scoring (spec section 10). No AI.
// Every point is justified by evidence found in the resume text and the vacancy text; nothing is inferred.

export const WEIGHTS = { skills: 35, role: 20, experience: 15, education: 10, location: 10, work_type: 5, domain: 5 } as const;

/** Closed vocabulary of skills/tools. A skill counts only if the literal term appears in the text. */
const SKILLS = [
  "python", "typescript", "javascript", "java", "kotlin", "swift", "c#", "c++", "go", "golang", "rust", "ruby", "php", "scala", "sql", "r",
  "react", "next.js", "vue", "angular", "node.js", "express", "django", "flask", "fastapi", "spring", "spring boot", ".net", "asp.net", "rails",
  "html", "css", "tailwind", "graphql", "rest", "grpc", "docker", "kubernetes", "terraform", "ansible", "aws", "azure", "gcp", "cloudflare",
  "linux", "git", "github", "ci/cd", "jenkins", "github actions", "postgresql", "postgres", "mysql", "sqlite", "mongodb", "redis", "kafka",
  "spark", "airflow", "dbt", "snowflake", "bigquery", "pandas", "numpy", "scikit-learn", "pytorch", "tensorflow", "keras", "machine learning",
  "deep learning", "nlp", "computer vision", "llm", "rag", "mlops", "data engineering", "data analysis", "power bi", "tableau", "excel",
  "agile", "scrum", "jira", "testing", "unit testing", "jest", "pytest", "cypress", "playwright", "selenium", "microservices", "devops",
  "security", "networking", "react native", "flutter", "android", "ios", "firebase", "supabase", "figma", "ui/ux", "api", "oauth",
];

const DOMAIN_TERMS = ["ai", "ml", "machine learning", "data", "backend", "software", "cloud", "devops", "analytics", "platform", "full stack", "fullstack", "frontend", "security"];
const DEGREE = /\b(bachelor|b\.?sc|b\.?eng|bachelor's|degree|master|m\.?sc|phd|diploma|bcs|computer science|software engineering|information technology|data science)\b/i;
const ENTRY = /\b(graduate|junior|intern|internship|entry[- ]level|associate|trainee|cadet)\b/i;
const SENIOR = /\b(senior|lead|principal|staff|head of|manager|architect)\b/i;

export interface ResumeFacts {
  skills: { skill: string; evidence: string }[];
  has_degree: boolean;
  entry_level_target: boolean;
  locations: string[];
  domains: string[];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const termRe = (t: string) => new RegExp(`(?<![A-Za-z0-9+#])${esc(t)}(?![A-Za-z0-9+#])`, "i");

function snippetAround(text: string, term: string): string {
  const m = termRe(term).exec(text);
  if (!m) return "";
  const s = Math.max(0, m.index - 30);
  return text.slice(s, m.index + term.length + 30).replace(/\s+/g, " ").trim();
}

export function extractSkills(text: string): string[] {
  return SKILLS.filter((s) => termRe(s).test(text));
}

/** Structured profile. Each fact carries the resume text that supports it (traceability). */
export function extractResumeFacts(resume: string): ResumeFacts {
  return {
    skills: extractSkills(resume).map((skill) => ({ skill, evidence: snippetAround(resume, skill) })),
    has_degree: DEGREE.test(resume),
    entry_level_target: /\b(graduate|junior|intern)\b/i.test(resume),
    locations: ["auckland", "wellington", "christchurch", "hamilton", "dunedin", "new zealand", "remote"].filter((l) => termRe(l).test(resume)),
    domains: DOMAIN_TERMS.filter((d) => termRe(d).test(resume)),
  };
}

export interface JobInput {
  title: string;
  company?: string | null;
  location?: string | null;
  work_arrangement?: string | null;
  employment_type?: string | null;
  description?: string | null;
}

export interface MatchResult {
  score: number;
  band: "strong" | "good" | "possible" | "low";
  components: { skills: number; role: number; experience: number; education: number; location: number; work_type: number; domain: number };
  matched: { skill: string; evidence: string }[];
  gaps: string[];
  explanation: string;
  confidence: "high" | "medium" | "low";
  provisional: boolean;
}

export const bandFor = (n: number): MatchResult["band"] => (n >= 80 ? "strong" : n >= 65 ? "good" : n >= 50 ? "possible" : "low");

/** Splits a description into required and preferred parts using explicit section markers only. */
function splitRequirements(desc: string): { required: string; preferred: string } {
  const m = /\b(nice to have|preferred|desirable|bonus|advantageous|a plus)\b/i.exec(desc);
  return m ? { required: desc.slice(0, m.index), preferred: desc.slice(m.index) } : { required: desc, preferred: "" };
}

export function scoreJob(resume: string, facts: ResumeFacts, job: JobInput): MatchResult {
  const desc = (job.description ?? "").trim();
  const full = `${job.title}\n${desc}`;
  const provisional = desc.length < 200;
  const gaps: string[] = [];
  const have = new Set(facts.skills.map((s) => s.skill));

  // Skills (35): required skills weigh 2x preferred. Title mentions don't count as evidence of the vacancy needing them.
  const { required, preferred } = splitRequirements(desc);
  const reqSkills = extractSkills(required);
  const prefSkills = extractSkills(preferred).filter((s) => !reqSkills.includes(s));
  const reqHit = reqSkills.filter((s) => have.has(s));
  const prefHit = prefSkills.filter((s) => have.has(s));
  const denom = reqSkills.length * 2 + prefSkills.length;
  const skills = denom === 0 ? 0 : Math.round((WEIGHTS.skills * (reqHit.length * 2 + prefHit.length)) / denom);
  for (const s of reqSkills) if (!have.has(s)) gaps.push(`Required skill not evidenced in resume: ${s}`);
  for (const s of prefSkills) if (!have.has(s)) gaps.push(`Preferred skill not evidenced: ${s}`);
  const matched = [...reqHit, ...prefHit].map((skill) => ({ skill, evidence: facts.skills.find((f) => f.skill === skill)?.evidence ?? "" }));

  // Role (20): overlap of meaningful title/responsibility words with resume text.
  const words = [...new Set(full.toLowerCase().match(/[a-z]{4,}/g) ?? [])].filter((w) => !STOP.has(w));
  const resumeLower = resume.toLowerCase();
  const titleWords = [...new Set(job.title.toLowerCase().match(/[a-z]{3,}/g) ?? [])].filter((w) => !STOP.has(w));
  const titleHit = titleWords.length ? titleWords.filter((w) => resumeLower.includes(w)).length / titleWords.length : 0;
  const descHit = words.length ? words.filter((w) => resumeLower.includes(w)).length / words.length : 0;
  const role = Math.round(WEIGHTS.role * Math.min(1, titleHit * 0.6 + descHit * 0.8));

  // Experience (15): seniority realism. Never infers years of experience the resume does not state.
  let experience = 8;
  const yearsReq = /(\d+)\s*\+?\s*(?:years|yrs)/i.exec(full);
  if (ENTRY.test(full)) experience = facts.entry_level_target || !SENIOR.test(resume) ? 15 : 12;
  else if (SENIOR.test(job.title) || (yearsReq && Number(yearsReq[1]) >= 5)) {
    experience = 2;
    gaps.push(`Seniority or experience requirement (${yearsReq ? yearsReq[0] : "senior role"}) is above what the resume evidences`);
  } else if (yearsReq && Number(yearsReq[1]) >= 3) {
    experience = 6;
    gaps.push(`Asks for ${yearsReq[0]} of experience`);
  }

  // Education (10)
  const wantsDegree = DEGREE.test(desc);
  const education = wantsDegree ? (facts.has_degree ? 10 : 2) : facts.has_degree ? 8 : 6;
  if (wantsDegree && !facts.has_degree) gaps.push("Degree or qualification mentioned; none evidenced in resume");

  // Location / arrangement (10)
  const loc = `${job.location ?? ""} ${job.work_arrangement ?? ""} ${desc.slice(0, 600)}`.toLowerCase();
  let location = 4;
  if (/auckland|new zealand|\bnz\b/.test(loc)) location = facts.locations.some((l) => l === "auckland" || l === "new zealand") || !facts.locations.length ? 10 : 7;
  else if (/remote/.test(loc)) location = 8;
  else if (loc.trim()) {
    location = 2;
    gaps.push(`Location may not suit: ${(job.location ?? "unspecified").slice(0, 60)}`);
  }

  // Employment type (5)
  const et = `${job.employment_type ?? ""} ${job.title}`;
  const work_type = ENTRY.test(et) ? 5 : facts.entry_level_target ? 2 : 3;

  // Domain (5)
  const jobDomains = DOMAIN_TERMS.filter((d) => termRe(d).test(full));
  const domHit = jobDomains.filter((d) => facts.domains.includes(d)).length;
  const domain = jobDomains.length ? Math.round((WEIGHTS.domain * domHit) / jobDomains.length) : 2;

  const components = { skills, role, experience, education, location, work_type, domain };
  const score = Object.values(components).reduce((a, b) => a + b, 0);
  const confidence: MatchResult["confidence"] = provisional ? "low" : reqSkills.length >= 3 ? "high" : "medium";
  const explanation = provisional
    ? "Provisional score: only a title/short teaser was available, so the full description has not been assessed."
    : `Matched ${reqHit.length + prefHit.length} of ${reqSkills.length + prefSkills.length} named skills; ${gaps.length} gap${gaps.length === 1 ? "" : "s"} noted.`;
  return { score, band: bandFor(score), components, matched, gaps: gaps.slice(0, 8), explanation, confidence, provisional };
}

const STOP = new Set(["with", "that", "this", "have", "will", "from", "your", "you", "are", "our", "the", "and", "for", "work", "team", "role", "experience", "ability", "skills", "strong", "knowledge", "working", "years", "including", "such", "able", "must", "well", "other", "about", "their", "they", "more", "who", "what"]);
