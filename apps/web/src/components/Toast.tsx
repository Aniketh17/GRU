// Toasts: short confirmations with an optional action (e.g. Undo). Polite live region.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface ToastItem {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

const ToastContext = createContext<(t: Omit<ToastItem, "id">) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const show = useCallback((t: Omit<ToastItem, "id">) => {
    const id = nextId.current++;
    setItems((xs) => [...xs.slice(-2), { ...t, id }]);
  }, []);
  const dismiss = (id: number) => setItems((xs) => xs.filter((x) => x.id !== id));
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6" role="status" aria-live="polite">
        {items.map((t) => (
          <Toast key={t.id} item={t} onDone={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ item, onDone }: { item: ToastItem; onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, item.action ? 8000 : 4000);
    return () => window.clearTimeout(timer);
  }, [item, onDone]);
  return (
    <div className="fade-in pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl bg-toast py-3 pr-3 pl-4 text-toast-ink shadow-[0_8px_24px_rgba(0,0,0,.18)]">
      <span className="flex-1">{item.text}</span>
      {item.action && (
        <button
          type="button"
          className="h-8 cursor-pointer rounded-lg px-2.5 font-semibold text-toast-accent"
          onClick={() => {
            item.action?.run();
            onDone();
          }}
        >
          {item.action.label}
        </button>
      )}
    </div>
  );
}
