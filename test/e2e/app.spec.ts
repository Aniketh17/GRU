// End-to-end: real browser, real Worker (wrangler dev), real local D1. Synthetic data only.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const creds = JSON.parse(readFileSync(".e2e/creds.json", "utf8")) as { username: string; password: string };
const shots = (name: string, page: Page) => page.screenshot({ path: `docs/screenshots/phase-1/${test.info().project.name}-${name}.png`, fullPage: false });

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(creds.username);
  await page.getByLabel("Password").fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");
}

async function setTheme(page: Page, pref: "light" | "dark") {
  await page.evaluate((p) => localStorage.setItem("gru.theme", p), pref);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", pref);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page must not scroll horizontally").toBeLessThanOrEqual(0);
}

test.describe.configure({ mode: "serial" });

test("unauthenticated visitors are sent to sign-in; a wrong password is refused", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL("**/login");
  await expect(page.getByRole("heading", { name: "Welcome back, Ani" })).toBeVisible();
  await page.getByLabel("Username").fill(creds.username);
  await page.getByLabel("Password").fill("definitely not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("status")).toContainText("isn’t right");
  await shots("login", page);
});

test("Today shows a helpful empty state with zero data", async ({ page }) => {
  test.skip(test.info().project.name !== "phone", "runs first, against the empty database");
  await login(page);
  await expect(page.getByRole("heading", { name: /, Ani$/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Let’s set up your pipeline" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("add, find, update, undo and annotate an application", async ({ page }) => {
  await login(page);
  const company = `Harbourline ${test.info().project.name}`;
  await page.goto("/applications?tab=tracked");
  await page.getByRole("button", { name: "Add application", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Company").fill(company);
  await dialog.getByLabel("Role").fill("Junior Backend Developer (TypeScript)");
  await dialog.getByRole("button", { name: "Add application" }).click();
  await expect(page.getByRole("heading", { name: company })).toBeVisible();

  // Manual status change with Undo from the toast.
  await page.getByLabel("Change status").selectOption("interview");
  await expect(page.getByText("Moved to Interview")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).first().click();
  await expect(page.getByText("Back to Applied")).toBeVisible();

  // Encrypted private notes.
  await page.getByLabel("Private notes · encrypted").fill("Recruiter: Sam. Ask about on-call.");
  await page.getByRole("button", { name: "Save notes" }).click();
  await expect(page.getByText("Notes saved")).toBeVisible();

  // Search finds it from the list.
  await page.goto("/applications?tab=tracked");
  await page.getByRole("searchbox", { name: "Search company or role" }).fill("harbourline");
  await expect(page.getByRole("link", { name: new RegExp(company) })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("screenshots at the review sizes, light and dark, with no horizontal scroll", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page);
  // Seed a realistic synthetic pipeline through the real API.
  const seed = [
    { company: "Kōwhai Labs", role: "Graduate Machine Learning Engineer", status: "applied" },
    { company: "Pūriri Systems", role: "AI Platform Intern 2027", status: "assessment" },
    { company: "Northgate Health", role: "Graduate Data Analyst", status: "applied", applied_at: Math.floor(Date.now() / 1000) - 17 * 86400 },
    { company: "Tidewater Analytics", role: "Data Engineering Intern", status: "interview" },
    { company: "Mātai Insights", role: "Junior ML Engineer", status: "rejected" },
  ];
  if (test.info().project.name === "phone") await page.evaluate(async (items) => {
    for (const it of items) {
      await fetch("/api/applications", { method: "POST", headers: { "Content-Type": "application/json", "X-App": "gru" }, body: JSON.stringify(it) });
    }
  }, seed);

  for (const theme of ["light", "dark"] as const) {
    await page.goto("/");
    await setTheme(page, theme);
    await expect(page.getByRole("heading", { name: "Pipeline" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shots(`today-${theme}`, page);

    await page.goto("/applications?status=all");
    await expect(page.getByRole("link", { name: /Kōwhai Labs/ }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shots(`applications-${theme}`, page);

    await page.getByRole("link", { name: /Northgate Health/ }).first().click();
    await expect(page.getByText(/A polite follow-up might help/)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shots(`detail-${theme}`, page);

    await page.goto("/settings");
    await expect(page.getByRole("radiogroup", { name: "Theme" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shots(`settings-${theme}`, page);
  }
  await page.evaluate(() => localStorage.removeItem("gru.theme"));
});

test("automatic theme follows Auckland time and switches at 18:30 without a reload", async ({ page }) => {
  await login(page);
  await page.evaluate(() => localStorage.setItem("gru.theme", "auto"));
  await page.clock.install({ time: new Date("2026-11-15T05:29:50Z") }); // 18:29:50 NZDT
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.clock.runFor(15_000); // past 18:30
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // Manual override sticks regardless of the clock.
  await page.getByRole("button", { name: /^Theme: Auto/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.clock.runFor(60 * 60_000);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.evaluate(() => localStorage.removeItem("gru.theme"));
});

test("keyboard: the first Tab stop is the skip link", async ({ page }) => {
  await login(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
});

test("PWA: manifest, icons and service worker make the app installable", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "installability check uses Chrome DevTools Protocol");
  await login(page);
  const manifest = await (await page.request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ display: "standalone", start_url: "/" });
  for (const icon of manifest.icons as { src: string }[]) expect((await page.request.get(icon.src)).status()).toBe(200);
  await page.waitForFunction(async () => Boolean(await navigator.serviceWorker.getRegistration()));
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = (await cdp.send("Page.getInstallabilityErrors")) as { installabilityErrors: { errorId: string }[] };
  expect(installabilityErrors.map((e) => e.errorId)).toEqual([]);
});
