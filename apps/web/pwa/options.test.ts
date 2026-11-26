// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { RuntimeCaching } from "workbox-build";

import { createManifest, createPwaOptions } from "./options";

const colors = { background: "#fbf6ee", theme: "#a63a08" };
const ORIGIN = "https://kidboard.example";

type Matcher = (context: { url: URL; sameOrigin: boolean }) => boolean;

function apiRoute(): RuntimeCaching {
  const routes = createPwaOptions(colors).workbox?.runtimeCaching ?? [];
  expect(routes).toHaveLength(1);
  const [route] = routes;
  if (!route) throw new Error("no runtime route");
  return route;
}

function matches(path: string, origin = ORIGIN): boolean {
  const pattern = apiRoute().urlPattern;
  if (typeof pattern !== "function") throw new Error("expected a matcher");
  const url = new URL(path, origin);
  return (pattern as unknown as Matcher)({
    url,
    sameOrigin: url.origin === ORIGIN,
  });
}

describe("createManifest", () => {
  it("describes an installable fullscreen landscape app with token colours", () => {
    expect(createManifest(colors)).toMatchObject({
      name: "KidBoard",
      short_name: "KidBoard",
      start_url: "/",
      scope: "/",
      display: "fullscreen",
      orientation: "landscape",
      theme_color: "#a63a08",
      background_color: "#fbf6ee",
    });
  });

  it("leaves the icons to the assets generator", () => {
    expect(createManifest(colors)).not.toHaveProperty("icons");
    const { pwaAssets } = createPwaOptions(colors);
    expect(pwaAssets).toMatchObject({
      config: true,
      overrideManifestIcons: true,
    });
  });
});

describe("createPwaOptions", () => {
  it("uses generateSW with automatic updates", () => {
    expect(createPwaOptions(colors)).toMatchObject({
      strategies: "generateSW",
      registerType: "autoUpdate",
      workbox: { skipWaiting: true, clientsClaim: true },
    });
  });

  it("precaches the app shell, fonts and icons", () => {
    const patterns = createPwaOptions(colors).workbox?.globPatterns ?? [];
    for (const ext of ["html", "js", "css", "woff2", "png", "svg", "ico"]) {
      expect(patterns.join(",")).toContain(ext);
    }
  });

  it("routes same-origin /api/* through the network only", () => {
    expect(apiRoute().handler).toBe("NetworkOnly");
    expect(matches("/api/config")).toBe(true);
    expect(matches("/api/agenda?from=2026-01-01&to=2026-01-02")).toBe(true);
    expect(matches("/")).toBe(false);
    expect(matches("/apiary")).toBe(false);
    expect(matches("/assets/api/x.js")).toBe(false);
    expect(matches("/api/config", "https://other.example")).toBe(false);
  });

  it("keeps /api/* navigations away from the SPA fallback", () => {
    const { navigateFallback, navigateFallbackDenylist = [] } =
      createPwaOptions(colors).workbox ?? {};
    expect(navigateFallback).toBe("/index.html");
    const denied = (path: string): boolean =>
      navigateFallbackDenylist.some((re) => re.test(path));
    expect(denied("/api/health")).toBe(true);
    expect(denied("/api/")).toBe(true);
    expect(denied("/")).toBe(false);
    expect(denied("/week")).toBe(false);
    expect(denied("/apiary")).toBe(false);
  });
});
