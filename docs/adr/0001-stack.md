# ADR-0001: Application stack and repository layout

- Status: accepted
- Date: 2026-11-22

## Context
KidBoard is a small, long-running, read-only kiosk app plus a tiny server-side proxy.
It must be easy to self-host, run offline after first load, and be maintainable by
hobby contributors. Versions were checked on npm and APIs via Context7 on 2026-11-22.

## Options (per layer)

| Layer | Option | Notes | Verdict |
|---|---|---|---|
| UI framework | **React 19 + Vite 8** | largest ecosystem, Testing Library, vite-plugin-pwa | ✅ |
| | Svelte 5 / SvelteKit | smaller bundle, smaller contributor pool | – |
| | Preact | small, but React-ecosystem edge cases | – |
| Styling | **Tailwind CSS 4** (`@tailwindcss/vite`, CSS-first `@theme`) | tokens as CSS variables map 1:1 to the Claude Design hand-off | ✅ |
| | CSS Modules + vanilla-extract | more code for tokens | – |
| Server state | **TanStack Query 5** + `@tanstack/react-query-persist-client` | stale-while-revalidate, refetch on focus/reconnect, persisted offline cache | ✅ |
| | SWR | no first-party persistence | – |
| Validation | **zod 4** | config + API response validation in both apps | ✅ |
| | valibot | smaller, less known | – |
| Package manager | **pnpm 10 workspaces** | `apps/web`, `apps/worker`, `packages/shared` | ✅ |
| | npm workspaces | slower, weaker isolation | – |
| Language | **TypeScript 6.0.x, `strict`** | TS 7 (native) is out, but `typescript-eslint` 8 supports `<6.1` only → pin `~6.0` until supported | ✅ |
| Tests | **Vitest 5** + Testing Library + `@cloudflare/vitest-plugin` for the worker, **Playwright** for E2E/screenshots | | ✅ |
| Fonts | **Fontsource** `@fontsource-variable/nunito` (OFL-1.1, rounded, friendly) | self-hosted, offline-safe | ✅ |
| UI primitives | none in MVP (Radix/shadcn considered) | the UI has no menus/dialogs; revisit for parent mode (M8) | – |

Rejected for the worker: `node-ical` (Node-oriented, depends on Node built-ins).

## Decision
Vite + React + TypeScript + Tailwind 4 PWA (`apps/web`), Hono on Cloudflare Workers
(`apps/worker`), pure shared logic in `packages/shared`. Engineering docs in English,
user docs bilingual.

## Consequences
* Shared parsing logic is runtime-agnostic and testable in plain Vitest.
* ESLint is pinned to 9.x because `eslint-plugin-jsx-a11y` does not declare ESLint 10
  support yet; revisit via Dependabot.
* TypeScript pinned to `~6.0`; revisit when typescript-eslint supports 7.
