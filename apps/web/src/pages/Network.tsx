// Network (Revamp 3E): build relationships before you need them. Companies to learn about, people to ask about their work,
// curiosity-first drafts, follow-up reminders and weekly goals. GRU never contacts anyone: you do, GRU keeps track.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Modal } from "../components/Dialog.tsx";
import { PlusIcon } from "../components/Icons.tsx";
import { useToast } from "../components/Toast.tsx";
import { Button, Card, EmptyState, Field, PageHeader, Pill, Select, SkeletonRows, TextArea, cx } from "../components/ui.tsx";
import { api, type NetCompany, type NetPerson } from "../lib/api.ts";
import { formatRelative, formatShort } from "../lib/format.ts";

const CO_STATUS: [string, string][] = [["not_contacted", "Not contacted"], ["researching", "Researching"], ["contacted", "Contacted"], ["conversation", "In conversation"], ["referral", "Referral"], ["applied", "Applied"]];
const STAGES: [string, string][] = [["to_reach", "To reach out"], ["drafted", "Message drafted"], ["sent", "Sent"], ["replied", "Replied"], ["call_booked", "Call booked"], ["call_done", "Call done"], ["thanked", "Thank-you sent"]];
const label = (list: [string, string][], k: string): string => list.find(([x]) => x === k)?.[1] ?? k;
const TABS = [["week", "This week"], ["companies", "Companies"], ["people", "People"]] as const;
type Tab = (typeof TABS)[number][0];

export function NetworkPage() {
  const [tab, setTab] = useState<Tab>("week");
  const [personId, setPersonId] = useState<number | null>(null);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const p = Number(params.get("person"));
    if (p > 0) { setPersonId(p); setTab("people"); const rest = new URLSearchParams(params); rest.delete("person"); setParams(rest, { replace: true }); }
  }, [params, setParams]);
  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4">
      <PageHeader title="Network" subtitle="Most internships come from people, not job boards. Learn about 100 companies, talk to the people doing the work, and ask about their work, never for a job. GRU keeps track; you do the reaching out." />
      <div role="tablist" aria-label="Network sections" className="flex gap-1 border-b border-line">
        {TABS.map(([k, name]) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cx("-mb-px cursor-pointer border-b-2 px-3 py-2 text-[13.5px]", tab === k ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:text-ink")}>{name}</button>
        ))}
      </div>
      {tab === "week" && <Week onOpen={setPersonId} />}
      {tab === "companies" && <Companies onOpenPerson={setPersonId} />}
      {tab === "people" && <People onOpen={setPersonId} />}
      {personId !== null && <PersonDialog id={personId} onClose={() => setPersonId(null)} />}
    </div>
  );
}

function Meter({ name, value, goal }: { name: string; value: number; goal: number }) {
  const pct = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-[13px]"><span>{name}</span><span className="tabular-nums"><strong>{value}</strong> / {goal}</span></div>
      <span className="h-2 overflow-hidden rounded-sm bg-track"><span className={cx("block h-2", value >= goal && goal > 0 ? "bg-green" : "bg-accent")} style={{ width: `${pct}%` }} /></span>
    </div>
  );
}

