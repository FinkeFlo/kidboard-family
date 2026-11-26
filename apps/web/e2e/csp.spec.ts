import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { inlineScriptHashes } from "../headers/staticHeaders";
import { mockBoard, waitForServiceWorker } from "./mockApi";

/*
 * Production headers (T-25): `vite build` writes dist/_headers and `vite preview` sends
 * the same headers (headers/staticHeaders.ts), so every E2E spec runs under the CSP.
 * This spec checks the policy itself: the inline theme boot script is allowed by its
 * hash and the board loads without a single CSP violation.
 */

const BUILT_HTML = readFileSync(
  new URL("../dist/index.html", import.meta.url),
  "utf8",
);

declare global {
  interface Window {
    __cspViolations?: string[];
    __firstTheme?: string | null;
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspViolations?.push(
        `${event.violatedDirective} ${event.blockedURI}`,
      );
    });
    // First value of <html data-theme>: the boot script sets it before any module runs.
    // Init scripts run before <html> exists, so observe the whole document.
    const observer = new MutationObserver((records) => {
      const target = records[0]?.target;
      if (target instanceof Element) {
        window.__firstTheme = target.getAttribute("data-theme");
        observer.disconnect();
      }
    });
    observer.observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  });
});

test("serves the CSP and security headers on the app shell", async ({
  page,
}) => {
  await mockBoard(page);
  const response = await page.goto("/");
  const headers = response?.headers() ?? {};
  const csp = headers["content-security-policy"] ?? "";

  const hashes = inlineScriptHashes(BUILT_HTML);
  expect(hashes).toHaveLength(1);
  expect(csp).toContain(`script-src 'self' ${hashes[0] ?? ""}`);
  expect(csp).not.toContain("unsafe-");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("no-referrer");
});

test("runs the inline theme boot script and loads without CSP violations", async ({
  page,
}) => {
  // The board last ran at night; at noon (fixed clock) the app itself switches to light.
  await page.addInitScript(() => {
    window.localStorage.setItem("kidboard.theme", "night");
  });
  await mockBoard(page);
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "Sunday" }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.__firstTheme)).toBe("night");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  // Fonts, styles, manifest and icons are all same-origin.
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
});

test.describe("with the service worker", () => {
  test.use({ serviceWorkers: "allow" });

  test("registers the service worker under the CSP", async ({ page }) => {
    await mockBoard(page, { via: "context" });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "Sunday" }),
    ).toBeVisible();
    expect(await waitForServiceWorker(page)).toMatch(/\/sw\.js$/);
    expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
  });
});
