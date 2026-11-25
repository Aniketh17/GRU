// Whole-app smoke: every page must render with data present and produce no browser errors.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const creds = JSON.parse(readFileSync(".e2e/creds.json", "utf8")) as { username: string; password: string };

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(creds.username);
  await page.getByLabel("Password").fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");
}

const api = (page: Page, path: string, body: unknown, method = "POST") =>
  page.evaluate(
    async ([p, b, m]) => {
      const r = await fetch(p as string, { method: m as string, headers: { "Content-Type": "application/json", "X-App": "gru" }, body: JSON.stringify(b) });
      return r.json();
    },
    [path, body, method] as const,
  );

test.describe.configure({ mode: "serial" });

test("every page renders with data and no browser errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  await login(page);

  const app = (await api(page, "/api/applications", { company: "Smoke Test Ltd", role: "Graduate Engineer", source: "email" })) as { id: number };
  await api(page, "/api/interviews", { app_id: app.id, start_utc: Math.floor(Date.now() / 1000) + 7200, format: "video" });
  await api(page, "/api/resume-profiles", { label: "Smoke", text: "Graduate engineer in Auckland. BSc Computer Science. Python, FastAPI, PostgreSQL, Docker, Git, pytest and React projects." });
  await api(page, "/api/jobs", { title: "Graduate Backend Engineer", company: "Acme", location: "Auckland", url: "https://example.com/j/smoke", description: "Requirements: Python, PostgreSQL, Docker. Nice to have: Kubernetes. Graduate role in Auckland. ".repeat(3) });
  await api(page, "/api/notes", { body: "Smoke note about Wellington", tags: ["smoke"] });
  await api(page, "/api/tasks", { title: "Smoke task", due_at: Math.floor(Date.now() / 1000) + 3600 });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /, Ani$/ })).toBeVisible();
  await expect(page.getByText("Morning brief")).toBeVisible();

  // Clicking a card on Today opens the application detail (this used to crash).
  await page.locator('a[href*="/applications/"][href*="status=all"]').first().click(); // Recent activity card: shares a URL filter with the list page
  await expect(page.getByRole("heading", { name: "Smoke Test Ltd" })).toBeVisible();
  await expect(page.getByText("Interviews", { exact: true })).toBeVisible();

  for (const [path, text] of [
    ["/applications", "Apply today"], ["/applications?tab=other", "Other jobs"], ["/jobs", "Other jobs"], ["/agenda", "Agenda"], ["/calendar", "Calendar"], ["/people", "People"], ["/notes", "Notes"], ["/more", "More"], ["/settings", "Settings"], ["/review", "Review"], ["/inbox", "Inbox"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: text, exact: true }).first()).toBeVisible();
    await expect(page.getByText("Unexpected Application Error")).toHaveCount(0);
  }

  await page.goto("/applications?tab=other");
  await expect(page.getByText("Graduate Backend Engineer").first()).toBeVisible();
  // The job workspace: a card opens its own page with Fit and Insights tabs.
  await page.getByText("Graduate Backend Engineer").first().click();
  await expect(page.getByRole("heading", { name: "Graduate Backend Engineer" })).toBeVisible();
  await page.getByRole("tab", { name: "Fit" }).click();
  await expect(page.getByText(/Strengths from your resume|Gaps/).first()).toBeVisible();
  await page.getByRole("tab", { name: "Tailor CV" }).click();
  await expect(page.getByText("Keyword coverage")).toBeVisible();
  await expect(page.getByText(/Keywords missing or buried/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Write tailored bullets" })).toBeVisible();
  await page.getByRole("tab", { name: "Insights" }).click();
  await expect(page.getByText("Have I applied already?")).toBeVisible();
  await expect(page.getByText("No match found among your applications.")).toBeVisible();
  await page.goto("/notes");
  await page.getByLabel("Search notes").fill("wellington");
  await expect(page.getByText("Smoke note about Wellington").first()).toBeVisible();
  await page.goto("/agenda");
  await expect(page.getByText("Smoke task").first()).toBeVisible();

  expect(errors, errors.join("\n")).toEqual([]);
});

