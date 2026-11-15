// Calendar: everything with a date in one place (interviews + meeting links, deadlines found in emails, tasks, job closing dates),
// plus a private feed to subscribe to from Apple / Google Calendar.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Modal } from "../components/Dialog.tsx";
import { ChevronLeft } from "../components/Icons.tsx";
import { useToast } from "../components/Toast.tsx";
import { Button, Card, ErrorState, Field, PageHeader, Pill, Select, SkeletonRows, cx } from "../components/ui.tsx";
import { api, type CalendarItem } from "../lib/api.ts";
import { dateInputToEpoch, formatTime, localDateTimeToEpoch, localDay } from "../lib/format.ts";

const DOT: Record<CalendarItem["kind"], string> = { interview: "bg-accent", deadline: "bg-amber", task: "bg-line-strong", closing: "bg-blue" };
const KIND_LABEL: Record<CalendarItem["kind"], string> = { interview: "Interview", deadline: "Deadline", task: "Task", closing: "Closing" };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const monthLabel = (y: number, m: number) => new Intl.DateTimeFormat("en-NZ", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m, 1)));
const dayLabel = (d: string) => new Intl.DateTimeFormat("en-NZ", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

export function CalendarPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const today = localDay(Math.floor(Date.now() / 1000));
  const [ty, tm] = [Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1];
  const [ym, setYm] = useState({ y: ty, m: tm });
  const [selected, setSelected] = useState(today);
  const [adding, setAdding] = useState(false);

  const days = useMemo(() => {
    const first = Date.UTC(ym.y, ym.m, 1);
    const dow = (new Date(first).getUTCDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, i) => new Date(first + (i - dow) * 86400000).toISOString().slice(0, 10));
  }, [ym]);
  const from = localDateTimeToEpoch(`${days[0]}T00:00`) ?? 0;
  const to = (localDateTimeToEpoch(`${days[41]}T23:59`) ?? 0) + 60;

  const q = useQuery({ queryKey: ["calendar", from, to], queryFn: () => api.calendar(from, to) });
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const it of q.data?.items ?? []) {
      const d = localDay(it.start);
      m.set(d, [...(m.get(d) ?? []), it]);
    }
    return m;
  }, [q.data]);

  const refresh = () => { qc.invalidateQueries({ queryKey: ["calendar"] }); qc.invalidateQueries({ queryKey: ["brief"] }); qc.invalidateQueries({ queryKey: ["agenda"] }); };
  const doneDeadline = useMutation({ mutationFn: (v: { id: number; done: boolean }) => api.setDeadlineDone(v.id, v.done), onSuccess: refresh });
  const doneTask = useMutation({ mutationFn: (id: number) => api.patchTask(id, { done: true }), onSuccess: () => { refresh(); toast({ text: "Done" }); } });
  const step = (n: number) => setYm((c) => { const d = new Date(Date.UTC(c.y, c.m + n, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; });
  const list = (byDay.get(selected) ?? []).slice().sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.start - b.start);

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4">
      <PageHeader
        title="Calendar"
        subtitle="Interviews, deadlines from your emails, tasks and closing dates, with meeting links."
        actions={<><Button size="sm" onClick={() => { setYm({ y: ty, m: tm }); setSelected(today); }}>Today</Button><Button size="sm" variant="primary" onClick={() => setAdding(true)}>Add event</Button></>}
      />
      <Card className="p-3 sm:p-4">
        <div className="mb-2 flex items-center justify-between">
          <Button size="sm" variant="quiet" aria-label="Previous month" onClick={() => step(-1)}><ChevronLeft size={16} /></Button>
          <h2 className="m-0 text-[15px] font-semibold">{monthLabel(ym.y, ym.m)}</h2>
          <Button size="sm" variant="quiet" aria-label="Next month" onClick={() => step(1)}><ChevronLeft size={16} className="rotate-180" /></Button>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-muted">{WEEKDAYS.map((w) => <span key={w} className="py-1">{w}</span>)}</div>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-line">
          {days.map((d) => {
            const items = byDay.get(d) ?? [];
            const inMonth = Number(d.slice(5, 7)) - 1 === ym.m;
            return (
              <button
                key={d}
                type="button"
                aria-label={`${dayLabel(d)}${items.length ? `, ${items.length} item${items.length === 1 ? "" : "s"}` : ""}`}
                aria-pressed={d === selected}
                onClick={() => setSelected(d)}
                className={cx("flex min-h-[52px] cursor-pointer flex-col items-center gap-1 bg-surface px-1 py-1.5 sm:min-h-[64px]", !inMonth && "opacity-45", d === selected && "outline-2 outline-accent -outline-offset-2")}
              >
                <span className={cx("grid size-6 place-items-center rounded-full text-[12.5px] tabular-nums", d === today && "bg-accent font-semibold text-accent-ink")}>{Number(d.slice(8))}</span>
                <span className="flex flex-wrap justify-center gap-0.5">
                  {items.slice(0, 4).map((it) => <span key={it.key} className={cx("size-1.5 rounded-full", DOT[it.kind], it.state === "done" && "opacity-40")} />)}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4 pb-2"><h2 className="m-0 text-[15px] font-semibold">{dayLabel(selected)}</h2><Link to="/agenda" className="text-[13px] font-medium text-accent-text no-underline">Task list →</Link></div>
        {q.isPending ? <SkeletonRows rows={2} label="Loading calendar" /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : list.length === 0 ? (
          <p className="m-0 px-5 pb-4 text-[13px] text-muted">Nothing on this day.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {list.map((it) => (
              <li key={it.key} className="flex flex-col gap-2 border-t border-line px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={cx("m-0 font-medium", it.state === "done" && "text-muted line-through")}>{it.title}</p>
                    <p className="m-0 text-[12.5px] text-muted">{it.all_day ? "All day" : formatTime(it.start)}{it.state === "proposed" ? " · found in an email, please confirm" : ""}</p>
                  </div>
                  <Pill tone={it.kind === "interview" ? "accent" : it.kind === "deadline" ? "amber" : "neutral"}>{KIND_LABEL[it.kind]}</Pill>
                </div>
                <div className="flex flex-wrap gap-2">
                  {it.link && <a href={it.link.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-[10px] bg-accent px-3 text-[12.5px] font-semibold text-accent-ink no-underline">Join {it.link.kind} ↗</a>}
                  {it.app_id && <Link to={`/applications/${it.app_id}`} className="inline-flex h-8 items-center rounded-[10px] border border-line px-3 text-[12.5px] font-medium text-ink no-underline hover:bg-sunken">Open application</Link>}
                  {it.job_id && <Link to="/jobs" className="inline-flex h-8 items-center rounded-[10px] border border-line px-3 text-[12.5px] font-medium text-ink no-underline hover:bg-sunken">Open jobs</Link>}
                  {it.kind === "deadline" && <Button size="sm" onClick={() => doneDeadline.mutate({ id: it.ref_id, done: it.state !== "done" })}>{it.state === "done" ? "Undo done" : "Mark done"}</Button>}
                  {it.kind === "task" && it.state !== "done" && <Button size="sm" onClick={() => doneTask.mutate(it.ref_id)}>Done</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <FeedCard />
      {adding && <AddEvent defaultDate={selected} onClose={() => setAdding(false)} onDone={refresh} />}
    </div>
  );
}

function FeedCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const feed = useQuery({ queryKey: ["calendar-feed"], queryFn: api.calendarFeed });
  const reset = useMutation({ mutationFn: api.resetCalendarFeed, onSuccess: (d) => { qc.setQueryData(["calendar-feed"], d); toast({ text: "New link created. The old one no longer works." }); } });
  const url = feed.data?.url ?? "";
  return (
    <Card className="flex flex-col gap-3 p-5" aria-labelledby="cal-feed">
      <div>
        <h2 id="cal-feed" className="m-0 text-[15px] font-semibold">Show these in your phone’s calendar</h2>
        <p className="m-0 text-[12.5px] text-muted">A private link that Apple or Google Calendar can subscribe to, so interviews (with their meeting links), deadlines and tasks appear alongside everything else and stay up to date. GRU never gets access to your calendar.</p>
      </div>
      {url && (
        <>
          <div className="flex flex-wrap gap-2">
            <a href={url.replace(/^https?:/, "webcal:")} className="inline-flex h-9 items-center rounded-[10px] bg-accent px-3.5 text-[13px] font-semibold text-accent-ink no-underline">Subscribe in Apple Calendar</a>
            <Button onClick={() => { void navigator.clipboard?.writeText(url); toast({ text: "Link copied. In Google Calendar: Add calendar → From URL." }); }}>Copy link for Google Calendar</Button>
          </div>
          <p className="m-0 text-[12px] break-all text-muted">{url}</p>
        </>
      )}
      <p className="m-0 text-[12px] text-muted">Anyone with this link can see your event titles, so keep it private. Your calendar provider fetches it from its servers, so company names and meeting links pass through them. You can create a new link at any time.</p>
      <div><Button size="sm" variant="quiet" onClick={() => reset.mutate()} disabled={reset.isPending}>Create a new link (disables the old one)</Button></div>
    </Card>
  );
}

function AddEvent({ defaultDate, onClose, onDone }: { defaultDate: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("");
  const [kind, setKind] = useState("task");
  const save = useMutation({
    mutationFn: () => api.createTask({ title: title.trim(), due_at: time ? localDateTimeToEpoch(`${date}T${time}`) : dateInputToEpoch(date), kind }),
    onSuccess: () => { toast({ text: "Added to your calendar" }); onDone(); onClose(); },
    onError: () => toast({ text: "Couldn’t add the event" }),
  });
  return (
    <Modal open onClose={onClose} title="Add event">
      <Field label="What is it?" value={title} maxLength={300} placeholder="Call recruiter, career fair, send follow-up…" onChange={(e) => setTitle(e.target.value)} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Field label="Time (optional)" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </div>
      <Select label="Type" value={kind} onChange={(e) => setKind(e.target.value)}><option value="task">Task</option><option value="call">Call</option><option value="interview_prep">Interview prep</option></Select>
      <Button variant="primary" disabled={!title.trim() || !date || save.isPending} onClick={() => save.mutate()}>Add</Button>
    </Modal>
  );
}
