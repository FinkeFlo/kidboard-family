import { defineConfig } from "@playwright/test";

const PORT = 4173;
const executablePath = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"];
/**
 * Device zone of every project. The board must follow the config zone (Europe/Berlin in
 * the fixtures, nine hours ahead) and never the device zone, so the device runs in a
 * non-UTC zone where most Berlin days start on the previous local date.
 */
const DEVICE_TIME_ZONE = "America/Los_Angeles";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"]
    ? [["list"], ["html", { open: "never" }]]
    : "list",
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    trace: "retain-on-failure",
    // `page.route()` does not see requests a service worker handles, so API mocks would be
    // bypassed. Specs opt in with `test.use({ serviceWorkers: "allow" })` (e2e/pwa.spec.ts).
    serviceWorkers: "block",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    {
      name: "tablet-1280x800",
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 800 },
        timezoneId: DEVICE_TIME_ZONE,
      },
    },
    {
      name: "tablet-2000x1200",
      use: {
        browserName: "chromium",
        viewport: { width: 2000, height: 1200 },
        timezoneId: DEVICE_TIME_ZONE,
      },
    },
  ],
  webServer: {
    command: `pnpm exec vite preview --host 127.0.0.1 --port ${String(PORT)} --strictPort`,
    url: `http://127.0.0.1:${String(PORT)}`,
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
  },
});
