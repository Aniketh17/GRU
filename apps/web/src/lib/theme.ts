// Theme scheduling (Ani's requirement): Automatic = light 09:00–18:30, dark otherwise, in
// Pacific/Auckland via Intl (so NZ daylight saving is handled by the platform tz database).
// Manual Light/Dark persist until the user chooses Automatic again.
// public/theme-init.js mirrors resolveTheme() so the right theme is set before first paint.

import { isThemePref, msUntilNextBoundary, resolveTheme, type Theme, type ThemePref } from "./theme-core.ts";

export { SCHEDULE, isThemePref, localMinutes, msUntilNextBoundary, resolveTheme, scheduledTheme } from "./theme-core.ts";
export type { Theme, ThemePref } from "./theme-core.ts";

export const STORAGE_KEY = "gru.theme";

export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isThemePref(v) ? v : "auto";
  } catch {
    return "auto";
  }
}

export function writePref(pref: ThemePref): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
}

const THEME_COLOR: Record<Theme, string> = { light: "#f5f5f2", dark: "#0f1113" };

export function applyTheme(theme: Theme, animate: boolean): void {
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  if (animate) {
    root.classList.add("theme-fade");
    window.setTimeout(() => root.classList.remove("theme-fade"), 300);
  }
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
}

/** Keeps the document theme correct over time. Returns a cleanup function. */
export function startThemeController(onChange: (theme: Theme) => void): () => void {
  let timer: number | undefined;
  const tick = () => {
    const theme = resolveTheme(readPref(), new Date());
    applyTheme(theme, true);
    onChange(theme);
    window.clearTimeout(timer);
    timer = window.setTimeout(tick, msUntilNextBoundary(new Date()));
  };
  const onVisible = () => document.visibilityState === "visible" && tick();
  const onStorage = (e: StorageEvent) => e.key === STORAGE_KEY && tick();
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", tick);
  window.addEventListener("storage", onStorage);
  tick();
  return () => {
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", tick);
    window.removeEventListener("storage", onStorage);
  };
}
