// Voice V1: talk to GRU. An extra interface to the same backend (ROADMAP "Voice", D-042).
// Deterministic grammar, no AI. Changes need a tap on a confirm card. Audio is never stored; transcripts are encrypted.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, type Application, type ChatAction } from "../lib/api.ts";
import { dateInputToEpoch, formatDateTime, formatTime, greeting, localDateTimeToEpoch, localDay } from "../lib/format.ts";
import { NATURAL_SPEAKERS, installStt, getPrefs, listen, localVoices, setPrefs, speak, speakable, sttMaybe, sttStatus, stopSpeaking, unlockAudio, voicesReady, type Listener, type SttStatus } from "../lib/speech.ts";
import { HELP_TEXT, composeBrief, parseIntent, type Intent, type Offer } from "../lib/voice-intents.ts";
import { MicError, micSupported, startRecording, type Recording } from "../lib/recorder.ts";
import { ApiError } from "../lib/api.ts";
import { Modal } from "./Dialog.tsx";
import { MailViewer } from "./MailViewer.tsx";
import { MicIcon } from "./Icons.tsx";
import { useToast } from "./Toast.tsx";
import { Button, Select, cx } from "./ui.tsx";

interface Msg { id: number; role: "user" | "gru"; text: string }
/** A next step GRU has offered: open a job, an application, or an email. A plain "yes" takes the first one. */
type ClientOffer = Offer | { kind: "mail"; id: number; label: string; accountId: number; gmailId: string };
interface Pending { title: string; lines: string[]; actions: { label: string; run: () => Promise<string> }[] }

const CHIPS = ["Read my brief", "What are my tasks?", "Any interviews coming up?", "Top jobs", "Help"];
let nextId = 1;

