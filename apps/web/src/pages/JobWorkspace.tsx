// Job workspace (Revamp 3A/3C): one page per vacancy: overview, fit (why this score), insights (what GRU already knows about it).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Modal } from "../components/Dialog.tsx";
import { MailViewer } from "../components/MailViewer.tsx";
import { useToast } from "../components/Toast.tsx";
import { Banner, Button, Card, ErrorState, Pill, SkeletonRows, TextArea, cx } from "../components/ui.tsx";
import { ApiError, api, type JobDetail } from "../lib/api.ts";
import { formatShort } from "../lib/format.ts";

const BAND_TONE = { strong: "accent", good: "accent", possible: "amber", low: "neutral" } as const;
const DIM: Record<string, [string, number]> = { skills: ["Skills", 35], role: ["Role", 20], experience: ["Experience", 15], education: ["Education", 10], location: ["Location", 10], work_type: ["Employment type", 5], domain: ["Domain", 5] };
const TABS = [["overview", "Overview"], ["fit", "Fit"], ["insights", "Insights"]] as const;
type Tab = (typeof TABS)[number][0];

export function JobWorkspacePage() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("overview");
  const [mail, setMail] = useState(false);
  const [ambiguous, setAmbiguous] = useState<{ id: number; company: string; role: string | null }[] | null>(null);
  const q = useQuery({ queryKey: ["job", id], queryFn: () => api.job(id), enabled: Number.isInteger(id) });
  const j = q.data;
  const refresh = () => { for (const k of ["job", "jobs", "brief", "jobInsights"]) qc.invalidateQueries({ queryKey: [k] }); };
  const decide = useMutation({
    mutationFn: (d: "shortlist" | "save" | "dismiss" | "reopen") => api.jobDecision(id, d),
    onSuccess: (_r, d) => { refresh(); toast({ text: d === "dismiss" ? "Dismissed" : d === "shortlist" ? "Shortlisted" : d === "reopen" ? "Reopened" : "Saved" }); },
  });
  const applied = async (opts: { link_application_id?: number; create_new?: boolean } = {}) => {
    try {
      const r = await api.markApplied(id, opts);
      refresh(); qc.invalidateQueries({ queryKey: ["applications"] }); qc.invalidateQueries({ queryKey: ["summary"] });
      toast({ text: "Marked as applied" }); nav(`/applications/${r.app_id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "ambiguous") setAmbiguous((e.data.candidates as { id: number; company: string; role: string | null }[]) ?? []);
      else toast({ text: "Couldn’t mark as applied" });
    }
  };

  if (q.isPending) return <div className="mx-auto w-full max-w-[860px]"><SkeletonRows rows={4} label="Loading job" /></div>;
  if (q.isError || !j) return <div className="mx-auto w-full max-w-[860px]"><ErrorState onRetry={() => q.refetch()} message="This job could not be found." /></div>;
  const done = j.status === "applied";

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4">
      <div>
        <Link to="/applications" className="text-[12.5px] text-muted no-underline hover:underline">← Jobs</Link>
        <div className="mt-1 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="m-0 text-[22px] leading-tight font-semibold">{j.title}</h1>
            <p className="m-0 text-[13.5px] text-muted">{[j.company, j.location, j.work_arrangement, j.employment_type].filter(Boolean).join(" · ") || "Details not set"}</p>
          </div>
          {j.score !== null && (
            <span className="flex flex-none flex-col items-end">
              <span className="text-[28px] leading-none font-semibold tabular-nums">{j.score}<span className="text-[13px] text-muted">/100</span></span>
              <Pill tone={BAND_TONE[j.band ?? "low"]}>{j.band}{j.confidence === "low" ? " · provisional" : ""}</Pill>
            </span>
          )}
        </div>
      </div>

      {j.dedupe && (
        <Banner tone="amber" title="You may have already applied for this" action={j.dedupe.app_id ? <Link to={`/applications/${j.dedupe.app_id}?status=all`} className="font-medium underline">Open application</Link> : undefined}>
          {j.dedupe.reason}
          {j.dedupe.status === "likely_applied" && <> <button type="button" className="cursor-pointer underline" onClick={() => api.jobNotSame(id).then(() => { refresh(); toast({ text: "Okay, treating it as a different job" }); })}>Not the same job</button></>}
        </Banner>
      )}

      <div className="flex flex-wrap gap-2">
        {j.url && !done && <a href={j.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center rounded-[10px] bg-accent px-4 text-[13px] font-semibold text-accent-ink no-underline hover:brightness-95">Apply ↗</a>}
        {!done && <Button onClick={() => applied()}>I applied</Button>}
        {!done && <Button onClick={() => decide.mutate("shortlist")}>Shortlist</Button>}
        {!done && (j.status === "dismissed" ? <Button variant="quiet" onClick={() => decide.mutate("reopen")}>Reopen</Button> : <Button variant="quiet" onClick={() => decide.mutate("dismiss")}>Not interested</Button>)}
        {done && j.dedupe?.app_id && <Link to={`/applications/${j.dedupe.app_id}?status=all`} className="inline-flex h-9 items-center rounded-[10px] border border-line px-3 text-[13px] font-medium text-ink no-underline">View application</Link>}
      </div>

      <div role="tablist" aria-label="Job sections" className="flex gap-1 border-b border-line">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cx("-mb-px cursor-pointer border-b-2 px-3 py-2 text-[13.5px]", tab === k ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:text-ink")}>{label}</button>
        ))}
      </div>

      {tab === "overview" && <Overview id={id} j={j} onMail={() => setMail(true)} refresh={refresh} />}
      {tab === "fit" && <Fit j={j} />}
      {tab === "insights" && <Insights id={id} />}

      {mail && j.alert && <MailViewer accountId={j.alert.account_id} gmailId={j.alert.gmail_id} onClose={() => setMail(false)} />}
      {ambiguous && (
        <Modal open onClose={() => setAmbiguous(null)} title="Link to an existing application?">
          <p className="m-0 text-ink-2">You already have applications with {j.company}. Link this vacancy to one, or create a new application.</p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {ambiguous.map((c) => <li key={c.id}><Button className="w-full justify-start" onClick={() => { setAmbiguous(null); void applied({ link_application_id: c.id }); }}>{c.company} · {c.role ?? "no role"}</Button></li>)}
          </ul>
          <Button variant="primary" onClick={() => { setAmbiguous(null); void applied({ create_new: true }); }}>Create a new application</Button>
        </Modal>
      )}
    </div>
  );

}

function Overview({ id, j, onMail, refresh }: { id: number; j: JobDetail; onMail: () => void; refresh: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const save = useMutation({
    mutationFn: () => api.jobDescription(id, text),
    onSuccess: () => { setText(""); refresh(); toast({ text: "Saved. Score recalculated from the real posting." }); },
    onError: () => toast({ text: "Couldn’t save (needs at least 20 characters)" }),
  });
  return (
    <div className="flex flex-col gap-3">
      <Card className="grid gap-2 p-4 text-[13.5px] sm:grid-cols-2">
        <Fact k="Source" v={j.source} />
        <Fact k="Found" v={formatShort(j.first_seen_at)} />
        <Fact k="Closes" v={j.closing_at ? formatShort(j.closing_at) : "Not stated"} />
        <Fact k="Status" v={j.status} />
      </Card>
      {j.alert && <div><Button size="sm" onClick={() => onMail()}>Open the alert email it came from</Button></div>}
      {j.description ? (
        <Card className="p-4"><h2 className="m-0 mb-1 text-[14px] font-semibold">Posting text</h2><p className="m-0 whitespace-pre-wrap text-[13px] text-ink-2">{j.description}</p></Card>
      ) : (
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="m-0 text-[14px] font-semibold">Paste the posting</h2>
          <p className="m-0 text-[12.5px] text-muted">{j.confidence === "low" ? "This score is provisional (title only). " : ""}Paste the job description from the website for an accurate score. It is stored encrypted and never leaves GRU.</p>
          <TextArea label="Job description" rows={6} maxLength={30000} value={text} onChange={(e) => setText(e.target.value)} />
          <div><Button variant="primary" size="sm" disabled={text.trim().length < 20 || save.isPending} onClick={() => save.mutate()}>Save and re-score</Button></div>
        </Card>
      )}
    </div>
  );
}

function Fit({ j }: { j: JobDetail }) {
  const m = j.match;
  if (!m) return <Card className="p-4 text-[13px] text-muted">Not scored. <Link to="/settings">Add your resume in Settings</Link> to see how well this job fits.</Card>;
  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-3 p-4">
        <p className="m-0 text-[13.5px] text-ink-2">{m.evidence?.explanation} Confidence: <strong>{j.confidence}</strong>.</p>
        <div className="grid gap-1.5">
          {Object.entries(m.components).map(([k, v]) => {
            const [label, max] = DIM[k] ?? [k, 10];
            return (
              <div key={k} className="flex items-center gap-2 text-[12.5px]">
                <span className="w-36 text-muted">{label} ({max})</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-sm bg-track"><span className="block h-1.5 bg-accent" style={{ width: `${Math.round((v / max) * 100)}%` }} /></span>
                <span className="w-8 text-right tabular-nums">{v}</span>
              </div>
            );
          })}
        </div>
      </Card>
      {(m.evidence?.matched.length ?? 0) > 0 && (
        <Card className="p-4"><h2 className="m-0 mb-1 text-[14px] font-semibold">Strengths from your resume</h2>
          <ul className="m-0 pl-5 text-[12.5px] text-ink-2">{m.evidence?.matched.map((x) => <li key={x.skill}><strong>{x.skill}</strong>{x.evidence ? ` — “…${x.evidence}…”` : ""}</li>)}</ul></Card>
      )}
      {m.gaps.length > 0 && <Card className="p-4"><h2 className="m-0 mb-1 text-[14px] font-semibold">Gaps</h2><ul className="m-0 pl-5 text-[12.5px] text-ink-2">{m.gaps.map((g) => <li key={g}>{g}</li>)}</ul></Card>}
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return <p className="m-0"><span className="text-muted">{k}: </span><span className="font-medium capitalize">{v}</span></p>;
}

function Insights({ id }: { id: number }) {
  const q = useQuery({ queryKey: ["jobInsights", id], queryFn: () => api.jobInsights(id) });
  if (q.isPending) return <SkeletonRows rows={3} label="Loading insights" />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-1 p-4">
        <h2 className="m-0 text-[14px] font-semibold">Have I applied already?</h2>
        {d.applied ? <p className="m-0 text-[13px] text-ink-2">{d.applied.reason ?? "Yes, this job is linked to an application."}</p> : <p className="m-0 text-[13px] text-ink-2">No match found among your applications.</p>}
      </Card>
      <Card className="flex flex-col gap-1.5 p-4">
        <h2 className="m-0 text-[14px] font-semibold">History with this company</h2>
        {d.company_history.length === 0 ? <p className="m-0 text-[13px] text-muted">No earlier applications here.</p> : (
          <>
            <p className="m-0 text-[13px] text-ink-2">{d.company_summary}</p>
            <ul className="m-0 pl-5 text-[12.5px] text-ink-2">{d.company_history.map((a) => <li key={a.id}><Link to={`/applications/${a.id}?status=all`}>{a.role ?? "Role not set"}</Link> · {a.status}{a.applied_at ? ` · applied ${formatShort(a.applied_at)}` : ""}</li>)}</ul>
          </>
        )}
        {d.known_contacts > 0 && <p className="m-0 text-[13px] text-ink-2">You’ve had mail from {d.known_contacts} {d.known_contacts === 1 ? "person" : "people"} at this company. Worth asking about a referral.</p>}
      </Card>
      <Card className="flex flex-col gap-1.5 p-4">
        <h2 className="m-0 text-[14px] font-semibold">Same role elsewhere</h2>
        {d.same_role_elsewhere.length === 0 ? <p className="m-0 text-[13px] text-muted">GRU hasn’t seen this role on another board.</p> : (
          <ul className="m-0 pl-5 text-[12.5px] text-ink-2">{d.same_role_elsewhere.map((o) => <li key={o.id}><Link to={`/jobs/${o.id}`}>On {o.source}</Link> · {o.status}</li>)}</ul>
        )}
        {d.other_roles_here.length > 0 && <p className="m-0 text-[12.5px] text-muted">Also open here: {d.other_roles_here.map((o) => o.title).join(", ")}</p>}
      </Card>
      <Card className="flex flex-col gap-1 p-4">
        <h2 className="m-0 text-[14px] font-semibold">Timing</h2>
        <p className="m-0 text-[13px] text-ink-2">
          Found {d.first_seen_days === 0 ? "today" : `${d.first_seen_days} day${d.first_seen_days === 1 ? "" : "s"} ago`}.{" "}
          {d.closing ? (d.closing.days_left < 0 ? "It has closed." : d.closing.days_left === 0 ? "It closes today." : `Closes in ${d.closing.days_left} day${d.closing.days_left === 1 ? "" : "s"} (${formatShort(d.closing.at)}).`) : "No closing date stated."}
        </p>
      </Card>
    </div>
  );
}
