import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import {
  agenda,
  fixClock,
  persistedTitles,
  waitForServiceWorker,
} from "./mockApi";

/** Low-entropy synthetic token (gitleaks-friendly). */
const TOKEN = "TESTONLY-not-a-secret";

const CONFIG = {
  locale: "en",
  timeZone: "Europe/Berlin",
  calendars: [{ id: "family", kind: "events" }],
};
const AGENDA = agenda([{ title: "Swimming", icon: "🏊", time: "15:00" }], []);

interface ManifestIcon {
  src: string;
  sizes: string;
  type?: string;
  purpose?: string;
}

interface Manifest {
  name?: string;
  short_name?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  orientation?: string;
  theme_color?: string;
  background_color?: string;
  icons?: ManifestIcon[];
}

test.use({ serviceWorkers: "allow" });

/**
 * Mock the API on the context: with a service worker in control, page requests to
 * `/api/*` are re-issued by the worker (`NetworkOnly`) and only `context.route()` sees
 * those. Records every API URL the page or the worker requested.
 */
async function mockApi(context: BrowserContext): Promise<string[]> {
  const seen: string[] = [];
  await context.route("**/api/**", (route) => {
    const url = route.request().url();
    seen.push(url);
    switch (new URL(url).pathname) {
      case "/api/config":
        return route.fulfill({ json: CONFIG });
      case "/api/agenda":
        return route.fulfill({ json: AGENDA });
      case "/api/health":
        return route.fulfill({ json: { ok: true } });
      default:
        return route.fulfill({ status: 404, json: { error: "not_found" } });
    }
  });
  return seen;
}

/** Every URL stored in any Cache Storage cache of the origin. */
async function cachedUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        urls.push(request.url);
      }
    }
    return urls;
  });
}

test("is installable: manifest with token colours and icons, active service worker", async ({
  page,
  context,
}) => {
  await mockApi(context);
  // Midday clock: the token comparison below expects the light (day) theme.
  await fixClock(page);
  await page.goto("/");

  const manifestHref = await page
    .locator('link[rel="manifest"]')
    .getAttribute("href");
  expect(manifestHref).toBeTruthy();
  const manifestUrl = new URL(manifestHref ?? "", page.url());
  const manifestResponse = await page.request.get(manifestUrl.href);
  expect(manifestResponse.ok()).toBe(true);
  const manifest = (await manifestResponse.json()) as Manifest;

  expect(manifest).toMatchObject({
    name: "KidBoard",
    short_name: "KidBoard",
    start_url: "/",
    scope: "/",
    display: "fullscreen",
    orientation: "landscape",
  });

  // Colours come from the design tokens (light theme, emitted on :root).
  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      surface: style.getPropertyValue("--color-surface").trim().toLowerCase(),
      accent: style.getPropertyValue("--color-accent").trim().toLowerCase(),
    };
  });
  expect(manifest.background_color).toBe(tokens.surface);
  expect(manifest.theme_color).toBe(tokens.accent);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    tokens.accent,
  );

  // Installability needs a 192 and a 512 icon; Android needs a maskable one.
  const icons = manifest.icons ?? [];
  const anyIcons = icons.filter(
    (icon) => !icon.purpose || icon.purpose === "any",
  );
  expect(anyIcons.map((icon) => icon.sizes)).toEqual(
    expect.arrayContaining(["192x192", "512x512"]),
  );
  expect(
    icons.some(
      (icon) => icon.purpose === "maskable" && icon.sizes === "512x512",
    ),
  ).toBe(true);
  for (const icon of icons) {
    const response = await page.request.get(
      new URL(icon.src, manifestUrl).href,
    );
    expect(response.ok(), icon.src).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/png");
  }

  const scriptUrl = await waitForServiceWorker(page);
  expect(new URL(scriptUrl).pathname).toBe("/sw.js");
  expect(
    await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistration())?.scope,
    ),
  ).toBe(new URL("/", page.url()).href);
});

test("loads the app shell offline after the first visit and never caches API or token", async ({
  page,
  context,
}) => {
  const apiRequests = await mockApi(context);
  await fixClock(page);
  await page.goto(`/?key=${TOKEN}`);
  await expect(page.getByRole("article", { name: "Swimming" })).toBeVisible();
  await waitForServiceWorker(page);

  // An API call made while the worker is in control goes through it to the network.
  const apiStatus = await page.evaluate(async () => {
    const response = await fetch("/api/config");
    return response.status;
  });
  expect(apiStatus).toBe(200);
  expect(
    apiRequests.some((url) => new URL(url).pathname === "/api/config"),
  ).toBe(true);

  // API navigations bypass the SPA fallback: the worker answers, not the cached shell.
  await page.goto("/api/health");
  await expect(page.locator("body")).toContainText('"ok":true');
  await expect(page.getByRole("main")).toHaveCount(0);
  await page.goto("/");
  await waitForServiceWorker(page);

  const stored = await cachedUrls(page);
  expect(stored.length).toBeGreaterThan(0);
  expect(stored.some((url) => new URL(url).pathname.endsWith(".woff2"))).toBe(
    true,
  );
  expect(
    stored.filter((url) => new URL(url).pathname.startsWith("/api/")),
  ).toEqual([]);
  expect(
    stored.filter((url) => url.includes(TOKEN) || url.includes("key=")),
  ).toEqual([]);

  // The persister saves throttled: wait until the agenda is stored before going offline
  // (every page load refetches once, so the save may come a moment later).
  await expect.poll(() => persistedTitles(page)).toContain("Swimming");
  await context.setOffline(true);
  await page.reload();
  // The cached shell renders the persisted day with the discreet offline hint.
  await expect(page.getByRole("article", { name: "Swimming" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Offline");
  const offlineStyle = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      online: navigator.onLine,
      nunito: document.fonts.check('16px "Nunito Variable"'),
    };
  });
  expect(offlineStyle).toEqual({ online: false, nunito: true });

  // Deep links fall back to the cached shell as well.
  await page.goto("/some/deep/link");
  await expect(page.getByRole("article", { name: "Swimming" })).toBeVisible();

  const storedAfter = await cachedUrls(page);
  expect(
    storedAfter.filter(
      (url) =>
        new URL(url).pathname.startsWith("/api/") || url.includes("key="),
    ),
  ).toEqual([]);
});