test("resume can be uploaded as a PDF and a text file (parsed on-device)", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  const stream = "BT /F1 12 Tf 72 720 Td (Python developer with FastAPI and PostgreSQL experience in Auckland) Tj ET";
  const pdf = `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${stream.length}>>stream
${stream}
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF`;
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="file"]').setInputFiles({ name: "My Resume.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf) });
  await expect(dialog.getByLabel(/Resume text/)).toHaveValue(/FastAPI and PostgreSQL/);
  await expect(dialog.getByLabel("Label")).toHaveValue("My Resume");
  await dialog.locator('input[type="file"]').setInputFiles({ name: "cv.txt", mimeType: "text/plain", buffer: Buffer.from("Graduate engineer. TypeScript, React, Docker, Git and testing projects in Auckland.") });
  await expect(dialog.getByLabel(/Resume text/)).toHaveValue(/TypeScript, React/);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
});

test("voice assistant: a typed command becomes a confirm card, and nothing is saved until tapped", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await page.evaluate(() => localStorage.setItem("gru.voice.speak", "0")); // keep the test silent and fast
  await page.goto("/");
  await page.getByRole("button", { name: "Talk to GRU" }).click();
  const dialog = page.getByRole("dialog");
  // The mic is only probed after a tap (on-device recognition), so typed commands never depend on it.
  await expect(dialog.getByRole("button", { name: "Start listening" })).toBeVisible();

  await dialog.getByLabel("Type to GRU").fill("add a task to email the hiring manager tomorrow at 2pm");
  await dialog.getByLabel("Type to GRU").press("Enter");
  const card = dialog.getByRole("group", { name: "Confirm" });
  await expect(card).toContainText("Email the hiring manager");
  await expect(card).toContainText("Due");
  const before = await page.evaluate(async () => (await (await fetch("/api/tasks?status=open", { headers: { "X-App": "gru" } })).json()).items.length);
  await card.getByRole("button", { name: /Add task/ }).click();
  await expect(dialog).toContainText("Task added");
  const after = await page.evaluate(async () => (await (await fetch("/api/tasks?status=open", { headers: { "X-App": "gru" } })).json()).items.length);
  expect(after).toBe(before + 1);

  await dialog.getByLabel("Type to GRU").fill("what are my tasks");
  await dialog.getByLabel("Type to GRU").press("Enter");
  await expect(dialog).toContainText("open task");
  await dialog.getByRole("button", { name: "Read my brief" }).click();
  await expect(dialog).toContainText(/Good (morning|afternoon|evening), Ani\./);
  expect(errors).toEqual([]);
});