function Week({ onOpen }: { onOpen: (id: number) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["net", "overview"], queryFn: api.netOverview });
  const [goals, setGoals] = useState<{ outreach: number; conversations: number } | null>(null);
  const save = useMutation({ mutationFn: api.netGoals, onSuccess: () => { setGoals(null); qc.invalidateQueries({ queryKey: ["net"] }); toast({ text: "Goals saved" }); } });
  if (q.isPending) return <SkeletonRows rows={3} label="Loading" />;
  const o = q.data;
  if (!o) return <Card className="p-4 text-[13px] text-muted">Couldn’t load your network.</Card>;
  const g = goals ?? o.week.goals;
  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-[14px] font-semibold">This week</h2>
          {o.week.streak > 0 && <Pill tone="accent">{o.week.streak}-week streak</Pill>}
        </div>
        <Meter name="New people reached out to" value={o.week.outreach} goal={o.week.goals.outreach} />
        <Meter name="Conversations had" value={o.week.conversations} goal={o.week.goals.conversations} />
        <p className="m-0 text-[12.5px] text-muted">{o.week.thanks} thank-you{o.week.thanks === 1 ? "" : "s"} sent. Always thank people after a conversation: it’s what makes them remember you.</p>
        <details>
          <summary className="cursor-pointer text-[12.5px] text-accent-text">Change weekly goals</summary>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Field label="Outreach per week" type="number" min={0} max={50} value={g.outreach} onChange={(e) => setGoals({ ...g, outreach: Number(e.target.value) })} />
            <Field label="Conversations per week" type="number" min={0} max={20} value={g.conversations} onChange={(e) => setGoals({ ...g, conversations: Number(e.target.value) })} />
          </div>
          <Button size="sm" className="mt-2" disabled={!goals} onClick={() => goals && save.mutate(goals)}>Save goals</Button>
        </details>
      </Card>

      <Card className="flex flex-col gap-2 p-4">
        <h2 className="m-0 text-[14px] font-semibold">Follow-ups due</h2>
        {o.due.length === 0 ? <p className="m-0 text-[13px] text-muted">Nothing due. Reach out to someone new, or add companies and people to get going.</p> : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {o.due.map((p) => (
              <li key={p.id}><button type="button" onClick={() => onOpen(p.id)} className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg bg-sunken px-3 py-2 text-left text-[13px]">
                <span><strong>{p.name}</strong>{p.company ? ` · ${p.company}` : ""}<span className="block text-[12px] text-muted">{label(STAGES, p.stage)} · due {formatShort(p.next_followup_at)}</span></span>
                <span className="text-accent-text">Open</span>
              </button></li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-2 p-4">
        <h2 className="m-0 text-[14px] font-semibold">Your 100 companies</h2>
        <Meter name="Companies on your list" value={o.companies.total} goal={o.companies.target} />
        <p className="m-0 text-[12.5px] text-muted">{o.people.total} {o.people.total === 1 ? "person" : "people"} tracked. A good rhythm: pick a company, read what they do, find two people who do the work you want, and ask each about their work.</p>
      </Card>
    </div>
  );
}

function Companies({ onOpenPerson }: { onOpenPerson: (id: number) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["net", "companies"], queryFn: api.netCompanies });
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<NetCompany | null>(null);
  const [starter, setStarter] = useState(false);
  const done = () => qc.invalidateQueries({ queryKey: ["net"] });
  const imp = useMutation({ mutationFn: api.netImportSeen, onSuccess: (r) => { done(); toast({ text: r.added ? `Added ${r.added} companies from your applications and job alerts` : "Nothing new to add" }); } });
  const set = useMutation({ mutationFn: (v: { id: number; status: string }) => api.netPatchCompany(v.id, { status: v.status }), onSuccess: done });
  const items = q.data?.items ?? [];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" className="rounded-full" onClick={() => setAdding(true)}><PlusIcon size={14} />Add companies</Button>
        <Button size="sm" onClick={() => setStarter(true)}>Starter ideas</Button>
        <Button size="sm" onClick={() => imp.mutate()} disabled={imp.isPending}>Import from my applications and alerts</Button>
      </div>
      {q.isPending ? <SkeletonRows rows={3} label="Loading" /> : items.length === 0 ? (
        <Card><EmptyState title="Start your list of 100">Add companies you’d love to work at, import the ones you’ve already seen, or start from the ideas list.</EmptyState></Card>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {items.map((c) => (
            <li key={c.id}>
              <Card className="flex items-center justify-between gap-3 p-3">
                <button type="button" onClick={() => setOpen(c)} className="min-w-0 cursor-pointer text-left">
                  <span className="block truncate text-[14.5px] font-semibold">{c.name}</span>
                  <span className="block text-[12px] text-muted">{c.people} {c.people === 1 ? "person" : "people"}{c.source !== "manual" ? ` · ${c.source === "starter" ? "idea" : c.source === "application" ? "applied" : "seen hiring"}` : ""}</span>
                </button>
                <select aria-label={`Status for ${c.name}`} value={c.status} onChange={(e) => set.mutate({ id: c.id, status: e.target.value })} className="h-8 rounded-lg border border-line bg-surface px-2 text-[12.5px]">
                  {CO_STATUS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {adding && <AddCompanies onClose={() => setAdding(false)} onDone={done} />}
      {starter && <Starter existing={items.map((c) => c.name.toLowerCase())} onClose={() => setStarter(false)} onDone={done} />}
      {open && <CompanyDialog company={open} onClose={() => setOpen(null)} onOpenPerson={(id) => { setOpen(null); onOpenPerson(id); }} />}
    </div>
  );
}

function AddCompanies({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const names = [...new Set(text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean))];
  const save = useMutation({ mutationFn: () => api.netBulk(names), onSuccess: (r) => { toast({ text: `Added ${r.added}` }); onDone(); onClose(); } });
  return (
    <Modal open onClose={onClose} title="Add companies">
      <TextArea label="One company per line (or comma-separated)" rows={7} value={text} onChange={(e) => setText(e.target.value)} />
      <Button variant="primary" disabled={names.length === 0 || save.isPending} onClick={() => save.mutate()}>Add {names.length || ""} {names.length === 1 ? "company" : "companies"}</Button>
    </Modal>
  );
}

function Starter({ existing, onClose, onDone }: { existing: string[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const q = useQuery({ queryKey: ["net", "starter"], queryFn: api.netStarter });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const save = useMutation({ mutationFn: () => api.netBulk([...picked], "starter"), onSuccess: (r) => { toast({ text: `Added ${r.added}` }); onDone(); onClose(); } });
  const toggle = (n: string) => setPicked((s) => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x; });
  return (
    <Modal open onClose={onClose} title="Starter ideas">
      <p className="m-0 text-[12.5px] text-muted">{q.data?.note ?? "Loading…"} Check each one is a fit and still active before reaching out.</p>
      <ul className="m-0 grid max-h-[40dvh] list-none grid-cols-2 gap-1 overflow-y-auto p-0">
        {(q.data?.items ?? []).filter((n) => !existing.includes(n.toLowerCase())).map((n) => (
          <li key={n}><label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={picked.has(n)} onChange={() => toggle(n)} />{n}</label></li>
        ))}
      </ul>
      <Button variant="primary" disabled={picked.size === 0 || save.isPending} onClick={() => save.mutate()}>Add {picked.size} selected</Button>
    </Modal>
  );
}

function CompanyDialog({ company, onClose, onOpenPerson }: { company: NetCompany; onClose: () => void; onOpenPerson: (id: number) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["net", "people", company.id], queryFn: () => api.netPeople(company.id) });
  const [f, setF] = useState({ name: "", role: "", url: "", how: "" });
  const add = useMutation({
    mutationFn: () => api.netAddPerson({ company_id: company.id, name: f.name, ...(f.role ? { role: f.role } : {}), ...(f.url ? { url: f.url } : {}), ...(f.how ? { how: f.how } : {}) }),
    onSuccess: () => { setF({ name: "", role: "", url: "", how: "" }); qc.invalidateQueries({ queryKey: ["net"] }); toast({ text: "Person added" }); },
    onError: () => toast({ text: "Couldn’t add. The profile link must be a full https:// address." }),
  });
  const del = useMutation({ mutationFn: () => api.netDeleteCompany(company.id), onSuccess: () => { qc.invalidateQueries({ queryKey: ["net"] }); onClose(); } });
  const q1 = encodeURIComponent(company.name);
  const li = (kw: string) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${company.name} ${kw}`)}`;
  return (
    <Modal open onClose={onClose} title={company.name} wide>
      {company.why && <p className="m-0 text-[13px] text-ink-2">{company.why}</p>}
      <div>
        <h3 className="m-0 mb-1 text-[13px] font-semibold">Find people (opens a search in a new tab)</h3>
        <div className="flex flex-wrap gap-2">
          {[["Engineers", "engineer"], ["Data / AI", "data scientist OR machine learning"], ["Managers", "engineering manager"], ["Founders", "founder OR CTO"], ["Grads", "graduate"]].map(([name, kw]) => (
            <a key={name} href={li(kw as string)} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-[10px] border border-line px-3 text-[12.5px] text-ink no-underline hover:bg-sunken">{name} ↗</a>
          ))}
          <a href={`https://www.google.com/search?q=${q1}+engineering+blog`} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-[10px] border border-line px-3 text-[12.5px] text-ink no-underline hover:bg-sunken">Their engineering blog ↗</a>
        </div>
      </div>
      <div>
        <h3 className="m-0 mb-1 text-[13px] font-semibold">People here</h3>
        {(q.data?.items ?? []).length === 0 ? <p className="m-0 text-[12.5px] text-muted">Nobody yet. Add someone you found.</p> : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">{q.data?.items.map((p) => <li key={p.id}><button type="button" onClick={() => onOpenPerson(p.id)} className="cursor-pointer text-[13px] text-accent-text underline">{p.name}</button> <span className="text-[12px] text-muted">{p.role ? `${p.role} · ` : ""}{label(STAGES, p.stage)}</span></li>)}</ul>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Their name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Field label="Their role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} />
        <Field label="Profile link (optional)" type="url" placeholder="https://" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
        <Field label="How you found them (optional)" value={f.how} onChange={(e) => setF({ ...f, how: e.target.value })} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={!f.name.trim() || add.isPending} onClick={() => add.mutate()}>Add person</Button>
        <Button variant="quiet" onClick={() => del.mutate()}>Remove company</Button>
      </div>
    </Modal>
  );
}

function People({ onOpen }: { onOpen: (id: number) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["net", "people", "all"], queryFn: () => api.netPeople() });
  const [stage, setStage] = useState("");
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", role: "", company: "" });
  const co = useQuery({ queryKey: ["net", "companies"], queryFn: api.netCompanies });
  const add = useMutation({
    mutationFn: async () => {
      const match = co.data?.items.find((c) => c.name.toLowerCase() === f.company.trim().toLowerCase());
      const cid = match?.id ?? (f.company.trim() ? (await api.netAddCompany({ name: f.company.trim() })).id : undefined);
      return api.netAddPerson({ name: f.name, ...(f.role ? { role: f.role } : {}), ...(cid ? { company_id: cid } : {}) });
    },
    onSuccess: () => { setF({ name: "", role: "", company: "" }); setAdding(false); qc.invalidateQueries({ queryKey: ["net"] }); toast({ text: "Person added" }); },
  });
  const items = (q.data?.items ?? []).filter((p) => !stage || p.stage === stage);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="primary" size="sm" className="rounded-full" onClick={() => setAdding(true)}><PlusIcon size={14} />Add person</Button>
        <div className="w-44"><Select label="Stage" value={stage} onChange={(e) => setStage(e.target.value)}><option value="">All stages</option>{STAGES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
      </div>
      {q.isPending ? <SkeletonRows rows={3} label="Loading" /> : items.length === 0 ? (
        <Card><EmptyState title="No one here yet">Find two people at a company who do the work you’re curious about, add them, and let GRU draft a curiosity-first note.</EmptyState></Card>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {items.map((p) => (
            <li key={p.id}><Card className="p-3"><button type="button" onClick={() => onOpen(p.id)} className="flex w-full cursor-pointer items-center justify-between gap-3 text-left">
              <span className="min-w-0"><span className="block truncate text-[14.5px] font-semibold">{p.name}</span><span className="block truncate text-[12px] text-muted">{[p.role, p.company].filter(Boolean).join(" · ") || "No details"}</span></span>
              <span className="flex flex-none flex-col items-end gap-0.5"><Pill tone={p.stage === "to_reach" ? "neutral" : "accent"}>{label(STAGES, p.stage)}</Pill>{p.next_followup_at && <span className="text-[11.5px] text-muted">follow up {formatShort(p.next_followup_at)}</span>}</span>
            </button></Card></li>
          ))}
        </ul>
      )}
      {adding && (
        <Modal open onClose={() => setAdding(false)} title="Add person">
          <Field label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Field label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} />
          <Field label="Company" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} />
          <Button variant="primary" disabled={!f.name.trim() || add.isPending} onClick={() => add.mutate()}>Add</Button>
        </Modal>
      )}
    </div>
  );
}

const TOUCHES: [string, string][] = [["sent", "I sent a message"], ["reply", "They replied"], ["call", "We talked"], ["thanks", "I sent a thank-you"], ["note", "Add a note"]];
const DRAFTS: [string, string][] = [["connect", "Connection note"], ["coffee", "Coffee-chat request"], ["followup", "Follow-up nudge"], ["thanks", "Thank-you"], ["questions", "Questions to ask"]];

function PersonDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["net", "person", id], queryFn: () => api.netPerson(id) });
  const [kind, setKind] = useState("connect");
  const [polish, setPolish] = useState(false);
  const [draft, setDraft] = useState<{ text: string; limit: number | null; source: string; note: string | null } | null>(null);
  const [note, setNote] = useState("");
  const done = () => qc.invalidateQueries({ queryKey: ["net"] });
  const gen = useMutation({ mutationFn: () => api.netDraft(id, { kind, polish }), onSuccess: setDraft, onError: () => toast({ text: "Couldn’t write a draft" }) });
  const touch = useMutation({
    mutationFn: (k: string) => api.netTouch(id, { kind: k, ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: () => { setNote(""); done(); toast({ text: "Logged" }); },
  });
  const patch = useMutation({ mutationFn: (d: { stage?: string; warmth?: number; next_followup_at?: number | null }) => api.netPatchPerson(id, d), onSuccess: done });
  const del = useMutation({ mutationFn: () => api.netDeletePerson(id), onSuccess: () => { done(); onClose(); } });
  const p = q.data;
  const copy = (t: string) => { void navigator.clipboard?.writeText(t).then(() => { toast({ text: "Copied. Paste it into LinkedIn or email yourself." }); if (p?.stage === "to_reach") patch.mutate({ stage: "drafted" }); }).catch(() => toast({ text: "Couldn’t copy" })); };
  return (
    <Modal open onClose={onClose} title={p?.name ?? "Person"} wide>
      {!p ? <SkeletonRows rows={3} label="Loading" /> : (
        <>
          <p className="m-0 text-[13px] text-muted">{[p.role, p.company].filter(Boolean).join(" · ")}{p.url && <> · <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-accent-text underline">Profile ↗</a></>}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="Stage" value={p.stage} onChange={(e) => patch.mutate({ stage: e.target.value })}>{STAGES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
            <Select label="Warmth" value={String(p.warmth)} onChange={(e) => patch.mutate({ warmth: Number(e.target.value) })}><option value="1">Cold</option><option value="2">Warm</option><option value="3">Hot</option></Select>
            <Select label="Remind me" value="" onChange={(e) => e.target.value && patch.mutate({ next_followup_at: e.target.value === "off" ? null : Math.floor(Date.now() / 1000) + Number(e.target.value) * 86400 })}>
              <option value="">{p.next_followup_at ? `Due ${formatShort(p.next_followup_at)}` : "No reminder"}</option><option value="2">In 2 days</option><option value="7">In a week</option><option value="14">In 2 weeks</option><option value="off">Clear</option>
            </Select>
          </div>

          <div className="flex flex-col gap-2 rounded-xl bg-sunken p-3">
            <h3 className="m-0 text-[13px] font-semibold">Write a message</h3>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-48"><Select label="Kind" value={kind} onChange={(e) => { setKind(e.target.value); setDraft(null); }}>{DRAFTS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
              <label className="flex items-center gap-1.5 pb-2 text-[12.5px]"><input type="checkbox" checked={polish} onChange={(e) => setPolish(e.target.checked)} />Polish with AI</label>
              <Button size="sm" variant="primary" disabled={gen.isPending} onClick={() => gen.mutate()}>Draft it</Button>
            </div>
            {draft && (
              <>
                <TextArea label={draft.source === "ai" ? "Draft (polished by AI, edit freely)" : "Draft (edit freely)"} rows={kind === "connect" ? 4 : 8} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => copy(draft.text)}>Copy</Button>
                  {draft.limit && <span className={cx("text-[12px]", draft.text.length > draft.limit ? "text-red-text" : "text-muted")}>{draft.text.length}/{draft.limit}</span>}
                  {draft.note && <span className="text-[12px] text-muted">{draft.note}</span>}
                </div>
              </>
            )}
            <p className="m-0 text-[12px] text-muted">GRU never sends anything. Paste it into LinkedIn or email yourself, then log it below. Ask about their work, not for a job.</p>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="m-0 text-[13px] font-semibold">Log what happened</h3>
            <TextArea label="Notes from the conversation (what they said, skills they look for, problems they’re solving)" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex flex-wrap gap-2">{TOUCHES.map(([k, v]) => <Button key={k} size="sm" disabled={touch.isPending || (k === "note" && !note.trim())} onClick={() => touch.mutate(k)}>{v}</Button>)}</div>
            {p.touches.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {p.touches.map((t) => <li key={t.id} className="text-[12.5px] text-ink-2"><strong>{TOUCHES.find(([k]) => k === t.kind)?.[1] ?? t.kind}</strong> · {formatRelative(t.at)}{t.note ? <span className="block whitespace-pre-wrap text-muted">{t.note}</span> : null}</li>)}
              </ul>
            )}
          </div>
          <div><Button variant="quiet" onClick={() => del.mutate()}>Remove this person</Button></div>
        </>
      )}
    </Modal>
  );
}

export type { NetPerson };
