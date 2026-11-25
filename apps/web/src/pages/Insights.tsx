// Insights (Revamp 3G): what your search is telling you. Plain bars, no chart library, every number readable as text too.
import { useQuery } from "@tanstack/react-query";
import { Card, EmptyState, ErrorState, PageHeader, SkeletonRows } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { formatShort } from "../lib/format.ts";

function Bar({ name, value, max, note, tone = "bg-accent" }: { name: string; value: number; max: number; note?: string; tone?: string }) {
  const pct = max > 0 ? Math.max(value > 0 ? 3 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <span className="w-28 flex-none text-ink-2">{name}</span>
      <span className="h-3 flex-1 overflow-hidden rounded-sm bg-track"><span className={`block h-3 ${tone}`} style={{ width: `${pct}%` }} /></span>
      <span className="w-20 flex-none text-right tabular-nums"><strong>{value}</strong>{note ? <span className="text-muted"> {note}</span> : null}</span>
    </div>
  );
}

const pct = (a: number, b: number): string => (b > 0 ? `${Math.round((a / b) * 100)}%` : "–");

export function InsightsPage() {
  const q = useQuery({ queryKey: ["insights"], queryFn: api.insights });
  const d = q.data;
  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4">
      <PageHeader title="Insights" subtitle="What your search is telling you, from your own applications, job alerts and conversations." />
      {q.isPending ? <SkeletonRows rows={4} label="Loading insights" /> : q.isError || !d ? <ErrorState onRetry={() => q.refetch()} /> : d.funnel.applied === 0 && d.network.tracked === 0 ? (
        <Card><EmptyState title="Nothing to chart yet">Insights appear once you have applications or people in your network.</EmptyState></Card>
      ) : (
        <>
          <Card className="flex flex-col gap-2 p-4">
            <h2 className="m-0 text-[14px] font-semibold">Application funnel</h2>
            <Bar name="Applied" value={d.funnel.applied} max={d.funnel.applied} />
            <Bar name="Heard back" value={d.funnel.replied} max={d.funnel.applied} note={pct(d.funnel.replied, d.funnel.applied)} />
            <Bar name="Assessment" value={d.funnel.assessment} max={d.funnel.applied} />
            <Bar name="Interview" value={d.funnel.interview} max={d.funnel.applied} />
            <Bar name="Offer" value={d.funnel.offer} max={d.funnel.applied} tone="bg-green" />
            <p className="m-0 text-[12.5px] text-muted">{d.median_days_to_reply !== null ? `Typical first reply: ${Math.round(d.median_days_to_reply)} day${Math.round(d.median_days_to_reply) === 1 ? "" : "s"} after applying. ` : ""}If few applications get a reply, tailor your CV for each job and talk to people at the company first.</p>
          </Card>

          <Card className="flex flex-col gap-2 p-4">
            <h2 className="m-0 text-[14px] font-semibold">Applications per week</h2>
            {(() => { const max = Math.max(1, ...d.weekly.map((w) => w.applied)); return d.weekly.map((w) => <Bar key={w.week_start} name={`Week of ${formatShort(w.week_start)}`} value={w.applied} max={max} />); })()}
          </Card>

          {d.by_source.length > 0 && (
            <Card className="flex flex-col gap-2 p-4">
              <h2 className="m-0 text-[14px] font-semibold">Where replies come from</h2>
              {d.by_source.map((s) => <Bar key={s.source} name={s.source} value={s.replied} max={Math.max(1, ...d.by_source.map((x) => x.total))} note={`of ${s.total} · ${pct(s.replied, s.total)}`} />)}
            </Card>
          )}

          {d.demand.length > 0 && (
            <Card className="flex flex-col gap-2 p-4">
              <h2 className="m-0 text-[14px] font-semibold">Skills your best-matching jobs ask for</h2>
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {d.demand.map((s) => (
                  <li key={s.skill} className={`rounded-full border px-3 py-1 text-[12.5px] ${s.have === s.asked ? "border-line bg-sunken text-ink-2" : "border-amber-text/40 bg-amber-soft text-amber-text"}`}>
                    {s.skill} <span className="tabular-nums">· {s.asked}</span>{s.have < s.asked ? " · gap" : ""}
                  </li>
                ))}
              </ul>
              <p className="m-0 text-[12.5px] text-muted">From your {d.sample} newest good-fit jobs. Highlighted skills are asked for more often than your resume shows: worth learning, or worth surfacing if you already have them.</p>
            </Card>
          )}

          <Card className="flex flex-col gap-2 p-4">
            <h2 className="m-0 text-[14px] font-semibold">Networking funnel</h2>
            <Bar name="People tracked" value={d.network.tracked} max={Math.max(1, d.network.tracked)} />
            <Bar name="Reached out" value={d.network.contacted} max={Math.max(1, d.network.tracked)} />
            <Bar name="Replied" value={d.network.replied} max={Math.max(1, d.network.tracked)} note={pct(d.network.replied, d.network.contacted)} />
            <Bar name="Conversations" value={d.network.talked} max={Math.max(1, d.network.tracked)} tone="bg-green" />
          </Card>
        </>
      )}
    </div>
  );
}
