// Phase 4: interviews on an application: schedule, prep notes, debrief (spec sections 11, 12).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type DebriefInput, type Interview } from "../lib/api.ts";
import { epochToDateTimeInput, formatDateTime, formatRelative, localDateTimeToEpoch } from "../lib/format.ts";
import { Modal } from "./Dialog.tsx";
import { useToast } from "./Toast.tsx";
import { Button, Field, Pill, Select, TextArea } from "./ui.tsx";

const FORMATS = [["video", "Video call"], ["phone", "Phone"], ["onsite", "On-site"], ["assessment", "Assessment"]] as const;

const PREP_CHECKLIST = [
  "Re-read the job description and your application",
  "Prepare 3 stories (STAR) that match their top requirements",
  "Research the company: product, team, recent news",
  "Prepare 3 questions to ask them",
  "Test camera, mic and link (or plan your route)",
];

export function InterviewPanel({ appId, onChanged }: { appId: number; onChanged: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["interviews", appId], queryFn: () => api.interviews(appId) });
  const [scheduling, setScheduling] = useState(false);
  const [prepFor, setPrepFor] = useState<Interview | null>(null);
  const [debriefFor, setDebriefFor] = useState<Interview | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["interviews"] });
    qc.invalidateQueries({ queryKey: ["brief"] });
    qc.invalidateQueries({ queryKey: ["agenda"] });
    onChanged();
  };
  const cancel = useMutation({
    mutationFn: (id: number) => api.patchInterview(id, { state: "cancelled" }),
    onSuccess: () => { refresh(); toast({ text: "Interview cancelled" }); },
  });
  const items = (q.data?.items ?? []).filter((i) => i.state !== "cancelled");

  return (
    <div className="flex flex-col gap-2.5 border-t border-line px-5 py-4">
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-[13.5px] font-semibold">Interviews</h3>
        <Button size="sm" onClick={() => setScheduling(true)}>Add interview</Button>
      </div>
      {items.length === 0 && <p className="m-0 text-[13px] text-muted">No interviews yet. Add one when you have a time, and GRU will remind you 24 h and 2 h before.</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((i) => {
          const past = i.start_utc !== null && i.start_utc < Date.now() / 1000;
          return (
            <li key={i.id} className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-sunken px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{i.start_utc ? formatDateTime(i.start_utc) : "Time not set"} <span className="text-[12.5px] text-muted">· {i.start_utc ? formatRelative(i.start_utc) : ""}</span></span>
                <span className="flex gap-1.5">
                  <Pill tone="neutral">{FORMATS.find((f) => f[0] === i.format)?.[1] ?? "Video call"}</Pill>
                  {i.debrief ? <Pill tone="accent">Debriefed · {i.rating}/5</Pill> : past ? <Pill tone="amber">Debrief missing</Pill> : null}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setPrepFor(i)}>{i.prep ? "Prep notes" : "Prep"}</Button>
                <Button size="sm" variant={past && !i.debrief ? "primary" : "secondary"} onClick={() => setDebriefFor(i)}>{i.debrief ? "View debrief" : "Debrief"}</Button>
                {!past && <Button size="sm" variant="quiet" onClick={() => cancel.mutate(i.id)}>Cancel</Button>}
              </div>
            </li>
          );
        })}
      </ul>
      {scheduling && <ScheduleModal appId={appId} onClose={() => setScheduling(false)} onDone={refresh} />}
      {prepFor && <PrepModal i={prepFor} onClose={() => setPrepFor(null)} onDone={refresh} />}
      {debriefFor && <DebriefModal i={debriefFor} onClose={() => setDebriefFor(null)} onDone={refresh} />}
    </div>
  );
}

function ScheduleModal({ appId, onClose, onDone }: { appId: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [when, setWhen] = useState(epochToDateTimeInput(Math.floor(Date.now() / 1000) + 86400));
  const [format, setFormat] = useState("video");
  const save = useMutation({
    mutationFn: () => api.createInterview({ app_id: appId, start_utc: localDateTimeToEpoch(when) ?? 0, format }),
    onSuccess: () => { toast({ text: "Interview added" }); onDone(); onClose(); },
    onError: () => toast({ text: "Couldn’t add interview" }),
  });
  return (
    <Modal open onClose={onClose} title="Add interview">
      <Field label="Date and time (Auckland)" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      <Select label="Format" value={format} onChange={(e) => setFormat(e.target.value)}>
        {FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
      <Button variant="primary" disabled={!localDateTimeToEpoch(when) || save.isPending} onClick={() => save.mutate()}>Save interview</Button>
    </Modal>
  );
}

function PrepModal({ i, onClose, onDone }: { i: Interview; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [text, setText] = useState(i.prep ?? "");
  const save = useMutation({
    mutationFn: () => api.patchInterview(i.id, { prep: text || null }),
    onSuccess: () => { toast({ text: "Prep notes saved" }); onDone(); onClose(); },
  });
  return (
    <Modal open onClose={onClose} title={`Prep · ${i.company}`} wide>
      <ul className="m-0 list-disc pl-5 text-[13.5px] text-ink-2">{PREP_CHECKLIST.map((c) => <li key={c}>{c}</li>)}</ul>
      <TextArea label="Your prep notes · encrypted" rows={7} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} />
      <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>Save prep</Button>
    </Modal>
  );
}

function DebriefModal({ i, onClose, onDone }: { i: Interview; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const d = i.debrief ?? {};
  const [f, setF] = useState<DebriefInput>({
    rating: i.rating ?? 3, questions: d.questions ?? "", went_well: d.went_well ?? "", improve: d.improve ?? "",
    followup_sent: i.followup_sent, next_step: d.next_step ?? "", next_date: d.next_date ?? null,
  });
  const set = <K extends keyof DebriefInput>(k: K, v: DebriefInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => api.debrief(i.id, f),
    onSuccess: () => { toast({ text: "Debrief saved" }); onDone(); onClose(); },
    onError: () => toast({ text: "Couldn’t save debrief" }),
  });
  return (
    <Modal open onClose={onClose} title={`Debrief · ${i.company}`} wide>
      <Select label="How did it go? (1–5)" value={f.rating} onChange={(e) => set("rating", Number(e.target.value))}>
        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
      </Select>
      <TextArea label="Questions they asked" rows={2} value={f.questions} onChange={(e) => set("questions", e.target.value)} />
      <TextArea label="What went well" rows={2} value={f.went_well} onChange={(e) => set("went_well", e.target.value)} />
      <TextArea label="What to improve" rows={2} value={f.improve} onChange={(e) => set("improve", e.target.value)} />
      <Field label="Next step" value={f.next_step} maxLength={500} onChange={(e) => set("next_step", e.target.value)} />
      <Field label="Next step date" type="date" value={f.next_date ?? ""} onChange={(e) => set("next_date", e.target.value || null)} />
      <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={f.followup_sent} onChange={(e) => set("followup_sent", e.target.checked)} /> Thank-you / follow-up sent</label>
      <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>Save debrief</Button>
    </Modal>
  );
}
