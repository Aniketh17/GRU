// Settings cards for Phase 5 (resume profiles) and Phase 7 (export).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Allowance } from "../lib/api.ts";
import { ResumeFileError, extractResumeText } from "../lib/resume-file.ts";
import { Modal } from "./Dialog.tsx";
import { useToast } from "./Toast.tsx";
import { Button, Card, Field, Pill, TextArea } from "./ui.tsx";

export function ResumeCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ["resumes"], queryFn: api.resumes });
  const [edit, setEdit] = useState<{ id?: number; label: string; text: string } | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["resumes"] });
    qc.invalidateQueries({ queryKey: ["jobs"] });
  };
  const save = useMutation({
    mutationFn: async (e: { id?: number; label: string; text: string }) => {
      if (e.id) await api.updateResume(e.id, e);
      else await api.saveResume(e);
    },
    onSuccess: () => { refresh(); setEdit(null); toast({ text: "Resume saved and activated. Jobs will re-score." }); },
    onError: () => toast({ text: "Couldn’t save (text must be at least 50 characters)" }),
  });
  const activate = useMutation({ mutationFn: api.activateResume, onSuccess: () => { refresh(); toast({ text: "Resume activated" }); } });
  const remove = useMutation({ mutationFn: api.deleteResume, onSuccess: refresh });
  const [reading, setReading] = useState(false);
  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      const text = await extractResumeText(file);
      const label = file.name.replace(/\.[^.]+$/, "").slice(0, 120);
      setEdit((cur) => ({ ...(cur ?? { label: "", text: "" }), label: cur?.label || label, text }));
    } catch (e) {
      toast({ text: e instanceof ResumeFileError ? e.message : "Couldn’t read that file. Try a PDF, DOCX or TXT." });
    } finally {
      setReading(false);
    }
  };
  const open = async (id: number) => {
    const r = await api.getResume(id);
    setEdit({ id, label: r.label, text: r.text ?? "" });
  };
  return (
    <Card className="flex flex-col gap-3 p-5" aria-labelledby="s-resume">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="s-resume" className="m-0 text-[15px] font-semibold">Resume profiles</h2>
          <p className="m-0 text-[12.5px] text-muted">Upload a file or paste text. Encrypted at rest; used only to score jobs. Skills are listed only if they appear in your text.</p>
        </div>
        <Button size="sm" variant="primary" onClick={() => setEdit({ label: "", text: "" })}>Add</Button>
      </div>
      {list.data?.items.length === 0 && <p className="m-0 text-[13px] text-muted">No resume yet. Jobs will show “Not scored – add a resume”.</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {list.data?.items.map((r) => (
          <li key={r.id} className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-sunken px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{r.label} <span className="text-[12px] text-muted">v{r.version}</span></span>
              {r.active ? <Pill tone="accent">Active</Pill> : <Button size="sm" onClick={() => activate.mutate(r.id)}>Activate</Button>}
            </div>
            <p className="m-0 text-[12px] text-muted">{r.skills.length ? `Skills found: ${r.skills.slice(0, 14).join(", ")}${r.skills.length > 14 ? "…" : ""}` : "No known skills detected yet."}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => open(r.id)}>Edit</Button>
              <Button size="sm" variant="quiet" onClick={() => remove.mutate(r.id)}>Delete</Button>
            </div>
          </li>
        ))}
      </ul>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? "Edit resume" : "Add resume"} wide>
          <label className="flex cursor-pointer flex-col gap-1.5 rounded-[10px] border border-dashed border-line-strong px-4 py-3 text-[13px]">
            <span className="font-semibold">{reading ? "Reading file…" : "Upload your resume (PDF, DOCX or TXT)"}</span>
            <span className="text-[12px] text-muted">Read on this device. The file is never uploaded; only the text below is saved, encrypted.</span>
            <input type="file" accept=".pdf,.docx,.txt,.md,application/pdf,text/plain" className="text-[12.5px]" onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          <Field label="Label" value={edit.label} maxLength={120} placeholder="Resume – AI/Software – Nov 2026" onChange={(e) => setEdit({ ...edit, label: e.target.value })} />
          <TextArea label="Resume text (check it looks right)" rows={12} maxLength={40000} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
          <Button variant="primary" disabled={!edit.label.trim() || edit.text.length < 50 || save.isPending} onClick={() => save.mutate(edit)}>Save</Button>
        </Modal>
      )}
    </Card>
  );
}

const TABLES = ["applications", "interviews", "jobs", "notes", "tasks", "resume_profiles", "checkins"] as const;

