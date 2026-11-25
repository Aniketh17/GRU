// Pipeline board (Revamp 3G): your applications as columns by status. Drag a card to another column on desktop;
// on a phone use the "Move to" menu. Every move goes through the normal status change (with its timeline entry).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api, type Application, type Status } from "../lib/api.ts";
import { STATUS_LABEL, daysSince } from "../lib/format.ts";
import { useToast } from "./Toast.tsx";
import { Card, EmptyState, ErrorState, STATUS_THEME, SkeletonRows, cx } from "./ui.tsx";

const COLUMNS: { key: string; label: string; statuses: Status[]; drop: Status }[] = [
  { key: "applied", label: "Applied", statuses: ["applied"], drop: "applied" },
  { key: "assessment", label: "Assessment", statuses: ["assessment"], drop: "assessment" },
  { key: "interview", label: "Interview", statuses: ["interview"], drop: "interview" },
  { key: "offer", label: "Offer", statuses: ["offer", "accepted"], drop: "offer" },
  { key: "closed", label: "Closed", statuses: ["rejected", "declined", "withdrawn"], drop: "rejected" },
];
const MOVES: Status[] = ["applied", "assessment", "interview", "offer", "accepted", "rejected", "declined", "withdrawn"];

async function loadAll(): Promise<Application[]> {
  const out: Application[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 6; i++) {
    const page = await api.listApplications({ status: "all", cursor });
    out.push(...page.items);
    if (!page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return out;
}

export function PipelineBoard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["applications", "board"], queryFn: loadAll });
  const [over, setOver] = useState<string | null>(null);
  const move = useMutation({
    mutationFn: (v: { id: number; status: Status }) => api.setStatus(v.id, v.status),
    onSuccess: (_r, v) => { qc.invalidateQueries({ queryKey: ["applications"] }); qc.invalidateQueries({ queryKey: ["summary"] }); toast({ text: `Moved to ${STATUS_LABEL[v.status]}` }); },
    onError: () => toast({ text: "Couldn’t move that" }),
  });
  if (q.isPending) return <SkeletonRows rows={4} label="Loading board" />;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  const apps = q.data ?? [];
  if (apps.length === 0) return <Card><EmptyState title="No applications yet">Add one, or mark a job as applied, and it appears here.</EmptyState></Card>;
  return (
    <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0" aria-label="Pipeline board">
      {COLUMNS.map((col) => {
        const items = apps.filter((a) => col.statuses.includes(a.status));
        return (
          <section
            key={col.key}
            aria-label={`${col.label} column`}
            onDragOver={(e) => { e.preventDefault(); setOver(col.key); }}
            onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
            onDrop={(e) => {
              e.preventDefault(); setOver(null);
              const id = Number(e.dataTransfer.getData("text/plain"));
              const a = apps.find((x) => x.id === id);
              if (a && !col.statuses.includes(a.status)) move.mutate({ id, status: col.drop });
            }}
            className={cx("flex w-[78vw] max-w-[260px] flex-none snap-start flex-col gap-2 rounded-xl border p-2 sm:w-[220px]", over === col.key ? "border-accent bg-accent-wash" : "border-line bg-sunken")}
          >
            <h2 className="m-0 flex items-center justify-between px-1 text-[13px] font-semibold">{col.label}<span className="text-[12px] font-normal text-muted tabular-nums">{items.length}</span></h2>
            {items.map((a) => (
              <article
                key={a.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/plain", String(a.id))}
                className={cx("flex cursor-grab flex-col gap-1 rounded-lg border-l-4 bg-surface p-2.5 shadow-[0_1px_0_var(--line)]", STATUS_THEME[a.status].stripe)}
              >
                <Link to={`/applications/${a.id}?status=all`} className="truncate text-[13.5px] font-semibold text-ink no-underline">{a.company}</Link>
                <span className="truncate text-[12px] text-muted">{a.role ?? "Role not set"}</span>
                <span className={cx("text-[11.5px]", a.stale ? "font-semibold text-amber-text" : "text-muted")}>{a.stale ? `${daysSince(a.last_event_at ?? a.applied_at)} days · follow up` : `${daysSince(a.last_event_at ?? a.applied_at)}d ago`}</span>
                <label className="sr-only" htmlFor={`mv-${a.id}`}>Move {a.company}</label>
                <select id={`mv-${a.id}`} value="" onChange={(e) => e.target.value && move.mutate({ id: a.id, status: e.target.value as Status })} className="h-7 rounded-md border border-line bg-bg px-1 text-[11.5px] text-ink-2">
                  <option value="">Move to…</option>
                  {MOVES.filter((s) => s !== a.status).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}
