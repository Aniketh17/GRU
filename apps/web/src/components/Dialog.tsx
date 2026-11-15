// Accessible modal built on <dialog> (focus trap, Esc to close come from the platform).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, cx } from "./ui.tsx";
import { CloseIcon } from "./Icons.tsx";

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        "m-auto w-[calc(100%-32px)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-[0_20px_50px_rgba(0,0,0,.25)] backdrop:bg-[var(--scrim)]",
        wide ? "max-w-xl" : "max-w-md",
      )}
    >
      {open && (
        <div className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 id="modal-title" className="m-0 text-lg font-semibold">{title}</h2>
            <button type="button" aria-label="Close" onClick={onClose} className="-mt-1 -mr-1 grid size-9 cursor-pointer place-items-center rounded-lg text-muted hover:bg-sunken">
              <CloseIcon size={18} />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open, onClose, title, body, confirmLabel, onConfirm, danger,
}: { open: boolean; onClose: () => void; title: string; body: ReactNode; confirmLabel: string; onConfirm: () => void; danger?: boolean }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="text-ink-2">{body}</div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

/** Press-and-hold confirmation (spec: wipe needs a 10-second hold). Keyboard: hold Space/Enter. */
export function HoldButton({ seconds, onComplete, disabled, children }: { seconds: number; onComplete: () => void; disabled?: boolean; children: (left: number) => ReactNode }) {
  const [progress, setProgress] = useState(0);
  const start = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const done = useRef(false);

  const stop = () => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = null;
    start.current = null;
    if (!done.current) setProgress(0);
  };
  const tick = (t: number) => {
    if (start.current === null) start.current = t;
    const p = Math.min(1, (t - start.current) / (seconds * 1000));
    setProgress(p);
    if (p >= 1) {
      done.current = true;
      frame.current = null;
      onComplete();
      return;
    }
    frame.current = requestAnimationFrame(tick);
  };
  const begin = () => {
    if (disabled || done.current || frame.current) return;
    frame.current = requestAnimationFrame(tick);
  };
  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const left = Math.ceil(seconds * (1 - progress));
  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={begin}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          begin();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") stop();
      }}
      className="relative h-11 cursor-pointer touch-none overflow-hidden rounded-[10px] bg-red-soft font-semibold text-red-text select-none disabled:cursor-not-allowed disabled:opacity-50"
      aria-describedby="hold-hint"
    >
      <span className="absolute inset-y-0 left-0 bg-red opacity-25" style={{ width: `${progress * 100}%` }} aria-hidden="true" />
      <span className="relative">{children(left)}</span>
      <span id="hold-hint" className="sr-only">Press and hold for {seconds} seconds to confirm.</span>
    </button>
  );
}