export function VoiceAssistant() {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorder = useRef<Recording | null>(null);
  const navigate = useNavigate();
  const offers = useRef<ClientOffer[]>([]);
  const msgsRef = useRef<Msg[]>([]);
  const [viewMail, setViewMail] = useState<{ accountId: number; gmailId: string } | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [stt, setStt] = useState<SttStatus>("unsupported");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [prefs, setPrefsState] = useState(getPrefs());
  const listener = useRef<Listener | null>(null);
  const loaded = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);

  const persist = (role: "user" | "gru", text: string) => { void api.saveVoiceEntry(role, text.slice(0, 1500)).catch(() => undefined); };

  const say = useCallback(async (text: string | string[], opts: { speak?: boolean } = {}) => {
    const parts = Array.isArray(text) ? text : [text];
    const joined = parts.join(" ");
    setMsgs((m) => [...m, { id: nextId++, role: "gru", text: joined }]);
    persist("gru", joined);
    if (getPrefs().speak && opts.speak !== false) {
      setSpeaking(true);
      try {
        const r = await speak(parts.map(speakable));
        if (r === "none") toast({ text: "No voice available on this device, so I replied in text." });
      } finally { setSpeaking(false); }
    }
  }, [toast]);

  msgsRef.current = msgs;
  const refreshAll = () => qc.invalidateQueries();

  // First open: load history and detect on-device capabilities.
  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    // Merge in front: a reply may already have arrived while history was loading, and must not be overwritten.
    void api.voiceHistory().then((h) => setMsgs((cur) => [...h.items.filter((i) => i.text).map((i) => ({ id: nextId++, role: i.role, text: i.text as string })), ...cur])).catch(() => undefined);
    setStt(sttMaybe() ? "unknown" : "unsupported");
    void voicesReady().then(setVoices);
  }, [open]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs, pending, interim]);
  useEffect(() => () => stopSpeaking(), []);

  const loadBrief = useCallback(async () => {
    const [b, c] = await Promise.all([api.brief(), api.checkin().catch(() => null)]);
    return composeBrief(b, greeting(), c?.answers?.today_focus ?? null);
  }, []);

  /** Shows the next offered step as a one-tap card (the user can also just say yes / next). */
  const showOffer = useCallback(() => {
    const o = offers.current[0];
    if (!o) return;
    const open = async () => { offers.current = offers.current.slice(1); go(o); return ""; };
    const next = async () => {
      offers.current = offers.current.slice(1);
      const n = offers.current[0];
      if (n) { await say(`Okay. Next, ${n.label}. Want me to open it?`); showOffer(); }
      else await say("Okay, that's everything I found. Anything else?");
      return "";
    };
    setPending({ title: o.kind === "job" ? "A job that came in" : o.kind === "mail" ? "An email to look at" : "Worth a look", lines: [o.label], actions: [{ label: o.kind === "job" ? "Open job" : o.kind === "mail" ? "Open email" : "Open application", run: open }, { label: "Next", run: next }] });
  }, [say]);

  function go(o: ClientOffer) {
    if (o.kind === "mail") return void setViewMail({ accountId: o.accountId, gmailId: o.gmailId });
    setOpen(false);
    stopSpeaking();
    navigate(o.kind === "job" ? `/applications?open=${o.id}` : `/applications/${o.id}?status=all`);
  }

  const readBrief = useCallback(async () => {
    const { sentences, offers: found } = await loadBrief();
    offers.current = found;
    await say(sentences);
    showOffer();
  }, [say, loadBrief, showOffer]);

  // Once per Auckland day, on the first visit, the sheet opens with today's brief as TEXT and a Play button.
  // Nothing is spoken and the microphone stays off until Ani taps (browsers also forbid audio without a tap).
  useEffect(() => {
    if (navigator.webdriver) return; // automated test browsers
    const today = localDay(Math.floor(Date.now() / 1000));
    let seen: string | null = null;
    try { seen = localStorage.getItem("gru.voice.brief.day"); } catch { /* ignore */ }
    if (seen === today) return;
    void loadBrief().then(({ sentences, offers: found }) => {
      try { localStorage.setItem("gru.voice.brief.day", today); } catch { /* ignore */ }
      loaded.current = true;
      offers.current = found;
      setMsgs([{ id: nextId++, role: "gru", text: sentences.join(" ") }]);
      setPending({ title: "Today’s brief is ready", lines: ["Tap to hear it."], actions: [{ label: "Play my brief", run: async () => { unlockAudio(); setSpeaking(true); try { await speak(sentences.map(speakable)); } finally { setSpeaking(false); } showOffer(); return ""; } }] });
      setOpen(true);
    }).catch(() => undefined);
  }, [loadBrief, showOffer]);

  // Other parts of the app can ask for the voice briefing.
  useEffect(() => {
    const h = (e: Event) => {
      unlockAudio();
      setOpen(true);
      if ((e as CustomEvent<string>).detail === "brief") void readBrief().catch(() => toast({ text: "Couldn’t load the brief" }));
    };
    window.addEventListener("gru:voice", h);
    return () => window.removeEventListener("gru:voice", h);
  }, [readBrief, toast]);

  async function findApps(name: string): Promise<Application[]> {
    const r = await api.listApplications({ status: "all", q: name });
    const exact = r.items.filter((a) => a.company.toLowerCase() === name.toLowerCase());
    return exact.length ? exact : r.items;
  }

  /** Asks which application when several match; otherwise goes straight to the confirm card. */
  async function withApplication(company: string, build: (a: Application) => Pending): Promise<void> {
    const found = await findApps(company);
    if (found.length === 0) return void (await say(`I couldn’t find an application for ${company}. You can say, I applied to ${company}, to add one.`));
    if (found.length === 1) return setPending(build(found[0] as Application));
    await say(`I found ${found.length} that match ${company}. Which one?`);
    setPending({
      title: "Which application?",
      lines: [],
      actions: found.slice(0, 5).map((a) => ({
        label: `${a.company}${a.role ? ` · ${a.role}` : ""}`,
        run: async () => { setPending(build(a)); return ""; },
      })),
    });
  }

  /** Free-form conversation: the model answers from a read-only snapshot of Ani's data and may suggest one step. */
  async function converse(text: string, fallback: string): Promise<void> {
    const history = msgsRef.current.slice(-8).map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), text: m.text.slice(0, 500) }));
    // The current question was just added to the list; the model receives it separately.
    if (history.at(-1)?.role === "user" && history.at(-1)?.text === text.slice(0, 500)) history.pop();
    try {
      const r = await api.chat(text, history);
      await say(r.reply);
      if (r.action) await suggest(r.action);
    } catch {
      await say(fallback);
    }
  }

  /** Turns a step the model suggested into a one-tap card. Navigation is one tap; changes need Confirm. */
  async function suggest(a: ChatAction): Promise<void> {
    switch (a.type) {
      case "open_job": case "mark_applied": {
        const j = await api.job(a.id).catch(() => null);
        offers.current = [{ kind: "job", id: a.id, label: j ? `${j.title}${j.company ? ` at ${j.company}` : ""}` : "that job" }];
        return showOffer();
      }
      case "open_application": {
        const ap = await api.getApplication(a.id).catch(() => null);
        offers.current = [{ kind: "application", id: a.id, label: ap ? ap.company : "that application" }];
        return showOffer();
      }
      case "open_mail": {
        const r = await api.listReview();
        const it = r.items.find((x) => x.id === a.id);
        if (it?.accountId && it.gmailId) { offers.current = [{ kind: "mail", id: it.id, label: it.context?.subject ?? "that email", accountId: it.accountId, gmailId: it.gmailId }]; showOffer(); }
        return;
      }
      case "open_calendar":
        return setPending({ title: "Calendar", lines: ["See everything coming up"], actions: [{ label: "Open calendar", run: async () => { setOpen(false); stopSpeaking(); navigate("/calendar"); return ""; } }] });
      case "save_job": case "dismiss_job": {
        const j = await api.job(a.id).catch(() => null);
        const save = a.type === "save_job";
        return setPending({ title: save ? "Save this job?" : "Not interested?", lines: [j ? `${j.title}${j.company ? ` at ${j.company}` : ""}` : "That job"], actions: [{ label: save ? "Save job" : "Dismiss job", run: async () => { await api.jobDecision(a.id, save ? "save" : "dismiss"); return save ? "Saved it for later." : "Dismissed. I won't show it again."; } }] });
      }
      case "create_task":
        return setPending({ title: "New task", lines: [a.title, a.due ? `Due ${a.due}` : "No due date"], actions: [{ label: "Add task", run: async () => { await api.createTask({ title: a.title, due_at: a.due ? dateInputToEpoch(a.due) : null }); return "Done. Task added."; } }] });
    }
  }

  async function act(intent: Intent, text: string): Promise<void> {
    switch (intent.kind) {
      case "yes": {
        const o = offers.current[0];
        if (!o) return converse(text, "Sure. What would you like me to do? Say help to hear what I can do.");
        offers.current = offers.current.slice(1);
        setPending(null);
        go(o);
        return;
      }
      case "no": {
        if (!offers.current.length) return converse(text, "No problem.");
        offers.current = offers.current.slice(1);
        const n = offers.current[0];
        if (n) { await say(`Okay. Next, ${n.label}. Want me to open it?`); return showOffer(); }
        setPending(null);
        return say("Okay, that's everything I found. Anything else?");
      }
      case "review_list": {
        const r = await api.listReview();
        if (!r.items.length) return say("Nothing needs your review right now. You're all caught up.");
        const label = (it: (typeof r.items)[number]) => `${it.context?.subject ?? "An email"}${it.context?.from ? `, from ${it.context.from}` : ""}`;
        const first = r.items.slice(0, 3);
        offers.current = first.filter((it) => it.accountId && it.gmailId).map((it) => ({ kind: "mail" as const, id: it.id, label: label(it), accountId: it.accountId as number, gmailId: it.gmailId as string }));
        await say([`You have ${r.items.length} email${r.items.length === 1 ? "" : "s"} to review.`, ...first.map((it, i) => `${i === 0 ? "First" : i === 1 ? "Then" : "And"}: ${label(it)}${it.company ? `, which I think is about ${it.company}` : ""}${it.proposal?.suggested ? `, looks like it could mean ${it.proposal.suggested}` : ""}.`), "Want me to open the first one?"]);
        return showOffer();
      }
      case "weekly": {
        const w = await api.weekly();
        const bits = [`This week you added ${w.applications_added} application${w.applications_added === 1 ? "" : "s"}`, `${w.interviews_booked} interview${w.interviews_booked === 1 ? " is" : "s are"} booked or done`, `and ${w.jobs_from_alerts} job${w.jobs_from_alerts === 1 ? "" : "s"} came in from alerts`];
        return say([`${bits.join(", ")}.`, w.rejections || w.offers ? `${w.rejections} rejection${w.rejections === 1 ? "" : "s"} and ${w.offers} offer${w.offers === 1 ? "" : "s"}.` : "No rejections or offers this week.", w.response_rate !== null ? `${w.response_rate} percent of your recent applications have had a reply.` : "", w.focus].filter(Boolean));
      }
      case "calendar": {
        const startDay = intent.at ? localDay(intent.at) : localDay(Math.floor(Date.now() / 1000));
        const from = localDateTimeToEpoch(`${startDay}T00:00`) ?? 0;
        const to = intent.week ? from + 7 * 86400 : (localDateTimeToEpoch(`${startDay}T23:59`) ?? from + 86399);
        const { items } = await api.calendar(from, to);
        const live = items.filter((i) => i.state !== "done");
        const when = intent.week ? "in the next 7 days" : intent.at && startDay !== localDay(Math.floor(Date.now() / 1000)) ? "that day" : "today";
        if (!live.length) return say(`Nothing on your calendar ${when}.`);
        return say([`You have ${live.length} thing${live.length === 1 ? "" : "s"} ${when}.`, ...live.slice(0, 5).map((i) => `${i.title}${i.all_day ? "" : `, ${intent.week ? formatDateTime(i.start) : formatTime(i.start)}`}${i.link ? `, and the ${i.link.kind} link is saved on it` : ""}.`)]);
      }
      case "stop": stopSpeaking(); setPending(null); return;
      case "greet": return say(`${greeting()}, Ani. Ask for your brief, or tell me what to add.`);
      case "help": return say(HELP_TEXT);
      case "brief": return readBrief();
      case "tasks": {
        const { items } = await api.tasks("open");
        if (!items.length) return say("You have no open tasks.");
        return say([`You have ${items.length} open ${items.length === 1 ? "task" : "tasks"}.`, ...items.slice(0, 4).map((t) => `${t.title}${t.due_at ? `, due ${formatDateTime(t.due_at)}` : ""}.`)]);
      }
      case "agenda":
      case "interviews": {
        const a = await api.agenda();
        const parts: string[] = [];
        if (a.interviews.length) parts.push(...a.interviews.slice(0, 3).map((i) => `Interview with ${i.company}, ${formatDateTime(i.start_utc)}.`));
        else if (intent.kind === "interviews") return say("No interviews in the next 7 days.");
        if (intent.kind === "agenda") {
          const t = [...a.overdue, ...a.today];
          if (a.overdue.length) parts.push(`${a.overdue.length} overdue.`);
          if (a.today.length) parts.push(`Today: ${a.today.slice(0, 3).map((x) => x.title).join(", ")}.`);
          if (!parts.length && !t.length) return say("Your agenda is clear.");
        }
        return say(parts);
      }
      case "jobs": {
        const q = await api.jobQueue();
        if (!q.has_resume) return say("Add your resume in Settings and I can score jobs for you.");
        if (!q.items.length) return say("No good matches are waiting for you right now.");
        return say([`${q.items.length} ${q.items.length === 1 ? "job" : "jobs"} ready to apply today.`, ...q.items.slice(0, 3).map((j) => `${j.title}${j.company ? ` at ${j.company}` : ""}, ${j.score} out of 100.`)]);
      }
      case "search_notes": {
        if (intent.q.replace(/[^a-z0-9]/gi, "").length < 3) return say("Give me a word of at least three letters to search for.");
        const { items } = await api.searchNotes(intent.q);
        if (!items.length) return say(`No notes mention ${intent.q}.`);
        return say([`${items.length} ${items.length === 1 ? "note mentions" : "notes mention"} ${intent.q}.`, `The latest says: ${(items[0]?.body ?? "").slice(0, 160)}`]);
      }
      case "create_task": {
        await say(`Add this task${intent.due ? `, due ${formatDateTime(intent.due)}` : ""}?`);
        return setPending({ title: "New task", lines: [intent.title, intent.due ? `Due ${formatDateTime(intent.due)}` : "No due date"], actions: [{ label: "Add task", run: async () => { await api.createTask({ title: intent.title, due_at: intent.due }); return "Done. Task added."; } }] });
      }
      case "create_note": {
        await say("Save this note?");
        return setPending({ title: "New note", lines: [intent.body], actions: [{ label: "Save note", run: async () => { await api.saveNote({ body: intent.body, tags: [] }); return "Noted."; } }] });
      }
      case "create_application": {
        await say(`Add an application to ${intent.company}?`);
        return setPending({ title: "New application", lines: [intent.company, intent.role ?? "Role not set", "Status: applied today"], actions: [{ label: "Add application", run: async () => { await api.createApplication({ company: intent.company, ...(intent.role ? { role: intent.role } : {}), source: "manual", status: "applied" }); return `Added ${intent.company}. Good luck.`; } }] });
      }
      case "set_status":
        return withApplication(intent.company, (a) => ({
          title: "Change status",
          lines: [`${a.company}${a.role ? ` · ${a.role}` : ""}`, `${a.status} → ${intent.status}`],
          actions: [{ label: `Move to ${intent.status}`, run: async () => { await api.setStatus(a.id, intent.status); return `Moved ${a.company} to ${intent.status}. You can undo it from the application.`; } }],
        })).then(() => undefined);
      case "create_interview": {
        if (!intent.at) return say(`When is the interview with ${intent.company}? For example: interview with ${intent.company} on Friday at 10am.`);
        const at = intent.at;
        return withApplication(intent.company, (a) => ({
          title: "New interview",
          lines: [`${a.company}${a.role ? ` · ${a.role}` : ""}`, formatDateTime(at), "I’ll remind you 24 hours and 2 hours before."],
          actions: [{ label: "Add interview", run: async () => { await api.createInterview({ app_id: a.id, start_utc: at, format: "video" }); return `Interview added for ${formatDateTime(at)}. Want to prep? Open the application.`; } }],
        })).then(() => undefined);
      }
      default:
        return converse(text, `I didn’t catch a command in “${intent.heard}”. Say help to hear what I can do.`);
    }
  }

  async function handleInput(raw: string) {
    const text = raw.trim();
    if (!text) return;
    unlockAudio();
    stopSpeaking();
    setPending(null);
    setMsgs((m) => [...m, { id: nextId++, role: "user", text }]);
    persist("user", text);
    try {
      await act(parseIntent(text, Math.floor(Date.now() / 1000)), text);
    } catch {
      await say("Sorry, that didn’t work. Please try again.");
    }
  }

  async function runPending(action: Pending["actions"][number]) {
    unlockAudio();
    setPending(null);
    try {
      const msg = await action.run();
      if (msg) { refreshAll(); await say(msg); }
    } catch {
      await say("I couldn’t save that. Please try again.");
    }
  }

  async function cloudListen() {
    if (!micSupported()) return void toast({ text: "This browser can’t use the microphone. Type, or use your keyboard’s mic." });
    try {
      recorder.current = await startRecording(25);
      setRecording(true);
      const wav = await recorder.current.result;
      setRecording(false);
      if (!wav) return void toast({ text: "I didn’t hear anything. Tap the mic and try again." });
      setTranscribing(true);
      const { text } = await api.stt(wav);
      setTranscribing(false);
      if (text) await handleInput(text);
      else toast({ text: "I couldn’t make that out. Try again a little closer." });
    } catch (e) {
      if (e instanceof MicError && e.reason === "denied") toast({ text: "Microphone is blocked. On iPhone: Settings → Safari (or GRU) → Microphone → Allow." });
      else if (e instanceof ApiError && e.code === "stt_cap") toast({ text: "Today’s voice-typing allowance is used up. Type, or use your keyboard’s mic." });
      else toast({ text: "Couldn’t use the microphone. Try again, or type." });
    } finally {
      setRecording(false);
      setTranscribing(false);
    }
  }

  async function onMic() {
    if (recording) return void recorder.current?.stop();
    if (listening) return void listener.current?.stop();
    if (transcribing) return;
    unlockAudio();
    stopSpeaking();
    setSpeaking(false);
    // Prefer on-device recognition when the browser confirms it; otherwise record and transcribe in the cloud (iPhone).
    if (stt !== "ready" && stt !== "unsupported") {
      const st = await sttStatus();
      if (st === "downloadable") {
        toast({ text: "Downloading on-device speech…" });
        if (!(await installStt())) { setStt("unsupported"); return void (await cloudListen()); }
      }
      setStt(st === "unsupported" ? "unsupported" : "ready");
    }
    if (stt === "unsupported" || (stt !== "ready" && !sttMaybe())) return void (await cloudListen());
    setListening(true);
    setInterim("");
    try {
      listener.current = listen(setInterim);
      const text = await listener.current.result;
      setListening(false);
      setInterim("");
      if (text) await handleInput(text);
    } catch {
      toast({ text: "I couldn’t hear that. Try again or type." });
    } finally {
      setListening(false);
      setInterim("");
    }
  }

  const voiceList = voices.length ? voices : localVoices();
  const busyMic = recording || listening;

  return (
    <>
      <button
        type="button"
        aria-label="Talk to GRU"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-[calc(76px+env(safe-area-inset-bottom))] z-40 flex h-12 cursor-pointer items-center gap-2 rounded-full bg-accent px-4 text-[14px] font-semibold text-accent-ink shadow-[0_6px_20px_rgba(0,0,0,.28)] transition-transform hover:scale-105 lg:right-7 lg:bottom-7"
      >
        <MicIcon size={20} />
        Ask GRU
      </button>

      {open && (
        <Modal open onClose={() => { setOpen(false); stopSpeaking(); listener.current?.stop(); }} title="Talk to GRU" wide>
          <div ref={scroller} className="flex max-h-[42dvh] min-h-[120px] flex-col gap-2 overflow-y-auto pr-1" aria-live="polite">
            {msgs.length === 0 && <p className="m-0 text-[13px] text-muted">Tap the mic or type. Try “read my brief” or “add a task to call the recruiter tomorrow at 2pm”.</p>}
            {msgs.map((m) => (
              <div key={m.id} className={cx("max-w-[88%] rounded-2xl px-3.5 py-2 text-[13.5px]", m.role === "user" ? "self-end bg-accent-soft text-ink" : "self-start bg-sunken text-ink-2")}>{m.text}</div>
            ))}
            {interim && <div className="max-w-[88%] self-end rounded-2xl bg-accent-soft/60 px-3.5 py-2 text-[13.5px] text-muted italic">{interim}…</div>}
          </div>

          {pending && (
            <div className="flex flex-col gap-2 rounded-[12px] border border-accent/50 bg-surface p-3.5" role="group" aria-label="Confirm">
              <p className="m-0 text-[13px] font-semibold">{pending.title}</p>
              {pending.lines.map((l) => <p key={l} className="m-0 text-[13.5px] text-ink-2">{l}</p>)}
              <div className="flex flex-wrap gap-2">
                {pending.actions.map((a) => <Button key={a.label} variant="primary" size="sm" onClick={() => void runPending(a)}>{pending.actions.length === 1 ? "Confirm · " : ""}{a.label}</Button>)}
                <Button size="sm" variant="quiet" onClick={() => { setPending(null); void say("Okay, cancelled.", { speak: false }); }}>Cancel</Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {CHIPS.map((c) => <button key={c} type="button" onClick={() => void handleInput(c)} className="cursor-pointer rounded-full border border-line bg-surface px-3 py-1 text-[12.5px] text-ink-2 hover:bg-sunken">{c}</button>)}
          </div>

          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); const t = input; setInput(""); void handleInput(t); }}>
            <button
              type="button"
              aria-label={busyMic ? "Stop listening" : "Start listening"}
              aria-pressed={busyMic}
              disabled={transcribing}
              title="Tap to talk, tap again when you’re done"
              onClick={() => void onMic()}
              className={cx("grid size-11 flex-none cursor-pointer place-items-center rounded-full border border-line disabled:cursor-wait disabled:opacity-60", busyMic ? "animate-pulse bg-accent text-accent-ink" : "bg-surface text-ink")}
            >
              <MicIcon size={20} />
            </button>
            <input
              aria-label="Type to GRU"
              value={input}
              maxLength={300}
              placeholder={transcribing ? "Transcribing…" : busyMic ? "Listening… tap the mic when done" : "Type or tap the mic"}
              onChange={(e) => setInput(e.target.value)}
              className="h-11 min-w-0 flex-1 rounded-[10px] border border-line bg-sunken px-3 text-[14px] text-ink placeholder:text-muted"
            />
            {speaking ? <Button onClick={() => { stopSpeaking(); setSpeaking(false); }}>Stop</Button> : <Button variant="primary" type="submit" disabled={!input.trim()}>Send</Button>}
          </form>
          {stt === "unsupported" && <p className="m-0 text-[12px] text-muted">Your short recording is sent to Cloudflare to be turned into text, then discarded. You can also type, or use your keyboard’s microphone.</p>}

          <details className="text-[13px]">
            <summary className="cursor-pointer font-medium text-ink-2">Voice settings</summary>
            <div className="mt-2 flex flex-col gap-3">
              <label className="flex items-center gap-2"><input type="checkbox" checked={prefs.speak} onChange={(e) => { setPrefs({ speak: e.target.checked }); setPrefsState(getPrefs()); if (!e.target.checked) stopSpeaking(); }} /> Speak replies aloud</label>
              <Select label="Voice type" value={prefs.engine} onChange={(e) => { setPrefs({ engine: e.target.value as "natural" | "device" }); setPrefsState(getPrefs()); }}>
                <option value="natural">Natural voice (neural, recommended)</option>
                <option value="device">On-device voice (fully private, more robotic)</option>
              </Select>
              {prefs.engine === "natural" ? (
                <Select label="Speaker" value={prefs.speaker} onChange={(e) => { setPrefs({ speaker: e.target.value }); setPrefsState(getPrefs()); unlockAudio(); void speak(["Hi Ani, this is how I sound."]); }}>
                  {NATURAL_SPEAKERS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </Select>
              ) : voiceList.length > 0 ? (
                <Select label="On-device voice" value={prefs.uri ?? voiceList[0]?.voiceURI ?? ""} onChange={(e) => { setPrefs({ uri: e.target.value }); setPrefsState(getPrefs()); unlockAudio(); void speak(["Hi Ani, this is how I sound."]); }}>
                  {voiceList.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
                </Select>
              ) : <p className="m-0 text-muted">No on-device voice found, so I’ll reply in text.</p>}
              {prefs.engine === "natural" && <p className="m-0 text-[12px] text-muted">The natural voice sends the sentences GRU speaks (they can include company names) to Cloudflare Workers AI, which doesn’t keep them or train on them. A daily limit keeps it free; beyond it GRU switches to an on-device voice.</p>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => { unlockAudio(); void speak(["Hi Ani, this is how I sound."]); }}>Test voice</Button>
                <Button size="sm" variant="quiet" onClick={() => { void api.clearVoiceHistory().then(() => setMsgs([])); }}>Clear conversation history</Button>
              </div>
              <p className="m-0 text-[12px] text-muted">Audio is never stored. Transcripts are encrypted and deleted after 30 days.</p>
            </div>
          </details>
        </Modal>
      )}
      {viewMail && <MailViewer accountId={viewMail.accountId} gmailId={viewMail.gmailId} onClose={() => setViewMail(null)} />}
    </>
  );
}