export function ExportCard() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (table: string) => {
    setBusy(table);
    try {
      const all: unknown[] = [];
      let after = "";
      for (let n = 0; n < 40; n++) {
        const page = await api.exportTable(table, after);
        all.push(...page.items);
        if (!page.next) break;
        after = page.next;
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(all, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `gru-${table}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ text: `Exported ${all.length} ${table}` });
    } catch {
      toast({ text: "Export failed" });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card className="flex flex-col gap-3 p-5" aria-labelledby="s-export">
      <div>
        <h2 id="s-export" className="m-0 text-[15px] font-semibold">Export your data</h2>
        <p className="m-0 text-[12.5px] text-muted">Downloads decrypted JSON to this device only. Keep the file somewhere private.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {TABLES.map((t) => <Button key={t} size="sm" disabled={busy !== null} onClick={() => run(t)}>{busy === t ? "Exporting…" : t.replace("_", " ")}</Button>)}
      </div>
    </Card>
  );
}

export function MailToolsCard() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.recheckMail();
      toast({ text: r.queued ? `Re-reading ${r.queued} recent emails. This continues over the next few minutes.` : "No recent job mail to re-read." });
    } catch {
      toast({ text: "Couldn’t start that" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-5" aria-labelledby="s-recheck">
      <div className="min-w-0 flex-[1_1_320px]">
        <h2 id="s-recheck" className="m-0 text-[15px] font-semibold">Re-read recent job mail</h2>
        <p className="m-0 text-[12.5px] text-muted">Runs GRU’s understanding again over the last 5 days of job email (status, role, interview details, vacancies). Your own edits and undone changes are kept.</p>
      </div>
      <Button onClick={() => void run()} disabled={busy}>{busy ? "Starting…" : "Re-read now"}</Button>
    </Card>
  );
}

const METERS: [keyof Omit<Allowance, "total" | "free_daily">, string][] = [["voice", "Voice"], ["transcription", "Speech to text"], ["chat", "Chat"], ["tailor", "CV tailoring"], ["writing", "Drafts"]];

/** Today's free AI allowance (Workers AI, 10,000 Neurons a day). GRU stops itself below the limit, so it can never cost money. */
export function AllowanceCard() {
  const q = useQuery({ queryKey: ["allowance"], queryFn: api.aiAllowance, staleTime: 30_000 });
  const a = q.data;
  return (
    <Card className="flex flex-col gap-3 p-5" aria-labelledby="s-ai">
      <div>
        <h2 id="s-ai" className="m-0 text-[15px] font-semibold">Today’s free AI allowance</h2>
        <p className="m-0 text-[12.5px] text-muted">Resets daily at 00:00 UTC (about 1 pm in New Zealand). When a share runs out, that feature switches to its simple fallback; nothing ever costs money.</p>
      </div>
      {a ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {METERS.map(([k, label]) => {
            const m = a[k];
            const pct = Math.min(100, Math.round((m.used / m.cap) * 100));
            return (
              <li key={k} className="flex items-center gap-2 text-[12.5px]">
                <span className="w-28 text-muted">{label}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-sm bg-track"><span className={pct > 85 ? "block h-1.5 bg-amber-text" : "block h-1.5 bg-accent"} style={{ width: `${pct}%` }} /></span>
                <span className="w-12 text-right tabular-nums">{pct}%</span>
              </li>
            );
          })}
        </ul>
      ) : <p className="m-0 text-[13px] text-muted">Loading…</p>}
    </Card>
  );
}

const slug = (s: string): string => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Saved searches: one tap opens the job boards with your roles and place already filled in (you search, GRU never scrapes). */
export function SearchShortcutsCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["prefs"], queryFn: api.prefs });
  const [draft, setDraft] = useState<{ roles: string; location: string } | null>(null);
  const roles = draft ? draft.roles : (q.data?.roles ?? []).join(", ");
  const location = draft ? draft.location : (q.data?.location ?? "");
  const save = useMutation({
    mutationFn: () => api.savePrefs({ roles: roles.split(",").map((r) => r.trim()).filter((r) => r.length > 1).slice(0, 6), location: location.trim() }),
    onSuccess: () => { setDraft(null); qc.invalidateQueries({ queryKey: ["prefs"] }); toast({ text: "Search shortcuts saved" }); },
    onError: () => toast({ text: "Couldn’t save" }),
  });
  const saved = q.data?.roles ?? [];
  const loc = q.data?.location ?? "";
  return (
    <Card className="flex flex-col gap-3 p-5" aria-labelledby="s-search">
      <div>
        <h2 id="s-search" className="m-0 text-[15px] font-semibold">Job search shortcuts</h2>
        <p className="m-0 text-[12.5px] text-muted">The roles and place you’re after. Each shortcut opens the job board with your search already filled in.</p>
      </div>
      <Field label="Roles (comma-separated)" value={roles} placeholder="graduate data analyst, junior software engineer" onChange={(e) => setDraft({ roles: e.target.value, location })} />
      <Field label="Location" value={location} placeholder="Auckland" onChange={(e) => setDraft({ roles, location: e.target.value })} />
      <div><Button variant="primary" size="sm" disabled={!draft || save.isPending} onClick={() => save.mutate()}>Save</Button></div>
      {saved.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {saved.map((r) => (
            <li key={r} className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="w-full font-medium">{r}</span>
              <a className="text-accent-text underline" target="_blank" rel="noopener noreferrer" href={`https://www.seek.co.nz/${slug(r)}-jobs${loc ? `/in-${slug(loc)}` : ""}`}>Seek ↗</a>
              <a className="text-accent-text underline" target="_blank" rel="noopener noreferrer" href={`https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(r)}${loc ? `&location=${encodeURIComponent(loc)}` : ""}&f_TPR=r86400`}>LinkedIn (last 24 h) ↗</a>
              <a className="text-accent-text underline" target="_blank" rel="noopener noreferrer" href={`https://nz.indeed.com/jobs?q=${encodeURIComponent(r)}${loc ? `&l=${encodeURIComponent(loc)}` : ""}&fromage=1`}>Indeed ↗</a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
