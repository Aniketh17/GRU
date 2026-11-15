// Phase 3: Morning brief card + skippable daily check-in wizard (spec section 11).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api.ts";
import { formatDateTime, formatRelative, formatTime } from "../lib/format.ts";
import { Modal } from "./Dialog.tsx";
import { useToast } from "./Toast.tsx";
import { Button, Card, Pill, SectionTitle, TextArea } from "./ui.tsx";

export function BriefCard({ onAdd }: { onAdd: () => void }) {
  const brief = useQuery({ queryKey: ["brief"], queryFn: api.brief });
  const checkin = useQuery({ queryKey: ["checkin"], queryFn: api.checkin });
  const [open, setOpen] = useState(false);
  const b = brief.data;
  const done = checkin.data?.status === "completed";
  const skipped = checkin.data?.status === "skipped";
  const focus = checkin.data?.answers?.today_focus;
  if (!b) return null;
  const proposed = b.interviews_proposed ?? [];
  const dls = b.deadlines_soon ?? [];
  const quiet = dls.length === 0 && proposed.length === 0 && b.review_count === 0 && b.interviews_upcoming.length === 0 && b.missing_debriefs.length === 0 && b.tasks_due === 0 && b.jobs.queue_count === 0;

  return (
    <Card className="overflow-hidden border-accent/40">
      <SectionTitle aside={<span className="text-[12.5px] text-muted">{b.health.summary}</span>}>Morning brief</SectionTitle>
      <ul className="m-0 flex list-none flex-col gap-2 px-5 pb-3 text-[13.5px]">
        {b.review_count > 0 && (
          <li><Link to="/review" className="font-medium text-accent-text">{b.review_count} email{b.review_count === 1 ? "" : "s"} to review →</Link></li>
        )}
        {dls.map((d) => (
          <li key={`dl${d.id}`}>
            <Link to="/calendar" className="font-medium text-amber-text">{{ assessment: "Assessment due", offer_reply: "Reply to offer", interview_reply: "Confirm interview", other: "Action needed" }[d.kind] ?? "Deadline"}{d.company ? ` · ${d.company}` : ""}</Link>
            <span className="text-muted"> · {formatDateTime(d.due_at)}</span>
          </li>
        ))}
        {proposed.map((i) => (
          <li key={`p${i.id}`}>
            <Link to={`/applications/${i.app_id}`} className="font-medium text-accent-text">Confirm interview · {i.company}</Link>
            <span className="text-muted"> · found in an email{i.start_utc ? `: ${formatDateTime(i.start_utc)}` : ", time not found"}</span>
          </li>
        ))}
        {b.interviews_upcoming.map((i) => (
          <li key={i.id}>
            <Link to={`/applications/${i.app_id}`} className="font-medium text-ink">Interview · {i.company}</Link>
            <span className="text-muted"> · {formatRelative(i.at)} {formatTime(i.at)}{i.prep_ready ? "" : " · prep not started"}</span>
          </li>
        ))}
        {b.missing_debriefs.map((i) => (
          <li key={`d${i.id}`}>
            <Link to={`/applications/${i.app_id}`} className="font-medium text-ink">Debrief missing · {i.company}</Link>
          </li>
        ))}
        {b.jobs.queue_count > 0 && (
          <li>
            <Link to="/jobs" className="font-medium text-accent-text">
              {b.jobs.queue_count} job{b.jobs.queue_count === 1 ? "" : "s"} to apply for{b.jobs.new_count > 0 ? ` (${b.jobs.new_count} new)` : ""} →
            </Link>
            {b.jobs.top[0] && <span className="text-muted"> · top: {b.jobs.top[0].title} ({b.jobs.top[0].score})</span>}
            {b.jobs.closing_soon > 0 && <span className="text-amber-text"> · {b.jobs.closing_soon} closing soon</span>}
          </li>
        )}
        {b.tasks_due > 0 && <li><Link to="/agenda" className="font-medium text-accent-text">{b.tasks_due} task{b.tasks_due === 1 ? "" : "s"} due →</Link></li>}
        {b.follow_ups.length > 0 && <li className="text-muted">{b.follow_ups.length} follow-up{b.follow_ups.length === 1 ? "" : "s"} due.</li>}
        {quiet && b.follow_ups.length === 0 && <li className="text-muted">All clear. Nothing needs you right now.</li>}
        {focus && <li><Pill tone="accent">Today’s focus</Pill> <span className="text-ink">{focus}</span></li>}
      </ul>
      <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
        <span className="text-[12.5px] text-muted">{done ? "Check-in done for today." : skipped ? "Check-in skipped today." : "A 1-minute check-in keeps your pipeline accurate."}</span>
        <div className="flex flex-none gap-2">
          <Button size="sm" onClick={() => window.dispatchEvent(new CustomEvent("gru:voice", { detail: "brief" }))}>Read aloud</Button>
        {!done && <Button size="sm" variant="primary" onClick={() => setOpen(true)}>{skipped ? "Check in anyway" : "Start check-in"}</Button>}
        </div>
      </div>
      {open && checkin.data && <CheckinWizard onClose={() => setOpen(false)} onAdd={onAdd} />}
    </Card>
  );
}

