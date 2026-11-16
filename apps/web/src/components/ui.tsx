// Design-system primitives (docs/design/DesignSystem.dc.html).
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useId } from "react";
import type { Status } from "../lib/api.ts";
import { STATUS_LABEL } from "../lib/format.ts";
import { OfflineIcon } from "./Icons.tsx";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "strong" | "secondary" | "quiet" | "danger";
const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink font-semibold hover:brightness-95",
  strong: "bg-ink text-bg font-semibold hover:opacity-90",
  secondary: "border border-line text-ink font-medium hover:bg-sunken",
  quiet: "text-muted font-medium hover:text-ink hover:bg-sunken",
  danger: "border border-red text-red-text font-semibold hover:bg-red-soft",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  const sz = size === "sm" ? "h-8 px-3 text-[12.5px]" : size === "lg" ? "h-11 px-5 text-[15px]" : "h-9 px-3.5 text-[13px]";
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-[10px] whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer",
        sz,
        VARIANT[variant],
        className,
      )}
      {...rest}
    />
  );
}

export function Card({ className, children, as: As = "section", ...rest }: { className?: string; children: ReactNode; as?: "section" | "div" | "article" | "aside" } & Record<string, unknown>) {
  return (
    <As className={cx("rounded-[14px] border border-line bg-surface", className)} {...rest}>
      {children}
    </As>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
      <h2 className="m-0 text-[15px] font-semibold">{children}</h2>
      {aside}
    </div>
  );
}

/** One colour per status, so a glance tells you where each application stands (and it changes when the status does). */
export const STATUS_THEME: Record<Status, { chip: string; banner: string; stripe: string; hint: string }> = {
  applied: { chip: "bg-blue-soft text-blue-text [--dot:var(--blue)]", banner: "bg-blue-soft text-blue-text border-blue", stripe: "border-l-blue", hint: "Applied, waiting to hear back" },
  assessment: { chip: "bg-accent-soft text-accent-text [--dot:var(--accent)]", banner: "bg-accent-soft text-accent-text border-accent", stripe: "border-l-accent", hint: "An assessment to complete" },
  interview: { chip: "bg-purple-soft text-purple-text [--dot:var(--purple)]", banner: "bg-purple-soft text-purple-text border-purple", stripe: "border-l-purple", hint: "In the interview stage" },
  offer: { chip: "bg-green-soft text-green-text [--dot:var(--green)]", banner: "bg-green-soft text-green-text border-green", stripe: "border-l-green", hint: "You have an offer" },
  accepted: { chip: "bg-green text-green-ink [--dot:var(--green-ink)]", banner: "bg-green text-green-ink border-green", stripe: "border-l-green", hint: "You accepted. Congratulations" },
  declined: { chip: "bg-amber-soft text-amber-text [--dot:var(--amber)]", banner: "bg-amber-soft text-amber-text border-amber", stripe: "border-l-amber", hint: "You declined this one" },
  rejected: { chip: "bg-red-soft text-red-text [--dot:var(--red)]", banner: "bg-red-soft text-red-text border-red", stripe: "border-l-red", hint: "Not moving forward" },
  withdrawn: { chip: "bg-neutral-soft text-muted [--dot:var(--muted)]", banner: "bg-neutral-soft text-muted border-line-strong", stripe: "border-l-line-strong", hint: "You withdrew" },
};

/** A full-width coloured band for the top of an application: colour and wording follow the current status. */
export function StatusBanner({ status }: { status: Status }) {
  const t = STATUS_THEME[status];
  return (
    <div data-status={status} role="status" className={cx("flex items-center gap-2.5 border-b-2 px-5 py-2.5 text-[13.5px] transition-colors duration-500", t.banner)}>
      <span className="size-2.5 flex-none rounded-full bg-current" aria-hidden="true" />
      <span className="font-semibold">{STATUS_LABEL[status]}</span>
      <span className="opacity-80">· {t.hint}</span>
    </div>
  );
}

export function StatusChip({ status }: { status: Status }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold transition-colors duration-500", STATUS_THEME[status].chip)}>
      <span className="size-1.5 rounded-full bg-[var(--dot)]" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Pill({ tone = "neutral", children }: { tone?: "neutral" | "accent" | "amber" | "red"; children: ReactNode }) {
  const t = {
    neutral: "bg-neutral-soft text-ink-2",
    accent: "bg-accent-soft text-accent-text",
    amber: "bg-amber-soft text-amber-text",
    red: "bg-red-soft text-red-text",
  }[tone];
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold", t)}>{children}</span>;
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 px-6 py-8">
      {icon && <span className="grid size-10 place-items-center rounded-xl bg-neutral-soft text-ink-2">{icon}</span>}
      <h3 className="m-0 text-base font-semibold">{title}</h3>
      {children && <div className="m-0 max-w-prose text-muted">{children}</div>}
      {action}
    </div>
  );
}

export function ErrorState({ onRetry, message }: { onRetry?: () => void; message?: string }) {
  return (
    <EmptyState
      icon={<span className="text-red-text"><OfflineIcon size={19} /></span>}
      title="Couldn’t reach GRU"
      action={onRetry && <Button variant="strong" onClick={onRetry}>Try again</Button>}
    >
      {message ?? "You may be offline. Nothing you entered was lost."}
    </EmptyState>
  );
}

export function SkeletonRows({ rows = 3, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-3.5 border-b border-line px-5 py-4 last:border-b-0">
          <span className="size-10 flex-none rounded-full bg-track" />
          <div className="flex flex-1 flex-col gap-2 pt-1">
            <span className="h-3 rounded-md bg-track" style={{ width: `${60 - i * 8}%` }} />
            <span className="h-2.5 rounded bg-sunken-strong" style={{ width: `${40 + i * 6}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Banner({ tone, title, children, action }: { tone: "red" | "amber" | "accent"; title: string; children?: ReactNode; action?: ReactNode }) {
  const t = { red: "bg-red-soft text-red-text", amber: "bg-amber-soft text-amber-text", accent: "bg-accent-soft text-accent-text" }[tone];
  return (
    <div role={tone === "red" ? "alert" : "status"} className={cx("flex flex-wrap items-center gap-3 rounded-xl px-4 py-3", t)}>
      <strong className="font-semibold">{title}</strong>
      {children && <span className="min-w-[200px] flex-1 text-ink-2">{children}</span>}
      {action}
    </div>
  );
}

const fieldBase = "w-full rounded-[10px] border border-line bg-sunken px-3 text-[14px] text-ink placeholder:text-muted";

export function Field({ label, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-muted">
      {label}
      <input id={id} className={cx(fieldBase, "h-10 font-normal")} {...rest} />
      {hint && <span className="font-normal">{hint}</span>}
    </label>
  );
}

export function TextArea({ label, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-muted">
      {label}
      <textarea id={id} className={cx(fieldBase, "resize-y py-2.5 font-normal")} {...rest} />
    </label>
  );
}

export function Select({ label, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const id = useId();
  // Label is a sibling, not a wrapper: a wrapped <select> leaks its selected option into the accessible name.
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12.5px] font-semibold text-muted">{label}</label>
      <select id={id} className={cx(fieldBase, "h-10 font-normal")} {...rest}>
        {children}
      </select>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="m-0 text-[26px] leading-tight font-semibold tracking-[-0.015em]">{title}</h1>
        {subtitle && <p className="mt-0.5 mb-0 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
