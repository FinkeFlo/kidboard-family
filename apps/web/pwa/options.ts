import type { ManifestOptions, VitePWAOptions } from "vite-plugin-pwa";

import type { PwaColors } from "./tokenColors";

/**
 * Web app manifest (ADR-0006). Name and description are brand text, not UI strings:
 * a manifest has no runtime locale switch and the installed app label is the brand
 * name in every language, so they stay static instead of going through i18n.
 */
export function createManifest(colors: PwaColors): Partial<ManifestOptions> {
  return {
    id: "/",
    name: "KidBoard",
    short_name: "KidBoard",
    description: "Icon-first family calendar and meal plan for a wall tablet.",
    start_url: "/",
    scope: "/",
    display: "fullscreen",
    orientation: "landscape",
    theme_color: colors.theme,
    background_color: colors.background,
    // Icons are generated from public/kidboard-icon.svg by `pwaAssets`
    // (pwa-assets.config.ts) and injected here at build time.
  };
}

/** vite-plugin-pwa options (generateSW, auto update, `/api/*` network only). */
export function createPwaOptions(colors: PwaColors): Partial<VitePWAOptions> {
  return {
    strategies: "generateSW",
    registerType: "autoUpdate",
    // Registered from src/pwa/registerServiceWorker.ts via `virtual:pwa-register`.
    injectRegister: false,
    manifest: createManifest(colors),
    pwaAssets: {
      config: true,
      overrideManifestIcons: true,
      includeHtmlHeadLinks: true,
      injectThemeColor: true,
    },
    workbox: {
      // Auto update without user interaction: a new worker activates at once and takes
      // over open pages. The plugin only forces these for `injectRegister: 'auto'`, so set
      // them explicitly (registration happens in src/pwa/registerServiceWorker.ts).
      skipWaiting: true,
      clientsClaim: true,
      // App shell: HTML, JS, CSS, self-hosted fonts and the generated icons.
      globPatterns: ["**/*.{html,js,css,woff2,svg,png,ico}"],
      cleanupOutdatedCaches: true,
      navigateFallback: "/index.html",
      // `/api/*` navigations (e.g. opening /api/health) must reach the worker, not the shell.
      navigateFallbackDenylist: [/^\/api\//],
      runtimeCaching: [
        {
          // TanStack Query owns API caching (ADR-0006); responses carry calendar data and
          // requests the bearer token, so the service worker must never store them.
          // Serialised into sw.js: keep the matcher self-contained (no outer references).
          urlPattern: ({ url, sameOrigin }) =>
            sameOrigin && url.pathname.startsWith("/api/"),
          handler: "NetworkOnly",
          method: "GET",
        },
      ],
    },
  };
}