function CheckinWizard({ onClose, onAdd }: { onClose: () => void; onAdd: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ["checkin"], queryFn: api.checkin });
  const [i, setI] = useState(0);
  const [focus, setFocus] = useState("");
  const [off, setOff] = useState<boolean | undefined>();

  const steps: string[] = [];
  if ((data?.review_prompts.length ?? 0) > 0) steps.push("review");
  steps.push("unrecorded");
  if ((data?.interviews_upcoming.length ?? 0) + (data?.missing_debriefs.length ?? 0) > 0) steps.push("interview");
  steps.push("focus");

  const save = useMutation({
    mutationFn: (status: "completed" | "skipped") =>
      api.saveCheckin({ status, ...(focus.trim() ? { today_focus: focus.trim() } : {}), ...(off !== undefined ? { applied_off_email: off } : {}) }),
    onSuccess: (_d, status) => {
      qc.invalidateQueries({ queryKey: ["checkin"] });
      toast({ text: status === "completed" ? "Check-in saved" : "Check-in skipped" });
      onClose();
    },
    onError: () => toast({ text: "Couldn’t save check-in" }),
  });

  const step = steps[i] ?? "focus";
  const last = i >= steps.length - 1;
  const next = () => (last ? save.mutate("completed") : setI(i + 1));

  return (
    <Modal open onClose={onClose} title={`Daily check-in · ${i + 1} of ${steps.length}`}>
      {step === "review" && (
        <>
          <p className="m-0 text-ink-2">{data?.review_prompts.length} email{data?.review_prompts.length === 1 ? "" : "s"} still need a decision.</p>
          <Link to="/review" onClick={onClose} className="font-medium text-accent-text">Open the review queue →</Link>
        </>
      )}
      {step === "unrecorded" && (
        <>
          <p className="m-0 text-ink-2">Did you apply anywhere yesterday that didn’t come through email?</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => { setOff(true); onClose(); onAdd(); }}>Yes, add it</Button>
            <Button variant={off === false ? "primary" : "secondary"} onClick={() => { setOff(false); next(); }}>No</Button>
          </div>
        </>
      )}
      {step === "interview" && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-ink-2">
          {data?.interviews_upcoming.map((x) => <li key={x.id}>Interview with <Link to={`/applications/${x.app_id}`} onClick={onClose} className="font-medium text-ink">{x.company}</Link> {formatRelative(x.at)}. Ready?</li>)}
          {data?.missing_debriefs.map((x) => <li key={`d${x.id}`}>How did it go with <Link to={`/applications/${x.app_id}`} onClick={onClose} className="font-medium text-ink">{x.company}</Link>? Note it down.</li>)}
        </ul>
      )}
      {step === "focus" && (
        <TextArea label="What is the one thing that must happen today?" value={focus} maxLength={280} rows={3} onChange={(e) => setFocus(e.target.value)} />
      )}
      <div className="flex items-center justify-between gap-2">
        <Button onClick={() => save.mutate("skipped")} disabled={save.isPending}>Skip today</Button>
        {step !== "unrecorded" && <Button variant="primary" onClick={next} disabled={save.isPending}>{last ? "Finish" : "Next"}</Button>}
      </div>
    </Modal>
  );
}
