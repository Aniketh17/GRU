// Curiosity-first outreach drafts (Revamp 3E). Never asks for a job: it asks about their work, their path, the skills they look for
// and the problems they are solving. Pure templates, so they work with no AI allowance; the AI may only polish the wording.
export type DraftKind = "connect" | "coffee" | "followup" | "thanks" | "questions";
export const DRAFT_KINDS: readonly DraftKind[] = ["connect", "coffee", "followup", "thanks", "questions"];

export interface DraftInput { personName: string; role: string | null; company: string | null; skills: string[]; yourName: string | null }

const first = (n: string): string => n.trim().split(/\s+/)[0] ?? n;
const list = (xs: string[]): string => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** The first line of a resume when it looks like a person's name (2 to 3 capitalised words). */
export function nameFromResume(resume: string): string | null {
  const line = resume.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  return /^[A-Z][a-z'-]+(?: [A-Z][a-z'-]+){1,2}$/.test(line) ? line : null;
}

export function draft(kind: DraftKind, i: DraftInput): { text: string; limit: number | null } {
  const them = first(i.personName);
  const at = i.company ? ` at ${i.company}` : "";
  const work = i.role ? `your work as ${/^[AEIOU]/i.test(i.role) ? "an" : "a"} ${i.role}${at}` : i.company ? `the work at ${i.company}` : "your work";
  const me = i.skills.length ? `I've been building with ${list(i.skills.slice(0, 3))}` : "I'm early in my career";
  const sign = i.yourName ? `\n\nThanks,\n${i.yourName}` : "\n\nThanks!";
  switch (kind) {
    case "connect": {
      const t = `Hi ${them}, ${me} and I'm curious about ${work}. Would love to connect and learn from how you got there. No ask, just curiosity.`;
      return { text: t.length <= 200 ? t : `Hi ${them}, I'm curious about ${work} and would love to connect and learn how you got there. No ask, just curiosity.`.slice(0, 200), limit: 200 };
    }
    case "coffee":
      return { limit: null, text: `Hi ${them},\n\n${me}, and I keep coming back to ${work}. I'm not looking for anything from you right now. I'd just really value 15 minutes of your time, on a call or a coffee, to hear what the work is really like, what problems your team is wrestling with, and what skills you'd focus on if you were starting again.\n\nIf now isn't a good time, no problem at all.${sign}` };
    case "followup":
      return { limit: null, text: `Hi ${them},\n\nJust a gentle nudge on my earlier note. I'm still curious about ${work}, and a short chat would mean a lot. Completely fine if you're busy.${sign}` };
    case "thanks":
      return { limit: null, text: `Hi ${them},\n\nThank you for taking the time to talk. I really appreciated hearing [one specific thing you learned], and it's changed how I'm thinking about [what you'll do next]. I'll [one concrete step you'll take] and would love to tell you how it goes.${sign}\n\n(Fill in the [brackets] with something real, it's what makes a thank-you land.)` };
    case "questions":
      return { limit: null, text: [
        `What does a normal week look like in ${work}?`,
        "What problem is your team trying to solve right now that you find genuinely hard?",
        "Which skills have mattered most in your day-to-day, and which did you learn on the job?",
        "How did you get into this, and what would you do differently?",
        "What do people who do well on your team have in common?",
        "Who else would you suggest I talk to, so I keep learning?",
      ].map((q, n) => `${n + 1}. ${q}`).join("\n") };
  }
}

/** Never let a draft ask for a job. Used to reject AI polish that drifts into asking. */
export const asksForJob = (text: string): boolean => /\b(?:any (?:job|openings?|roles?|vacanc)|hiring|referr?(?:al|ing)|looking for (?:a )?(?:job|work|role|internship)|apply)\b/i.test(text);
