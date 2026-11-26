import { defineConfig } from "@playwright/test";

/**
 * Screenshot run (`pnpm screenshots`), kept apart from `pnpm test:e2e` so the regular
 * E2E run never rewrites files under `docs/screenshots/`. It serves the built app
 * (`pnpm build` first), pins the clock and burn-in offset in the spec, and turns
 * animations and transitions off (reduced motion), so the PNGs are reproducible.
 */
const PORT = 4174;
const executablePath = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"];
/** Same non-UTC device zone as the E2E projects: the board follows the config zone. */
const DEVICE_TIME_ZONE = "America/Los_Angeles";

export default defineConfig({
  testDir: "./screenshots",
  outputDir: "./test-results/screenshots",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    serviceWorkers: "block",
    reducedMotion: "reduce",
    colorScheme: "light",
    locale: "en-US",
    deviceScaleFactor: 1,
    launchOptions: {
      // One raster thread and no partial raster: with several, the anti-aliased seams of
      // rounded rectangles differ by a pixel from run to run, so the PNGs would not be
      // reproducible byte for byte.
      args: ["--num-raster-threads=1", "--disable-partial-raster"],
      ...(executablePath ? { executablePath } : {}),
    },
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
