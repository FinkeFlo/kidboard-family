# ADR-0006: Caching and offline strategy

- Status: accepted
- Date: 2026-11-22

## Context
~1 h staleness is fine. The tablet must keep showing the last state when Wi-Fi or Google
fails, and say so discreetly.

## Options
* Worker: Cache API only / Cache API + KV / KV only. KV used to need an extra namespace
  (account step) for every self-hoster; Wrangler now auto-provisions id-less KV bindings
  on deploy.
* Client: Workbox runtime caching of `/api/*` vs TanStack Query persistence vs both.

## Decision
* **Worker:** per source, store the normalized result for a fixed rolling window
  (`[today − 1, today + 32)`) as one entry, kept 7 days. It is *fresh* while it matches
  the current window and is younger than `KIDBOARD_CACHE_TTL` (default 3600 s); after
  that it is the *last-good* entry. If the upstream fetch fails or the feed is broken,
  serve last-good and mark the source `stale` (and `AgendaResponse.stale = true`).
* **Worker storage backend** (revised in T-10): the Cache API is a no-op on
  `*.workers.dev` (functional only on custom domains), which is the default for
  one-click deploys. Therefore a **Workers KV** binding `KIDBOARD_CACHE` is declared in
  `wrangler.jsonc` *without an id*: Wrangler provisions it automatically on deploy
  (also for dashboard/Git deploys; there the id is only visible in the dashboard) and
  `wrangler dev` / the vitest plugin use a local namespace. When the binding is absent
  the worker falls back to the Cache API. A per-isolate memory map sits in front of
  either backend; concurrent misses share one upstream fetch.
* **KV quota:** the Free plan allows 1 000 writes/day. One write per source per
  refresh, so the fresh TTL is raised to at least `ceil(sources × 86 400 / 500)` s
  (budget 500 writes/day, leaving room for day rollovers and concurrent refreshes in
  other data centers). Failed writes are logged and do not fail the request.
  *Amended by ADR-0015:* while weather is on, its 49 writes/day (48 forecasts + the
  geocoded place) are reserved first, so the floor becomes
  `ceil(sources × 86 400 / (500 − 49))` s.
* **Client:** TanStack Query with `PersistQueryClientProvider` +
  `createAsyncStoragePersister({ storage: window.localStorage })`, `gcTime`/`maxAge`
  7 days, `staleTime` 15 min, `refetchInterval` 60 min, refetch on window focus and
  reconnect, extra refetch after midnight. Persisted data is versioned (`buster` = app
  version + schema version).
