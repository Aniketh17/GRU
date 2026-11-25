// Tailor CV tab (Revamp 3B): which keywords are missing or buried, what to lead with, rewritten top bullets, and how the resume should look.
// The analysis runs on this device. Only the rewriting uses the AI, and every rewrite is checked against the resume on the server.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "react-router";
import { ApiError, api, type Kit } from "../lib/api.ts";
import { analyse, exportKit } from "../lib/tailor.ts";
import { useToast } from "./Toast.tsx";
import { Banner, Button, Card, ErrorState, Pill, SkeletonRows } from "./ui.tsx";

export function TailorTab({ id, onNeedPosting }: { id: number; onNeedPosting: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["tailor", id], queryFn: () => api.tailorData(id) });
  const d = q.data;
  const a = useMemo(() => (d?.resume && d.description ? analyse(d.resume.text, d.description, d.title) : null), [d]);
  const gen = useMutation({
    mutationFn: () => api.tailorGenerate(id, { keywords: a?.keywords.map((k) => k.keyword) ?? [], bullets: a?.targets ?? [] }),
    onSuccess: ({ kit }) => { qc.setQueryData(["tailor", id], (old: typeof d) => (old ? { ...old, kit, stale: false } : old)); qc.invalidateQueries({ queryKey: ["allowance"] }); },
    onError: (e) => toast({ text: e instanceof ApiError && e.code === "tailor_cap" ? "Today’s tailoring allowance is used up. The keyword gap still works; try again tomorrow." : "Couldn’t write the bullets right now." }),
  });

  if (q.isPending) return <SkeletonRows rows={3} label="Loading" />;
  if (q.isError || !d) return <ErrorState onRetry={() => q.refetch()} />;
  if (!d.resume) return <Banner tone="amber" title="Add your resume first" action={<Link to="/settings" className="font-medium underline">Open Settings</Link>}>Tailoring compares the job with your resume.</Banner>;
  if (!d.description || !a) return (
    <Banner tone="amber" title="Paste the job posting first" action={<Button size="sm" onClick={onNeedPosting}>Paste it</Button>}>
      GRU can only compare your resume with the real posting text. Job boards can’t be read automatically.
    </Banner>
  );
  const kit: Kit | null = d.kit;
  const safe = kit?.rewrites.filter((r) => r.grounded) ?? [];
  const copy = (text: string, what: string) => { void navigator.clipboard?.writeText(text).then(() => toast({ text: `${what} copied` })).catch(() => toast({ text: "Couldn’t copy" })); };

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-[14px] font-semibold">Keyword coverage</h2>
          <span className="text-[22px] leading-none font-semibold tabular-nums">{a.coverage}<span className="text-[12px] text-muted">%</span></span>
        </div>
        <span className="h-1.5 overflow-hidden rounded-sm bg-track"><span className="block h-1.5 bg-accent" style={{ width: `${a.coverage}%` }} /></span>
        <p className="m-0 text-[12.5px] text-muted">How much of what this posting stresses already appears in your resume (an applicant-tracking check you can read).</p>
      </Card>

      <Card className="flex flex-col gap-2 p-4">
        <h2 className="m-0 text-[14px] font-semibold">Keywords missing or buried ({a.keywords.length})</h2>
        {a.keywords.length === 0 ? <p className="m-0 text-[13px] text-ink-2">Your resume already covers what this posting stresses.</p> : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {a.keywords.map((k) => (
              <li key={k.keyword} className="flex items-start gap-2 text-[13px]">
                <Pill tone={k.state === "missing" ? "red" : "amber"}>{k.state}</Pill>
                <span><strong>{k.keyword}</strong><span className="block text-[12px] text-muted">{k.tip}</span></span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-2 p-4">
        <h2 className="m-0 text-[14px] font-semibold">Lead with these 2 achievements</h2>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {a.achievements.map((x) => <li key={x.text} className="text-[13px]"><span className="block text-ink">{x.text}</span><span className="block text-[12px] text-muted">{x.why}</span></li>)}
        </ul>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-[14px] font-semibold">Your top 3 bullets, rewritten for this job</h2>
          <Button size="sm" variant="primary" disabled={gen.isPending || a.targets.length === 0} onClick={() => gen.mutate()}>{kit ? "Rewrite again" : "Write tailored bullets"}</Button>
        </div>
        {d.stale && <p className="m-0 text-[12.5px] text-amber-text">The posting changed since these were written. Rewrite again for an up-to-date version.</p>}
        {!kit ? <p className="m-0 text-[12.5px] text-muted">The AI only rewrites lines you already wrote, using the posting’s wording. It may not add numbers, tools or employers: anything not in your resume is flagged and held back.</p> : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {kit.rewrites.map((r) => (
              <li key={r.index} className="rounded-lg bg-sunken p-3 text-[13px]">
                <p className="m-0 text-[12px] text-muted line-through">{r.original}</p>
                <p className="m-0 mt-1 text-ink">{r.text}</p>
                {r.grounded ? <Button size="sm" variant="quiet" className="mt-1" onClick={() => copy(r.text, "Bullet")}>Copy</Button> : (
                  <p className="m-0 mt-1 text-[12px] text-amber-text">Held back: “{r.flagged.join(", ")}” isn’t in your resume. Keep it only if it’s true, and edit it yourself.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-2 p-4">
        <h2 className="m-0 text-[14px] font-semibold">How your resume should look for this job</h2>
        <ul className="m-0 pl-5 text-[13px] text-ink-2">
          <li>Section order: <strong>{a.layout.sectionOrder.join(" → ")}</strong></li>
          <li>Length: <strong>{a.layout.length}</strong></li>
          {(kit?.summary ?? a.layout.summary) && <li>Summary line: “{kit?.summary && kit.summary_flagged.length === 0 ? kit.summary : a.layout.summary}”</li>}
          {a.layout.skillsOrder.length > 0 && <li>Skills, in this order: {a.layout.skillsOrder.join(", ")}</li>}
          {a.layout.trim.length > 0 && <li>Shorten or drop: {a.layout.trim.map((t) => `“${t.slice(0, 60)}${t.length > 60 ? "…" : ""}”`).join("; ")}</li>}
        </ul>
        <div><Button size="sm" onClick={() => copy(exportKit(d.title, d.company, a, safe, kit && kit.summary_flagged.length === 0 ? kit.summary : null), "Tailoring notes")}>Copy as notes</Button></div>
      </Card>
    </div>
  );
}
