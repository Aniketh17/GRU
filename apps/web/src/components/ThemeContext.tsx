import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { applyTheme, readPref, resolveTheme, startThemeController, writePref, type Theme, type ThemePref } from "../lib/theme.ts";
import { AutoIcon, MoonIcon, SunIcon } from "./Icons.tsx";
import { cx } from "./ui.tsx";

interface ThemeState {
  pref: ThemePref;
  theme: Theme;
  setPref: (p: ThemePref) => void;
}

const ThemeContext = createContext<ThemeState>({ pref: "auto", theme: "light", setPref: () => {} });
export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(readPref(), new Date()));

  useEffect(
    () =>
      startThemeController((t) => {
        setTheme(t);
        setPrefState(readPref());
      }),
    [],
  );

  const setPref = useCallback((p: ThemePref) => {
    writePref(p);
    setPrefState(p);
    const t = resolveTheme(p, new Date());
    applyTheme(t, true);
    setTheme(t);
  }, []);

  return <ThemeContext.Provider value={{ pref, theme, setPref }}>{children}</ThemeContext.Provider>;
}

const NEXT: Record<ThemePref, ThemePref> = { auto: "light", light: "dark", dark: "auto" };
const LABEL: Record<ThemePref, string> = { auto: "Auto", light: "Light", dark: "Dark" };

/** Quick toggle: cycles Auto → Light → Dark. Full selector lives in Settings. */
export function ThemeToggle({ compact }: { compact?: boolean }) {
  const { pref, setPref } = useTheme();
  const Icon = pref === "auto" ? AutoIcon : pref === "light" ? SunIcon : MoonIcon;
  return (
    <button
      type="button"
      onClick={() => setPref(NEXT[pref])}
      aria-label={`Theme: ${LABEL[pref]}. Switch to ${LABEL[NEXT[pref]]}`}
      title={`Theme: ${LABEL[pref]}`}
      className={cx(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface text-[12.5px] text-ink-2 hover:text-ink",
        compact ? "size-10 justify-center rounded-xl" : "h-8 px-3",
      )}
    >
      <Icon size={compact ? 17 : 14} />
      {!compact && LABEL[pref]}
    </button>
  );
}
