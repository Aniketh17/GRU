// A short getting-started checklist on Today. Every step is computed from what already exists, so it ticks itself off and goes away.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api.ts";
import { Card, SectionTitle } from "./ui.tsx";

const KEY = "gru.onboarding.dismissed";
const read = (): boolean => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };

export function OnboardingCard() {
  const [hidden, setHidden] = useState(read);
  const accounts = useQuery({ queryKey: ["mailAccounts"], queryFn: api.mailAccounts });
  const resumes = useQuery({ queryKey: ["resumes"], queryFn: api.resumes });
  const prefs = useQuery({ queryKey: ["prefs"], queryFn: api.prefs });
  const net = useQuery({ queryKey: ["net", "overview"], queryFn: api.netOverview, staleTime: 60_000 });
  const summary = useQuery({ queryKey: ["summary"], queryFn: api.summary });
  if (hidden || [accounts, resumes, prefs, net, summary].some((q) => q.isPending)) return null;

  const steps = [
    { done: (accounts.data?.accounts ?? []).some((a) => a.status === "active"), text: "Connect Gmail so GRU can read your job emails", to: "/settings" },
    { done: (resumes.data?.items.length ?? 0) > 0, text: "Add your resume to score jobs and tailor your CV", to: "/settings" },
    { done: (prefs.data?.roles.length ?? 0) > 0, text: "Save the roles you’re after for one-tap job searches", to: "/settings" },
    { done: (net.data?.companies.total ?? 0) >= 5, text: "Add 5 companies you’d love to work at", to: "/network" },
    { done: (net.data?.people.total ?? 0) >= 1, text: "Add one person to learn from and draft a note to them", to: "/network" },
    { done: Object.values(summary.data?.counts ?? {}).some((n) => (n ?? 0) > 0), text: "Track your first application", to: "/applications?tab=tracked" },
  ];
  const left = steps.filter((s) => !s.done);
  if (left.length === 0) return null;
  const dismiss = () => { try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ } setHidden(true); };
  return (
    <Card>
      <SectionTitle aside={<button type="button" onClick={dismiss} className="cursor-pointer text-[12.5px] text-muted underline">Dismiss</button>}>Getting started · {steps.length - left.length} of {steps.length}</SectionTitle>
      <ul className="m-0 flex list-none flex-col gap-2 px-5 pb-4">
        {steps.map((s) => (
          <li key={s.text} className="flex items-start gap-2.5 text-[13.5px] leading-snug">
            <span aria-hidden="true" className={`w-4 flex-none text-center ${s.done ? "text-green" : "text-muted"}`}>{s.done ? "✓" : "○"}</span>
            {s.done ? <span className="text-muted line-through">{s.text}</span> : <Link to={s.to}>{s.text}</Link>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
