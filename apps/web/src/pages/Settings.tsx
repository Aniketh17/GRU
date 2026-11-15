import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { HoldButton, Modal } from "../components/Dialog.tsx";
import { useTheme } from "../components/ThemeContext.tsx";
import { useToast } from "../components/Toast.tsx";
import { Banner, Button, Card, Field, PageHeader, Pill, cx } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { formatTime } from "../lib/format.ts";
import { SCHEDULE, localMinutes, type ThemePref } from "../lib/theme.ts";

const MODES: { value: ThemePref; label: string; sub: string; swatch: [string, string] }[] = [
  { value: "auto", label: "Automatic", sub: "Light 9:00 AM – 6:30 PM, dark otherwise", swatch: ["#f5f5f2", "#0f1113"] },
  { value: "light", label: "Light", sub: "Always light until you switch back", swatch: ["#f5f5f2", "#ffffff"] },
  { value: "dark", label: "Dark", sub: "Always dark until you switch back", swatch: ["#0f1113", "#171a1d"] },
];

export function SettingsPage() {
  const { pref, theme, setPref } = useTheme();
  const qc = useQueryClient();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health });
  const accountsQuery = useQuery({ queryKey: ["mailAccounts"], queryFn: api.mailAccounts });

  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const [draft, setDraft] = useState<{ brief_time: string; stale_days: number; interview_stale_days: number } | null>(null);
  const loop = draft ?? settingsQ.data;
  const saveLoop = useMutation({
    mutationFn: api.saveSettings,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["brief"] });
      setDraft(null);
      toast({ text: "Daily loop settings saved" });
    },
    onError: () => toast({ text: "Couldn’t save settings" }),
  });
  const [wipeOpen, setWipeOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectEmail, setConnectEmail] = useState("");
  const [phrase, setPhrase] = useState("");

  useEffect(() => {
    if (searchParams.get("connected")) {
      toast({ text: "Gmail mailbox connected successfully!" });
      searchParams.delete("connected");
      setSearchParams(searchParams, { replace: true });
      qc.invalidateQueries({ queryKey: ["mailAccounts"] });
    }
    const err = searchParams.get("error");
    if (err) {
      toast({ text: `Connection failed: ${err}` });
      searchParams.delete("error");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, toast, qc]);

  const connectMail = useMutation({
    mutationFn: (email: string) => api.connectMail(email),
    onSuccess: (data) => {
      location.assign(data.url);
    },
    onError: (err: Error) => {
      toast({ text: err.message || "Failed to start connection" });
    },
  });

  const disconnectMail = useMutation({
    mutationFn: (email: string) => api.disconnectMail(email),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mailAccounts"] });
      toast({ text: "Mailbox disconnected" });
    },
    onError: (err: Error) => {
      toast({ text: err.message || "Failed to disconnect mailbox" });
    },
  });

  const togglePause = useMutation({
    mutationFn: (pause: boolean): Promise<{ paused: boolean }> => (pause ? api.pause() : api.resume()),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["health"] });
      toast({ text: r.paused ? "GRU paused" : "GRU resumed" });
    },
  });
  const wipe = useMutation({ mutationFn: () => api.wipe(phrase), onSuccess: () => location.assign("/locked") });
  const logout = useMutation({ mutationFn: api.logout, onSettled: () => location.assign("/login") });

  const closeWipe = () => {
    setWipeOpen(false);
    setPhrase("");
  };
  const nowMin = localMinutes(new Date());
  const paused = health.data?.paused ?? false;

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-5">
      <PageHeader title="Settings" subtitle="Everything here is yours alone. GRU has no other users." />

      <Card className="flex flex-col gap-4 p-5" aria-labelledby="s-theme">
        <div>
          <h2 id="s-theme" className="m-0 text-[15px] font-semibold">Appearance</h2>
          <p className="m-0 text-[12.5px] text-muted">Automatic follows Auckland time, including daylight saving.</p>
        </div>
        <div role="radiogroup" aria-label="Theme" className="grid gap-2.5 sm:grid-cols-3">
          {MODES.map((m) => {
            const on = pref === m.value;
            return (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setPref(m.value)}
                className={cx("flex cursor-pointer flex-col gap-2.5 rounded-xl bg-surface p-3 text-left text-ink", on ? "border-2 border-accent" : "border border-line hover:border-line-strong")}
              >
                <span className="flex h-12 overflow-hidden rounded-lg border border-line" aria-hidden="true">
                  <span className="flex-1" style={{ background: m.swatch[0] }} />
                  <span className="flex-1" style={{ background: m.swatch[1] }} />
                </span>
                <span className="flex flex-col">
                  <span className="text-[13.5px] font-semibold">{m.label}</span>
                  <span className="text-[12px] text-muted">{m.sub}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap justify-between gap-2 text-[12.5px] text-muted">
            <span>Today’s schedule · Pacific/Auckland</span>
            <span className="font-semibold text-ink-2">Now {formatTime(Math.floor(Date.now() / 1000))}: {theme === "dark" ? "dark" : "light"}{pref !== "auto" ? " (manual)" : ""}</span>
          </div>
          <div className="relative flex h-6 overflow-hidden rounded-lg border border-line" aria-hidden="true">
            <span className="bg-[var(--night-bar)]" style={{ width: `${(SCHEDULE.lightFrom / 1440) * 100}%` }} />
            <span className="bg-[var(--day-bar)]" style={{ width: `${((SCHEDULE.darkFrom - SCHEDULE.lightFrom) / 1440) * 100}%` }} />
            <span className="flex-1 bg-[var(--night-bar)]" />
            <span className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-accent" style={{ left: `${(nowMin / 1440) * 100}%` }} />
          </div>
          <div className="flex justify-between text-[12px] text-muted"><span>12 AM</span><span>9:00 AM light</span><span>6:30 PM dark</span><span>12 AM</span></div>
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-5" aria-labelledby="s-loop">
        <div>
          <h2 id="s-loop" className="m-0 text-[15px] font-semibold">Daily loop</h2>
          <p className="m-0 text-[12.5px] text-muted">
            Phone alerts via ntfy: {settingsQ.data?.ntfy_configured ? "on" : "off (set NTFY_TOPIC)"}. Alerts never include names or numbers.
          </p>
        </div>
        {loop && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Brief time (Auckland)" type="time" value={loop.brief_time} onChange={(e) => setDraft({ brief_time: e.target.value, stale_days: loop.stale_days, interview_stale_days: loop.interview_stale_days })} />
            <Field label="Follow up after (days)" type="number" min={1} max={90} value={loop.stale_days} onChange={(e) => setDraft({ brief_time: loop.brief_time, stale_days: Number(e.target.value), interview_stale_days: loop.interview_stale_days })} />
            <Field label="After interview (days)" type="number" min={1} max={90} value={loop.interview_stale_days} onChange={(e) => setDraft({ brief_time: loop.brief_time, stale_days: loop.stale_days, interview_stale_days: Number(e.target.value) })} />
          </div>
        )}
        <div><Button variant="primary" disabled={!draft || saveLoop.isPending} onClick={() => draft && saveLoop.mutate(draft)}>Save</Button></div>
      </Card>

      <Card className="flex flex-col gap-4 p-5" aria-labelledby="s-acc">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="s-acc" className="m-0 text-[15px] font-semibold">Gmail accounts</h2>
            <p className="m-0 text-[12.5px] text-muted">
              Metadata-only sync every 15 minutes. GRU cannot read email bodies, send, or delete mail.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setConnectOpen(true)}>
            Connect account
          </Button>
        </div>

        {accountsQuery.data?.accounts && accountsQuery.data.accounts.length > 0 ? (
          <div className="flex flex-col divide-y divide-line">
            {accountsQuery.data.accounts.map((acc) => (
              <div key={acc.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-ink">{acc.email}</span>
                    <Pill tone={acc.status === "active" ? "accent" : acc.status === "needs_reauth" ? "red" : "neutral"}>
                      {acc.status === "active" ? "Active" : acc.status === "needs_reauth" ? "Reconnect needed" : acc.status}
                    </Pill>
                  </div>
                  <div className="flex items-center gap-2">
                    {acc.status === "needs_reauth" && (
                      <Button variant="primary" onClick={() => connectMail.mutate(acc.email)} disabled={connectMail.isPending}>
                        Reconnect
                      </Button>
                    )}
                    {acc.status === "disconnected" ? (
                      <Button variant="secondary" onClick={() => connectMail.mutate(acc.email)} disabled={connectMail.isPending}>
                        Connect
                      </Button>
                    ) : (
                      <Button variant="secondary" onClick={() => disconnectMail.mutate(acc.email)} disabled={disconnectMail.isPending}>
                        Disconnect
                      </Button>
                    )}
                  </div>
                </div>
                {acc.testing_mode_detected && (
                  <Banner tone="amber" title="Testing mode">
                    Google OAuth is currently in Testing mode; refresh tokens expire after 7 days. Publish app to Production in Google Cloud Console.
                  </Banner>
                )}
                {acc.last_sync_at && (
                  <p className="m-0 text-[12px] text-muted">
                    Last synced {formatTime(acc.last_sync_at)} · {acc.messages_scanned} messages scanned
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-line p-4 text-center text-[13px] text-muted">
            No mailboxes connected yet. Connect your job-hunt Gmail account to automatically discover application updates.
          </div>
        )}
      </Card>

      <Modal open={connectOpen} onClose={() => setConnectOpen(false)} title="Connect Gmail account">
        <p className="m-0 text-ink-2">
          Connect your Gmail account using the secure, restricted <code>gmail.metadata</code> permission.
          GRU will only inspect message headers to identify status updates, and will never request or view message bodies.
        </p>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Gmail address
          <input
            type="email"
            placeholder="you@gmail.com"
            value={connectEmail}
            onChange={(e) => setConnectEmail(e.target.value)}
            className="h-11 rounded-[10px] border border-line-strong bg-sunken px-3 font-medium text-ink"
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => setConnectOpen(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!connectEmail.includes("@") || connectMail.isPending}
            onClick={() => connectMail.mutate(connectEmail)}
          >
            {connectMail.isPending ? "Connecting…" : "Proceed to Google"}
          </Button>
        </div>
      </Modal>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-5" aria-labelledby="s-session">
        <div>
          <h2 id="s-session" className="m-0 text-[15px] font-semibold">Session</h2>
          <p className="m-0 text-[12.5px] text-muted">Sessions end after 7 days without use or 30 days in total.</p>
        </div>
        <Button onClick={() => logout.mutate()} disabled={logout.isPending}>Sign out</Button>
      </Card>

      <Card className="overflow-hidden border-[var(--red)]/40" aria-labelledby="s-danger">
        <div className="border-b border-line px-5 py-4"><h2 id="s-danger" className="m-0 text-[15px] font-semibold text-red-text">Danger zone</h2></div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0 flex-[1_1_320px]">
            <p className="m-0 font-semibold">Pause GRU</p>
            <p className="m-0 text-[12.5px] text-muted">Stops Gmail sync and all reminders. Your data stays.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={paused}
            aria-label="Pause GRU"
            disabled={health.isPending || togglePause.isPending}
            onClick={() => togglePause.mutate(!paused)}
            className={cx("relative h-6 w-10 flex-none cursor-pointer rounded-full transition-colors", paused ? "bg-accent" : "bg-line-strong")}
          >
            <span className={cx("absolute top-[3px] size-[18px] rounded-full bg-white transition-all", paused ? "left-[19px]" : "left-[3px]")} />
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0 flex-[1_1_320px]">
            <p className="m-0 font-semibold">Lock</p>
            <p className="m-0 text-[12.5px] text-muted">Removes the encryption keys from Cloudflare so nothing is readable until you restore them. Run <code>scripts/lock</code> on your computer.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <div className="min-w-0 flex-[1_1_320px]">
            <p className="m-0 font-semibold">Wipe everything</p>
            <p className="m-0 text-[12.5px] text-muted">Revokes Gmail access and deletes every record now. Cloudflare may keep restorable backups for up to 7 days.</p>
          </div>
          <Button variant="danger" onClick={() => setWipeOpen(true)}>Wipe…</Button>
        </div>
      </Card>

      <Modal open={wipeOpen} onClose={closeWipe} title="Wipe everything?">
        <p className="m-0 text-ink-2">GRU will revoke Gmail access and delete every application, job, note, task, resume and interview record. You will be signed out.</p>
        <p className="m-0 text-[13px] text-muted">This can’t be undone in GRU. Cloudflare may keep restorable backups for up to 7 days; your encryption keys stay in your password manager.</p>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Type WIPE EVERYTHING to continue
          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            autoComplete="off"
            className="h-11 rounded-[10px] border border-line-strong bg-sunken px-3 font-medium tracking-wide text-ink"
          />
        </label>
        <HoldButton seconds={10} disabled={phrase !== "WIPE EVERYTHING" || wipe.isPending} onComplete={() => wipe.mutate()}>
          {(left) => (wipe.isPending ? "Wiping…" : left < 10 ? `Keep holding · ${left} s` : "Hold to wipe · 10 s")}
        </HoldButton>
        {wipe.isError && <p role="alert" className="m-0 text-[13px] text-red-text">The wipe didn’t complete. Try again, or use the full teardown script.</p>}
        <Button onClick={closeWipe}>Cancel</Button>
      </Modal>
    </div>
  );
}
