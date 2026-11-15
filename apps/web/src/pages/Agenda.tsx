// Phase 6: tasks, interview agenda and the weekly review (spec section 21 amendment 2).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { Button, Card, ErrorState, Field, PageHeader, Select, SectionTitle, SkeletonRows } from "../components/ui.tsx";
import { useToast } from "../components/Toast.tsx";
import { api, type Task } from "../lib/api.ts";
import { dateInputToEpoch, formatDateTime, formatShort } from "../lib/format.ts";

const PRIORITY = ["", "High", "Normal", "Low"];

export function AgendaPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const agenda = useQuery({ queryKey: ["agenda"], queryFn: api.agenda });
  const weekly = useQuery({ queryKey: ["weekly"], queryFn: api.weekly });
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState("2");
  const [kind, setKind] = useState("task");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["agenda"] });
    qc.invalidateQueries({ queryKey: ["brief"] });
    qc.invalidateQueries({ queryKey: ["weekly"] });
  };
  const add = useMutation({
    mutationFn: () => api.createTask({ title: title.trim(), due_at: dateInputToEpoch(due), priority: Number(priority), kind }),
    onSuccess: () => { setTitle(""); setDue(""); refresh(); },
    onError: () => toast({ text: "Couldn’t add task" }),
  });
  const done = useMutation({ mutationFn: (t: Task) => api.patchTask(t.id, { done: true }), onSuccess: () => { refresh(); toast({ text: "Done" }); } });
  const remove = useMutation({ mutationFn: (t: Task) => api.deleteTask(t.id), onSuccess: refresh });

  const row = (t: Task) => (
    <li key={t.id} className="flex items-center gap-3 border-t border-line px-5 py-2.5">
      <button type="button" aria-label={`Complete ${t.title}`} onClick={() => done.mutate(t)} className="size-5 flex-none cursor-pointer rounded-full border-2 border-line-strong hover:border-accent" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{t.title}</span>
        <span className="text-[12px] text-muted">{t.kind !== "task" ? `${t.kind.replace("_", " ")} · ` : ""}{PRIORITY[t.priority]}{t.due_at ? ` · ${formatShort(t.due_at)}` : ""}</span>
      </span>
      <Button size="sm" variant="quiet" onClick={() => remove.mutate(t)}>Delete</Button>
    </li>
  );
  const section = (label: string, items: Task[]) => items.length > 0 && (
    <Card className="overflow-hidden" key={label}><SectionTitle>{label}</SectionTitle><ul className="m-0 list-none p-0">{items.map(row)}</ul></Card>
  );
  const a = agenda.data;
  const w = weekly.data;

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4">
      <PageHeader title="Agenda" subtitle="Your tasks, calls and interviews in one place." />
      <Card className="flex flex-col gap-3 p-4">
        <form className="grid gap-3 sm:grid-cols-[1fr_150px_110px_110px_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); if (title.trim()) add.mutate(); }}>
          <Field label="New task" value={title} maxLength={300} placeholder="Call recruiter, send follow-up…" onChange={(e) => setTitle(e.target.value)} />
          <Field label="Due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="1">High</option><option value="2">Normal</option><option value="3">Low</option></Select>
          <Select label="Type" value={kind} onChange={(e) => setKind(e.target.value)}><option value="task">Task</option><option value="call">Call</option><option value="interview_prep">Prep</option></Select>
          <Button variant="primary" type="submit" disabled={!title.trim() || add.isPending}>Add</Button>
        </form>
      </Card>

      {agenda.isPending ? <SkeletonRows rows={3} label="Loading agenda" /> : agenda.isError || !a ? <ErrorState onRetry={() => agenda.refetch()} /> : (
        <>
          {a.interviews.length > 0 && (
            <Card className="overflow-hidden border-accent/40"><SectionTitle>Interviews this week</SectionTitle>
              <ul className="m-0 list-none p-0">{a.interviews.map((i) => (
                <li key={i.id} className="border-t border-line px-5 py-2.5"><Link to={`/applications/${i.app_id}`} className="font-medium text-ink no-underline">{i.company}</Link> <span className="text-[12.5px] text-muted">· {formatDateTime(i.start_utc)}</span></li>
              ))}</ul></Card>
          )}
          {section("Overdue", a.overdue)}
          {section("Today", a.today)}
          {section("Next 7 days", a.upcoming)}
          {section("Someday", a.someday)}
          {a.overdue.length + a.today.length + a.upcoming.length + a.someday.length + a.interviews.length === 0 && <p className="m-0 text-center text-[13px] text-muted">Nothing scheduled. Add a task above.</p>}
        </>
      )}

      {w && (
        <Card className="p-5">
          <h2 className="m-0 mb-1 text-[15px] font-semibold">{w.is_sunday ? "Weekly summary (it’s Sunday)" : "Last 7 days"}</h2>
          <p className="m-0 mb-3 text-[13.5px] text-ink-2">{w.focus}</p>
          <dl className="m-0 grid grid-cols-2 gap-3 tabular-nums sm:grid-cols-4">
            {([
              ["Applications", w.applications_added], ["Replies (28 days)", w.response_rate === null ? "—" : `${w.response_rate}%`], ["Interviews booked", w.interviews_booked], ["Interviews done", w.interviews_done],
              ["Jobs from alerts", w.jobs_from_alerts], ["Rejections", w.rejections], ["Offers", w.offers], ["Status changes", w.status_changes],
              ["Tasks done", w.tasks_done], ["Tasks open", w.tasks_open], ["Notes", w.notes_added], ["Check-ins", w.checkins_done],
            ] as const).map(([l, n]) => (
              <div key={l}><dt className="text-[12px] text-muted">{l}</dt><dd className="m-0 text-[20px] font-semibold">{n}</dd></div>
            ))}
          </dl>
        </Card>
      )}
    </div>
  );
}
