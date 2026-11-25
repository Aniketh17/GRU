// Vacancies with a 100-point resume match (evidence and gaps). "Apply today" = good matches ready to apply; "Other jobs" = the rest, with filters.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Modal } from "../components/Dialog.tsx";
import { MailViewer } from "../components/MailViewer.tsx";
import { PlusIcon } from "../components/Icons.tsx";
import { useToast } from "../components/Toast.tsx";
import { Banner, Button, Card, EmptyState, ErrorState, Field, PageHeader, Pill, Select, SkeletonRows, TextArea } from "../components/ui.tsx";
import { ApiError, api, type Job, type JobInput } from "../lib/api.ts";
import { dateInputToEpoch, formatShort } from "../lib/format.ts";

const BAND_TONE = { strong: "accent", good: "accent", possible: "amber", low: "neutral" } as const;

export function JobsPanel({ mode }: { mode: "apply" | "other" }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState(mode === "apply" ? "queue" : "open");
  const [band, setBand] = useState("");
  const [adding, setAdding] = useState(false);
  const [params] = useSearchParams();
  const nav = useNavigate();
  useEffect(() => {
    const o = Number(params.get("open"));
    if (o > 0) nav(`/jobs/${o}`, { replace: true });
  }, [params, nav]);
  const [alertMail, setAlertMail] = useState<{ accountId: number; gmailId: string } | null>(null);
  const [ambiguous, setAmbiguous] = useState<{ job: Job; candidates: { id: number; company: string; role: string | null }[] } | null>(null);

  const q = useQuery({
    queryKey: ["jobs", view, band],
    queryFn: async () => (view === "queue" ? api.jobQueue() : api.jobs(view, band)),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["jobs"] });
    qc.invalidateQueries({ queryKey: ["brief"] });
  };
  const decide = useMutation({
    mutationFn: (v: { id: number; d: "shortlist" | "save" | "dismiss" | "reopen" }) => api.jobDecision(v.id, v.d),
    onSuccess: (_r, v) => { refresh(); toast({ text: v.d === "dismiss" ? "Dismissed" : v.d === "shortlist" ? "Shortlisted" : "Saved" }); },
  });
  const tryApply = async (job: Job) => {
    try {
      const r = await api.markApplied(job.id, {});
      refresh(); qc.invalidateQueries({ queryKey: ["applications"] }); qc.invalidateQueries({ queryKey: ["summary"] });
      toast({ text: "Marked as applied" }); nav(`/applications/${r.app_id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "ambiguous") setAmbiguous({ job, candidates: (e.data.candidates as { id: number; company: string; role: string | null }[]) ?? [] });
      else toast({ text: "Couldn’t mark as applied" });
    }
  };

  const items = q.data?.items ?? [];
  const likely = (q.data as { likely_applied?: Job[] } | undefined)?.likely_applied ?? [];
  const hasResume = q.data?.has_resume ?? true;

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4">
      <PageHeader
        title={mode === "apply" ? "Apply today" : "Other jobs"}
        subtitle={mode === "apply"
          ? `${items.length} good match${items.length === 1 ? "" : "es"} ready to apply (score ${(q.data as { threshold?: number } | undefined)?.threshold ?? 65}+, with a link), best first. A score is a decision aid; you always apply yourself.`
          : "Everything else GRU has found. Filter by status and match."}
        actions={<Button variant="primary" size="sm" className="rounded-full" onClick={() => setAdding(true)}><PlusIcon size={14} />Add vacancy</Button>}
      />
      {!hasResume && (
        <Banner tone="amber" title="Not scored – add a resume" action={<Link to="/settings" className="font-medium underline">Open Settings</Link>}>
          Paste your resume in Settings to see match scores. GRU never invents a score.
        </Banner>
      )}
      {mode === "other" && (
        <div className="flex flex-wrap gap-2">
          <div className="w-44"><Select label="Show" value={view} onChange={(e) => setView(e.target.value)}>
            <option value="open">All open</option><option value="dismissed">Dismissed</option><option value="applied">Applied</option>
          </Select></div>
          <div className="w-40"><Select label="Match" value={band} onChange={(e) => setBand(e.target.value)}>
            <option value="">Any</option><option value="strong">Strong 80+</option><option value="good">Good 65+</option><option value="possible">Possible 50+</option><option value="low">Low</option>
          </Select></div>
        </div>
      )}

      {q.isPending ? <SkeletonRows rows={3} label="Loading jobs" /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : items.length === 0 ? (
        <Card><EmptyState title={view === "queue" ? "Nothing to apply for right now" : "No vacancies here"}>
          {view === "queue" ? `Jobs scoring ${(q.data as { threshold?: number })?.threshold ?? 65}+ with an application link appear here, best first, as soon as they arrive in your job alerts. You can also add a vacancy yourself.` : "Add a vacancy by pasting its details."}
        </EmptyState></Card>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {items.map((j) => (
            <li key={j.id}>
              <Card className="flex flex-col gap-2.5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <button type="button" onClick={() => nav(`/jobs/${j.id}`)} className="min-w-0 flex-1 cursor-pointer text-left">
                    <p className="m-0 line-clamp-2 text-[15px] leading-snug font-semibold">{j.title}</p>
                    <p className="m-0 truncate text-[13px] text-muted">{[j.company, j.location, j.work_arrangement].filter(Boolean).join(" · ") || "Details not set"}</p>
                  </button>
                  {j.score === null ? <Pill tone="neutral">Not scored</Pill> : (
                    <span className="flex flex-none flex-col items-end">
                      <span className="text-[22px] leading-none font-semibold tabular-nums">{j.score}<span className="text-[12px] text-muted">/100</span></span>
                      <Pill tone={BAND_TONE[j.band ?? "low"]}>{j.band}{j.confidence === "low" ? " · provisional" : ""}</Pill>
                    </span>
                  )}
                </div>
                <p className="m-0 text-[12px] text-muted">Found {formatShort(j.first_seen_at)}{j.closing_at ? ` · closes ${formatShort(j.closing_at)}` : ""} · {j.source}{j.status !== "new" ? ` · ${j.status}` : ""}</p>
                <div className="flex flex-wrap gap-2">
                  {j.alert && <Button size="sm" onClick={() => setAlertMail({ accountId: j.alert!.account_id, gmailId: j.alert!.gmail_id })}>From alert email</Button>}
                  {j.url && <a href={j.url} target="_blank" rel="noopener noreferrer" className={mode === "apply" && j.status !== "applied" ? "inline-flex h-8 items-center rounded-[10px] bg-accent px-3.5 text-[12.5px] font-semibold text-accent-ink no-underline hover:brightness-95" : "inline-flex h-8 items-center rounded-[10px] border border-line px-3 text-[12.5px] font-medium text-ink no-underline hover:bg-sunken"}>{mode === "apply" && j.status !== "applied" ? "Apply" : "Open link"} ↗</a>}
                  {j.status !== "applied" && <>
                    <Button size="sm" onClick={() => decide.mutate({ id: j.id, d: "shortlist" })}>Shortlist</Button>
                    <Button size="sm" onClick={() => tryApply(j)}>I applied</Button>
                    {j.status === "dismissed" ? <Button size="sm" variant="quiet" onClick={() => decide.mutate({ id: j.id, d: "reopen" })}>Reopen</Button> : <Button size="sm" variant="quiet" onClick={() => decide.mutate({ id: j.id, d: "dismiss" })}>Not interested</Button>}
                  </>}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {mode === "apply" && likely.length > 0 && (
        <details className="rounded-xl border border-line bg-surface p-3">
          <summary className="cursor-pointer text-[13.5px] font-semibold">Likely already applied ({likely.length})</summary>
          <p className="m-0 mt-1 text-[12.5px] text-muted">Hidden from Apply today so you don’t apply twice. If GRU got it wrong, open the job and tap “Not the same job”.</p>
          <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
            {likely.map((j) => (
              <li key={j.id} className="flex items-start justify-between gap-3 rounded-lg bg-sunken px-3 py-2">
                <button type="button" onClick={() => nav(`/jobs/${j.id}`)} className="min-w-0 cursor-pointer text-left">
                  <span className="block truncate text-[13.5px] font-medium">{j.title}{j.company ? ` · ${j.company}` : ""}</span>
                  <span className="block text-[12px] text-muted">{j.dedupe?.reason}</span>
                </button>
                <Button size="sm" variant="quiet" onClick={() => api.jobNotSame(j.id).then(refresh)}>Not the same</Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {alertMail && <MailViewer accountId={alertMail.accountId} gmailId={alertMail.gmailId} onClose={() => setAlertMail(null)} />}
      {adding && <AddJob onClose={() => setAdding(false)} onDone={refresh} />}
      {ambiguous && (
        <Modal open onClose={() => setAmbiguous(null)} title="Link to an existing application?">
          <p className="m-0 text-ink-2">You already have applications with {ambiguous.job.company}. Link this vacancy to one, or create a new application.</p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {ambiguous.candidates.map((c) => (
              <li key={c.id}><Button className="w-full justify-start" onClick={() => api.markApplied(ambiguous.job.id, { link_application_id: c.id }).then((r) => { refresh(); setAmbiguous(null); nav(`/applications/${r.app_id}`); })}>{c.company} · {c.role ?? "no role"}</Button></li>
            ))}
          </ul>
          <Button variant="primary" onClick={() => api.markApplied(ambiguous.job.id, { create_new: true }).then((r) => { refresh(); qc.invalidateQueries({ queryKey: ["applications"] }); setAmbiguous(null); nav(`/applications/${r.app_id}`); })}>Create a new application</Button>
        </Modal>
      )}
    </div>
  );
}

function AddJob({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ title: "", company: "", location: "", work_arrangement: "", url: "", closing: "", description: "" });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const d: JobInput = { title: f.title.trim() };
      if (f.company.trim()) d.company = f.company.trim();
      if (f.location.trim()) d.location = f.location.trim();
      if (f.work_arrangement) d.work_arrangement = f.work_arrangement as "remote" | "hybrid" | "onsite";
      if (f.url.trim()) d.url = f.url.trim();
      if (f.description.trim()) d.description = f.description.trim();
      const c = dateInputToEpoch(f.closing);
      if (c) d.closing_at = c;
      return api.createJob(d);
    },
    onSuccess: (r) => { toast({ text: r.duplicate ? "Already saved (duplicate)" : "Vacancy added and scored" }); onDone(); onClose(); },
    onError: () => toast({ text: "Couldn’t add vacancy. Check the link is a full https:// URL." }),
  });
  return (
    <Modal open onClose={onClose} title="Add vacancy" wide>
      <Field label="Job title" value={f.title} maxLength={200} onChange={(e) => set("title", e.target.value)} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company" value={f.company} onChange={(e) => set("company", e.target.value)} />
        <Field label="Location" value={f.location} onChange={(e) => set("location", e.target.value)} />
        <Select label="Work arrangement" value={f.work_arrangement} onChange={(e) => set("work_arrangement", e.target.value)}>
          <option value="">Not stated</option><option value="onsite">On-site</option><option value="hybrid">Hybrid</option><option value="remote">Remote</option>
        </Select>
        <Field label="Closing date (optional)" type="date" value={f.closing} onChange={(e) => set("closing", e.target.value)} />
      </div>
      <Field label="Application link" type="url" placeholder="https://" value={f.url} onChange={(e) => set("url", e.target.value)} />
      <TextArea label="Description / requirements (paste for an accurate score)" rows={7} maxLength={30000} value={f.description} onChange={(e) => set("description", e.target.value)} />
      <Button variant="primary" disabled={!f.title.trim() || save.isPending} onClick={() => save.mutate()}>Save vacancy</Button>
    </Modal>
  );
}