test("assistant offers today's brief once a day as text and never speaks or listens until tapped", async ({ page }) => {
  // Automated browsers are exempt from the daily prompt by default; pretend to be a normal browser here.
  await page.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => false }));
  const ttsCalls: string[] = [];
  page.on("request", (r) => r.url().includes("/api/voice/tts") && ttsCalls.push(r.url()));
  await login(page); // first visit of the day, straight after sign-in
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Today’s brief is ready")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Play my brief/ })).toBeVisible();
  await expect(dialog).toContainText(/Good (morning|afternoon|evening), Ani\./); // brief shown as text
  expect(await page.evaluate(() => window.speechSynthesis.speaking)).toBe(false);
  expect(ttsCalls).toEqual([]); // no audio requested without a tap
  await page.keyboard.press("Escape");

  // Second visit the same day: no automatic sheet.
  await page.reload();
  await expect(page.getByRole("button", { name: "Talk to GRU" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(ttsCalls).toEqual([]);
});

test("microphone on a device without on-device speech (iPhone): records, transcribes in the cloud, shows a confirm card", async ({ page }) => {
  // iPhone Safari has webkitSpeechRecognition but no on-device `available()`; emulate that.
  await page.addInitScript(() => {
    for (const k of ["SpeechRecognition", "webkitSpeechRecognition"] as const) {
      const C = (window as unknown as Record<string, unknown>)[k];
      if (C) Object.defineProperty(C, "available", { value: undefined, configurable: true });
    }
  });
  let wavStart = "";
  await page.route("**/api/voice/stt", async (route) => {
    wavStart = String((route.request().postDataJSON() as { audio: string }).audio).slice(0, 5);
    await route.fulfill({ json: { text: "add a task to water the plants tomorrow" } });
  });
  await login(page);
  await page.evaluate(() => localStorage.setItem("gru.voice.speak", "0"));
  await page.goto("/");
  await page.getByRole("button", { name: "Talk to GRU" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Start listening" }).click();
  await expect(dialog.getByRole("button", { name: "Stop listening" })).toBeVisible();
  await page.waitForTimeout(1500);
  await dialog.getByRole("button", { name: "Stop listening" }).click();
  await expect(dialog.getByRole("group", { name: "Confirm" })).toContainText("Water the plants");
  expect(wavStart).toBe("UklGR"); // a WAV (RIFF) recording was sent
});

test("calendar shows the day's items, offers the private feed, and a new feed link replaces the old one", async ({ page }) => {
  await login(page);
  await api(page, "/api/tasks", { title: "Calendar smoke task", due_at: Math.floor(Date.now() / 1000) + 600 });
  await page.goto("/calendar");
  await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
  await expect(page.getByText("Calendar smoke task").first()).toBeVisible();
  const feedLink = page.getByRole("link", { name: "Subscribe in Apple Calendar" });
  await expect(feedLink).toHaveAttribute("href", /^webcal:\/\/.+\/cal\/[A-Za-z0-9_-]+\.ics$/);
  const first = await feedLink.getAttribute("href");
  const path = new URL(first!.replace("webcal:", "http:")).pathname;
  expect((await page.request.get(path)).status()).toBe(200);
  await page.getByRole("button", { name: /Create a new link/ }).click();
  await expect(feedLink).not.toHaveAttribute("href", first!);
  expect((await page.request.get(path)).status()).toBe(404);
});

test("assistant: lists emails to review, opens one inside GRU, and chats about anything else", async ({ page }) => {
  await page.route("**/api/review", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { items: [{ id: 1, kind: "classify", accountId: 1, gmailId: "abc12345", appId: null, company: "Fonterra", appStatus: null, proposal: { class: "rejection", suggested: "rejected" }, context: { subject: "Update on your application", from: "Fonterra Careers" }, createdAt: 1, receivedAt: 1 }] } })
      : route.continue(),
  );
  await page.route("**/api/mail/view**", (route) =>
    route.fulfill({ json: { subject: "Update on your application", from: "Fonterra Careers <hr@fonterra.com>", date: 1794600000, class: "rejection", text: "We regret to inform you that we will not be moving forward.", meeting_link: null, body_access: true, gmail_url: "https://mail.google.com/mail/u/ani/#all/t1" } }),
  );
  let chatBody: { message: string; history: unknown[] } | null = null;
  await page.route("**/api/chat", async (route) => {
    chatBody = route.request().postDataJSON() as typeof chatBody;
    await route.fulfill({ json: { reply: "There is an Acme job that looks promising. Want me to open the calendar?", action: { type: "open_calendar" } } });
  });
  await login(page);
  await page.evaluate(() => localStorage.setItem("gru.voice.speak", "0"));
  await page.goto("/");
  await page.getByRole("button", { name: "Talk to GRU" }).click();
  const sheet = page.getByRole("dialog", { name: "Talk to GRU" });
  await sheet.getByLabel("Type to GRU").fill("what are my emails to review");
  await sheet.getByLabel("Type to GRU").press("Enter");
  await expect(sheet).toContainText("You have 1 email to review.");
  await expect(sheet).toContainText("Update on your application, from Fonterra Careers");
  await sheet.getByRole("button", { name: "Open email" }).click();
  const mail = page.getByRole("dialog", { name: "Email" });
  await expect(mail).toContainText("We regret to inform you");
  await expect(mail.getByRole("link", { name: /Open in Gmail/ })).toHaveAttribute("href", /mail\.google\.com/);
  await page.keyboard.press("Escape");

  await sheet.getByLabel("Type to GRU").fill("tell me something interesting");
  await sheet.getByLabel("Type to GRU").press("Enter");
  await expect(sheet).toContainText("There is an Acme job that looks promising.");
  expect(chatBody?.message).toBe("tell me something interesting");
  await sheet.getByRole("button", { name: "Open calendar" }).click();
  await expect(page).toHaveURL(/\/calendar$/);
});

test("Applications opens on 'Apply today' with good matches ready to apply; the rest keep their tabs and filters", async ({ page }) => {
  await login(page);
  await api(page, "/api/resume-profiles", { label: "Apply", text: "Graduate engineer in Auckland. BSc Computer Science. Python, SQL, PostgreSQL, Docker, Git and testing projects. Interested in data analysis and backend roles." });
  await api(page, "/api/jobs", { title: "Graduate Data Analyst Apply Today", company: "Acme Robotics", location: "Auckland", url: "https://www.seek.co.nz/job/99887766", description: "Graduate role in Auckland. Requirements: Python, SQL, PostgreSQL. Nice to have: Docker. Degree in computer science. ".repeat(3) });
  await api(page, "/api/jobs", { title: "Senior Truck Driver Not A Match", company: "Haulage", location: "London", url: "https://www.seek.co.nz/job/99887755", description: "Requirements: forklift licence, 10+ years driving. ".repeat(4) });
  await page.goto("/applications");
  await expect(page.getByRole("tab", { name: /Apply today/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Apply today", exact: true })).toBeVisible();
  const card = page.getByText("Graduate Data Analyst Apply Today").first();
  await expect(card).toBeVisible();
  await expect(page.getByRole("link", { name: /^Apply ↗$/ }).first()).toHaveAttribute("href", /seek\.co\.nz\/job\/99887766/);
  await expect(page.getByText("Senior Truck Driver Not A Match")).toHaveCount(0); // not a good match: not on today's list

  await page.getByRole("tab", { name: "Other jobs" }).click();
  await expect(page.getByText("Senior Truck Driver Not A Match").first()).toBeVisible(); // the rest, with filters
  await expect(page.getByLabel("Match")).toBeVisible();
  await page.getByRole("tab", { name: "My applications" }).click();
  await expect(page.getByRole("button", { name: "Add application", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Filter by status" })).toBeVisible();
});

test("each status has its own colour, and the banner changes when the status changes", async ({ page }) => {
  await login(page);
  const app = (await api(page, "/api/applications", { company: "Banner Test Ltd", role: "Engineer", status: "applied" })) as { id: number };
  await page.goto(`/applications/${app.id}?tab=tracked&status=all`);
  const banner = page.getByRole("status").filter({ hasText: "Applied" }).first();
  await expect(banner).toHaveAttribute("data-status", "applied");
  const colours: Record<string, string> = {};
  const read = (status: string) => page.locator(`[data-status="${status}"]`).first().evaluate((el) => getComputedStyle(el).backgroundColor);
  colours.applied = await read("applied");
  for (const status of ["assessment", "interview", "offer", "rejected", "declined", "withdrawn", "accepted"]) {
    await page.getByLabel("Change status").selectOption(status);
    await expect(page.locator(`[data-status="${status}"]`).first()).toBeVisible();
    await expect.poll(async () => (await read(status)) !== colours[Object.keys(colours).at(-1)!], { timeout: 5000 }).toBe(true); // the colour actually changed
    await page.waitForTimeout(650); // let the colour transition finish before reading
    colours[status] = await read(status);
  }
  expect(new Set(Object.values(colours)).size).toBe(Object.keys(colours).length); // all eight differ
});

test("Refresh: the button and pulling down both check Gmail now and reload what's on screen", async ({ page }) => {
  let syncs = 0;
  await page.route("**/api/sync", async (route) => {
    syncs++;
    await route.fulfill({ json: { ran: true, pending: 3 } });
  });
  await login(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /, Ani$/ })).toBeVisible();

  await page.getByRole("button", { name: "Refresh" }).first().click();
  await expect(page.getByText("Checked Gmail. 3 older emails are still being read in the background.")).toBeVisible();
  expect(syncs).toBe(1);

  const touch = (type: string, y: number) =>
    page.evaluate(([t, yy]) => {
      const touches = t === "touchend" ? [] : [new Touch({ identifier: 1, target: document.body, clientX: 120, clientY: yy as number })];
      window.dispatchEvent(new TouchEvent(t as string, { touches, bubbles: true, cancelable: true }));
    }, [type, y] as const);
  await touch("touchstart", 100);
  await touch("touchmove", 150);
  await expect(page.getByText("Pull to refresh")).toBeVisible();
  await touch("touchmove", 280);
  await expect(page.getByText("Release to refresh")).toBeVisible();
  await touch("touchend", 280);
  await expect.poll(() => syncs).toBe(2);

  // A short pull does nothing.
  await touch("touchstart", 100);
  await touch("touchmove", 140);
  await touch("touchend", 140);
  await page.waitForTimeout(400);
  expect(syncs).toBe(2);
});