* **Client details** (T-13, `apps/web/src/data/`):
  * `refetchInterval` = `config.refreshMinutes` (60 min until the config is known).
    Midnight: the view derives `range.from` from "today" in the config zone (T-16); a
    new day is a new query key and fetches by itself. Until that fetch succeeds the new
    query is seeded (`initialData`, marked outdated with `dataUpdatedAt` 0, never
    persisted) from a cached agenda covering the new day, re-scoped to the new range,
    so offline or on a 502 the status stays `offline`/`stale` instead of empty or
    `loading`. Only real responses younger than 7 days are used as a source (never an
    earlier seed). A seeded agenda (`dataUpdatedAt` 0) or one that ends before
    `from + days` of its query key is `stale`, never `ready`, until the real response
    lands, also while that fetch is in flight (details: ARCHITECTURE.md "Clock & day
    rollover").
  * Every page load refetches once: after the persisted cache is restored, all KidBoard
    queries are marked outdated (`invalidateRestoredQueries`, TanStack `invalidate`
    without an immediate refetch), so they fetch when the board mounts even if the
    restored data is younger than `staleTime`. Otherwise a reload while the API is
    unreachable showed the restored data as current with no hint (T-27a UI/UX test). The
    restored `dataUpdatedAt` stays the "Stand" time; a failed refetch keeps the data and
    shows "Can't update · as of …" (offline: the fetch waits, the status is `offline`).
  * Requests time out after 15 s (headers + body). The worker needs up to ~11 s (10 s
    upstream timeout + 1 s flight margin) before it answers with last-good data, so a
    slow upstream still delivers stale data. Network/timeout/5xx/429 errors are retried
    twice; 400, 401, other 4xx and schema-invalid responses are not.
  * Every response is validated with the shared zod schemas. A schema-invalid body and
    **502** (all sources failed; its body has no events) are errors: the query keeps its
    previous data.
  * **401** is not an outage: the token was revoked or is wrong. Every KidBoard query
    drops its data (status `error`, `useApiErrorKind()` = `unauthorized`), so the
    persister writes an empty cache and a revoked device stops showing calendar data,
    and the stored token is forgotten (a new `?key=` link is needed anyway; keeping a
    dead token would only produce more 401s). In-flight fetches of those queries are cancelled
    without `revert` before the wipe: TanStack reverts a fetch cancelled because its
    last observer left (the wiped config turns the agenda into the pending query) to the
    state from before the fetch, which would bring the wiped data back into memory and
    storage (found by the T-23 e2e test). The persister stores every KidBoard query **with data**,
    also after a failed refetch (TanStack's default persists `success` only, which would
    wipe the last-good agenda on the first 502). Stored queries are reduced to their data
    (no error objects); on restore each query is re-validated and dropped if invalid.
    `maxAge` only checks the client timestamp (refreshed by every save), so each query
    is additionally dropped on save and on restore once its `dataUpdatedAt` is older
    than 7 days (old agenda keys do not pile up). On save an agenda is also dropped
    when a later-fetched one reaches at least as far (`range.to`): seeding always picks
    the most recently fetched covering agenda, so the older one could only serve days
    before the newer one's `from`, which the board never asks for again. With the 31-day
    range (T-19) a kiosk would otherwise store up to eight overlapping month-long agendas;
    one busy month (12 events and 3 meals a day) is about 110 KB of JSON.
  * Connection status (`useConnectionStatus`), first match wins: restoring → `loading`;
    a query in use without data: failed → `error`, offline → `offline`, else `loading`;
    offline → `offline`; failed refetch, `AgendaResponse.stale`, any
    `sources[].status === "error"`, or an incomplete agenda (midnight seed, or
    `range.to` before `from + days`) → `stale`; else `ready`. The banner shows
    `stale` only after it has lasted 5 s (`STALE_BANNER_DELAY_MS`): online, every
    midnight is `stale` for a moment until the new day's fetch lands, which must not
    flash; `offline`, `error` and `unauthorized` show at once. "Offline" is
    `onlineManager`, seeded from `navigator.onLine` at startup and then driven by
    `online`/`offline` events.
  * The optional access token is taken once from `?key=`, stored under its own
    localStorage key (never in a query key or the persisted cache), removed from the
    visible URL with `history.replaceState`, and sent as `Authorization: Bearer`.
  * localStorage unusable (blocked, quota 0, `null` in WebViews): persistence is off,
    the token lives in memory for the session, the app keeps working online.
* **Service worker:** vite-plugin-pwa `generateSW`, precache the app shell only, `/api/*`
  is `NetworkOnly` in the SW (TanStack owns API caching → no double caching), auto update.
* **Service worker details** (T-14, `apps/web/pwa/`, `apps/web/src/pwa/`):
  * Precache (Workbox `globPatterns`): `html, js, css, woff2, svg, png, ico`, i.e. the
    app shell, all self-hosted Nunito subsets (~140 KB) and the generated icons. No
    runtime caches exist; `cleanupOutdatedCaches` drops precaches of older builds.
  * Navigations are served from the precached `index.html` (`navigateFallback`), except
    `/api/*` (`navigateFallbackDenylist`), which always reaches the worker. Same-origin
    `GET /api/*` fetches use `NetworkOnly`.
  * Access token: the precache only stores the build's own URLs, fetched by the SW at
    install time without query string, so a `/?key=…` navigation is never written to
    Cache Storage (it is answered from the cached `index.html`). `consumeAccessToken`
    still strips `?key=` from the URL before the SW is registered. API requests carry
    the token as a header and are never cached by the SW. The E2E test checks every
    Cache Storage URL for `/api/` and `key=`.
  * Auto update on a kiosk without user interaction: `skipWaiting` + `clientsClaim`
    (set explicitly, the plugin only forces them with `injectRegister: 'auto'`), and
    `virtual:pwa-register` reloads the page when an updated worker activates. Browsers
    look for a new `sw.js` only on navigations (a wall tablet never navigates), so the
    app probes `sw.js` with `cache: 'no-store'` every hour and calls
    `registration.update()` (skipped offline or while installing). The reload is
    harmless: the query cache and the token are persisted.
  * No SW in `vite dev` (`devOptions` off). E2E specs that mock `/api` block service
    workers (`page.route` cannot see SW-handled requests); `e2e/pwa.spec.ts` allows
    them and mocks on the context.
  * HTTP caching on Workers Static Assets: the defaults (`Cache-Control: public,
    max-age=0, must-revalidate` + `ETag`, re-checked against the Cloudflare docs and
    `wrangler dev` in T-25) are right for `sw.js`, `manifest.webmanifest` and
    `index.html`, so Cache-Control is not overridden. The generated `dist/_headers` (T-25)
    only adds security headers (CSP etc., ARCHITECTURE.md "Deploy & static headers").
    Browsers also bypass the HTTP cache for the SW script itself (`updateViaCache:
    'imports'`). `_headers` does not apply to `/api/*` (`run_worker_first`, the worker
    sets its own headers).
* **Manifest and icons:** `theme_color` = `--color-accent`, `background_color` =
  `--color-surface`, parsed from the light `@theme static` block of `tokens.css` at
  build time (single source; unit-tested). Icons are generated during `vite build` by
  `@vite-pwa/assets-generator` (`minimal-2023` preset: 64/192/512 any, 512 maskable,
  180 Apple, 48 favicon; maskable/Apple padding in the accent colour) from the original
  artwork `public/kidboard-icon.svg`, whose colours must all be light tokens (unit test).
  Generated PNGs are build output, not committed. Name/description are static brand text
  (a manifest cannot follow the runtime locale).

## Consequences
* Offline after first successful load; indicator driven by `navigator.onLine`, query
  error state and `stale` flag.
* KV is eventually consistent (reads may lag up to ~60 s in other locations); an
  isolate that reads an older entry just refreshes once more.
* An old last-good entry covers its own window only, so after several days of failures
  it may cover just part of the requested range.
