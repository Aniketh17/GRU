// Linking order (spec §9): (1) same thread as an already-linked email, (2) exactly one
// application whose company matches, (3) otherwise unlinked. Never guesses between two.
import type { Status } from "../domain/applications.ts";
import { companyMatches, type CompanyGuess } from "./company.ts";
import type { LinkResult } from "./decide.ts";

export interface AppRef {
  id: number;
  company_norm: string;
  status: Status;
}

export function resolveLink(guesses: CompanyGuess[], apps: readonly AppRef[], threadAppId: number | null): LinkResult {
  const confidentGuess = guesses.find((g) => g.confident) ?? null;
  const company = confidentGuess ? { name: confidentGuess.name, confident: true } : guesses[0] ? { name: guesses[0].name, confident: false } : null;

  if (threadAppId !== null) {
    const app = apps.find((a) => a.id === threadAppId);
    if (app) return { appId: app.id, appStatus: app.status, via: "thread", company, ambiguous: false };
  }
  const matched = new Map<number, AppRef>();
  for (const g of guesses) for (const a of apps) if (companyMatches(a.company_norm, g.norm)) matched.set(a.id, a);
  if (matched.size === 1) {
    const app = [...matched.values()][0] as AppRef;
    return { appId: app.id, appStatus: app.status, via: "company", company, ambiguous: false };
  }
  return { appId: null, appStatus: null, via: null, company, ambiguous: matched.size > 1 };
}
