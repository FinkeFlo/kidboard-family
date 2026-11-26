# ADR-0002: Hosting – one Cloudflare Worker with static assets

- Status: accepted
- Date: 2026-11-22

## Context
Frontend and iCal proxy should live on one platform, be free for a family, deployable
with one click, and keep the iCal secrets server-side.

## Options
1. **Cloudflare Workers + Static Assets** – Cloudflare's docs (Context7,
   "Workers best practices") recommend Workers Static Assets over Pages for new
   projects. One Worker serves `apps/web/dist` with
   `not_found_handling: "single-page-application"` and runs first for `/api/*`
   (`run_worker_first`). Free tier is ample; Cache API available; secrets via
   `wrangler secret put`. Deploy-to-Cloudflare button supported.
2. Cloudflare Pages + Pages Functions – still works, but no longer where new features land.
3. Vercel (static + Edge Function) – good DX; Hono has a Vercel adapter.

## Decision
Option 1 as the default. Option 3 is documented and supported through a thin adapter
(`apps/worker/src/vercel.ts`, task T-26) using the same Hono app.

## Consequences
* Same-origin API → no CORS needed in production; CORS is restricted to configured
  origins (dev server) only.
* Cache API is per data center and evictable; the client keeps its own persisted copy
  (ADR-0006).
* The Workers Cache API only works on custom domains, not on `*.workers.dev`. The
  source cache therefore uses an auto-provisioned KV namespace (`KIDBOARD_CACHE`,
  declared without an id in `wrangler.jsonc`) and falls back to the Cache API when the
  binding is missing (ADR-0006).
* "Deploy to Cloudflare" only supports monorepos whose app is fully isolated in the
  linked subdirectory; the worker needs `packages/shared` and `apps/web`. The button
  therefore links the repository root, and the single `wrangler.jsonc` lives there
  (T-25, docs/DEPLOY.md). Workers Builds runs the root `build` script (web before
  worker) and `npx wrangler deploy` with the root's pinned `wrangler`.
