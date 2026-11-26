import { readFileSync } from "node:fs";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

import { demoApiPlugin } from "./demo/demoPlugin.ts";
import { staticHeadersPlugin } from "./headers/staticHeaders.ts";
import { createPwaOptions } from "./pwa/options.ts";
import { readPwaColors } from "./pwa/tokenColors.ts";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

/** Compile-time constants (declared in `src/env.d.ts`); shared with Vitest. */
export const appDefine: Record<string, string> = {
  __APP_VERSION__: JSON.stringify(pkg.version),
};

// `vite --mode demo` (`pnpm dev:demo`) serves synthetic demo data instead of the worker's API.
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA(createPwaOptions(readPwaColors())),
    // dist/_headers (CSP with the theme boot script hash, security headers), T-25.
    staticHeadersPlugin(),
    ...(mode === "demo" ? [demoApiPlugin()] : []),
  ],
  define: appDefine,
  server: { proxy: { "/api": "http://localhost:8787" } },
}));
