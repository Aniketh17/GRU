import { defineConfig, devices } from "@playwright/test";

// Run via `npm run e2e` (prepares .e2e/ credentials and a fresh local D1 first).
export default defineConfig({
  testDir: "test/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8788",
    timezoneId: "Pacific/Auckland",
    locale: "en-NZ",
    trace: "retain-on-failure",
    permissions: ["microphone"],
    launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: {
    command: "npx wrangler dev --port 8788 --ip 127.0.0.1 --persist-to .wrangler/e2e --env-file .e2e/e2e.env",
    url: "http://127.0.0.1:8788/login",
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
