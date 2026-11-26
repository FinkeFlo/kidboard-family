# KidBoard – Plan

This plan is binding (see `CLAUDE.md`). Tasks are worked in order. Changes only via an
entry in the change log at the bottom and a dedicated `docs(plan): …` commit.

Risk drives model choice: **low/medium → Sonnet builder/reviewer, high → Opus
builder/reviewer** (`builder-opus` / `reviewer-opus`).

## Goal

Children aged ~3–8 (many cannot read yet) see on a wall tablet, at a glance from 1–3 m,
what happens today and in the next days and what there is to eat. Parents maintain
everything in Google Calendar. Icons first, text second. Calm, warm, robust in kiosk
operation, works offline with the last known state.

## Non-goals (MVP)

* Writing to Google Calendar and Google OAuth (app entries are stored by KidBoard itself,
  M11 / ADR-0014; an optional Google sync is a later idea, ADR-0012).
* Accounts, multi-family hosting. (The family's own D1 database stores app entries, M11.)
* Copying anything from third-party products (texts, graphics, names, layouts).
* Routines (→ M7+). Weather: M9. (Parent PIN for the editor: M11 / ADR-0013.)
* Portrait layout and phones (should not break, but not designed for).

## Definition of Done (every task)

* All acceptance criteria demonstrably met; reviewer verdict `PASS`.
* `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` green locally.
* New/changed behavior covered by meaningful tests. No skipped tests, no disabled lint
  rules, no `any` without a justifying comment.
* All UI strings via i18n (DE + EN). No secrets anywhere in the repo.
* Docs touched where behavior is user-visible.

---

## M0 – Repository setup

- [x] **T-00 Planning & agent setup** (risk: medium) – `docs/PLAN.md`, `docs/ARCHITECTURE.md`,
  ADRs 0001–0009, `docs/PROGRESS.md`, `CLAUDE.md`, `.claude/agents/*`, `.claude/settings.json`.
  *Done by orchestrator (Opus) in Phase 0.*

- [x] **T-01 Workspace scaffold** (risk: medium, deps: T-00)
  Goal: pnpm monorepo with `apps/web`, `apps/worker`, `packages/shared` that builds.
  Acceptance:
  1. Root `package.json` with `packageManager: pnpm@10.x`, `engines.node`, scripts
     `dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`, `format`, `format:check`;
     `pnpm-workspace.yaml`; `.nvmrc` + `.node-version` (Node 22 LTS).
  2. `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`,
     `exactOptionalPropertyTypes`, `verbatimModuleSyntax`; per-package tsconfigs; root
     `typecheck` covers all packages.
  3. `packages/shared` exports a placeholder (e.g. `APP_NAME`) consumed by both apps.
  4. `apps/web`: Vite + React 19 + TS renders a placeholder page; `pnpm build` emits
     `apps/web/dist`.
  5. `apps/worker`: Hono app with `GET /api/health` → `{ ok: true }`; `wrangler.jsonc` with
     static assets pointing at `../web/dist`, `not_found_handling: "single-page-application"`,
     `run_worker_first: ["/api/*"]`; `wrangler deploy --dry-run` succeeds.
  6. `.gitignore` covers `node_modules`, `dist`, `.wrangler`, `.env*` except `.env.example`,
     `.dev.vars*` except `.dev.vars.example`, Playwright output.

- [x] **T-02 Lint, format, git hooks** (risk: low, deps: T-01)
  Acceptance:
  1. ESLint 9 flat config per ADR-0007 incl. `react/no-danger` as error; `pnpm lint` green.
  2. Prettier + Tailwind plugin; `pnpm format:check` green; `.editorconfig`.
  3. lefthook: pre-commit runs Prettier + ESLint on staged files; commit-msg runs commitlint
     (conventional). Installed via `prepare` script; documented in CONTRIBUTING later.
  4. A deliberately bad commit message is rejected (shown in review via
     `pnpm exec commitlint` on a sample).

- [x] **T-03 Test setup** (risk: low, deps: T-01)
  Acceptance:
  1. Vitest projects for `shared` (node), `web` (jsdom + Testing Library + jest-dom
     matchers), `worker` (`@cloudflare/vitest-plugin`). `pnpm test` runs all.
  2. One real test per package (not just `expect(true)`).
  3. Playwright config (Chromium; projects `tablet-1280x800`, `tablet-2000x1200`) starting
     the built app via `vite preview` with API mocked by route interception; one smoke
     test asserting the placeholder page renders. `pnpm test:e2e` runs it.
  4. `fixtures/ics/` with synthetic `.ics` files (README states: synthetic only, never real
     URLs or personal data).

- [x] **T-04 CI, release, dependency updates** (risk: high, deps: T-02, T-03)
  Acceptance:
  1. `.github/workflows/ci.yml` on push/PR to `main`: checkout, pnpm setup, Node from
     `.nvmrc`, install with cache (`--frozen-lockfile`), lint, format:check, typecheck,
     test, build, Playwright smoke (install Chromium with deps), upload Playwright report on
     failure. Minimal `permissions`.
  2. Secret scan job with gitleaks (full history checkout) + `.gitleaks.toml` allowlisting
     nothing but fixtures paths if necessary.
  3. All third-party actions pinned to full commit SHAs with `# vX.Y.Z` comments.
  4. release-please workflow + config/manifest (`release-type: node`, root package) →
     `CHANGELOG.md` on release.
  5. `.github/dependabot.yml`: npm + github-actions, weekly, grouped.
  6. CI run on GitHub for the pushed commit is green.

- [x] **T-05 Community & config files** (risk: low, deps: T-01)
  Acceptance:
  1. `LICENSE` (MIT, © 2026 FinkeFlo), `README.md` (EN) + `README.de.md` (DE) skeleton with
     language switch links, feature list, screenshot placeholders, sections stubbed for
     setup/deploy/kiosk (filled in T-27).
  2. `CONTRIBUTING.md` (EN + DE section), `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1),
     `SECURITY.md` (private reporting via GitHub Security Advisories).
  3. `.github/ISSUE_TEMPLATE/` bug + feature as **Issue Forms** (YAML) with DE/EN labels,
     `config.yml`; `.github/pull_request_template.md`; `.github/CODEOWNERS` (`* @FinkeFlo`).
  4. `.env.example` / `apps/worker/.dev.vars.example` and `config.example.json` with every
     option described (comments via accompanying `docs/CONFIG.md` since JSON has no comments).
  5. `docs/design/README.md` explaining the Claude Design hand-off (tokens, screens).

**M0 exit:** empty skeleton green locally and in CI; milestone review by `reviewer-opus`.

## M1 – Worker + iCal parsing

- [x] **T-06 Shared data model & config schema** (risk: medium, deps: M0)
  Acceptance:
  1. Types + zod schemas for `Child`, `CalendarSource`, `CalendarEvent`, `Meal`,
     `AgendaResponse`, `AppConfig` in `packages/shared` exactly as in ARCHITECTURE.md
     (TS types inferred from or checked against schemas).
  2. `AppConfig`: `locale` (`de` | `en` | `auto`), `timeZone` (validated IANA name via
     `Intl.supportedValuesOf` or `Intl.DateTimeFormat` probe), `children[]` (≥ 0, unique ids,
     color, avatar), `calendars[]` (unique ids, kind, optional `childId` referencing a child),
     `bands` (`morningStart`, `middayStart`, `eveningStart`, `HH:mm`, ascending),
     `nightMode` (`enabled`, `start`, `end`), `countdown.emojis`, `refreshMinutes`,
     `autoReturnSeconds` (default 120).
     Sensible defaults for everything except `calendars`.
  3. `parseConfig(json)` returns typed config or a readable error list; unit tests for
     valid/invalid examples; `config.example.json` validates in a test.
  4. Public config DTO excludes nothing secret (URLs are not part of the config at all).

- [x] **T-07 Title parser** (risk: medium, deps: T-06)
  Acceptance: pure `parseTitle(raw, { kind, children, countdownEmojis, description })`
  implementing ARCHITECTURE.md rules 1–6, with table-driven tests for at least:
  1. simple leading emoji (`⚽ Fußball`), emoji without space (`⚽Fußball`);
  2. ZWJ sequence 👨‍👩‍👧, skin tone 👋🏽, flag 🇩🇪, keycap 1️⃣, emoji with VS16 ☀️;
  3. emoji not at start stays in title; text-only symbols (`©`, digits) are not icons;
  4. `Name:` prefix (case-insensitive, umlauts e.g. `Jürgen:`), multiple names
     (`Mia, Ben:` / `Mia + Ben:`), `Alle:`/`All:`, unknown prefix untouched;
  5. meal prefixes DE + EN incl. `Mittagessen:`, `Abendessen:`, case-insensitive;
     prefix + emoji combos in either order (`Mittag: 🍝 Spaghetti`, `🍝 Mittag: Spaghetti`);
  6. fallback icons from keyword table (DE + EN) and default fallback;
  7. countdown flag via emoji list and `#countdown` in description;
  8. empty/whitespace-only titles → localized-neutral placeholder flag, not a crash;
  9. HTML-looking titles (`<img src=x onerror=…>`) are returned verbatim as text.

- [x] **T-08 iCal parsing & recurrence expansion** (risk: **high** → Opus, deps: T-06)
  Goal: `expandCalendar(icsText, { from, to, timeZone })` → occurrences
  (`uid`, `recurrenceId`, `summary`, `description`, `start`, `end`, `allDay`).
  Acceptance (each with a synthetic fixture in `fixtures/ics/`):
  1. single timed event; all-day single day; all-day multi-day (exclusive DTEND);
     timed event spanning midnight;
  2. weekly RRULE with EXDATE; RRULE with COUNT and UNTIL; RDATE;
  3. moved single occurrence via RECURRENCE-ID (new time, and moved to another day);
     cancelled occurrence (`STATUS:CANCELLED` override) is dropped;
  4. DST: weekly 08:00 Europe/Berlin event across last Sunday in March and October keeps
     08:00 local; event at 02:30 on spring-forward day handled deterministically;
  5. TZID from feed VTIMEZONE; UTC (`Z`) times; floating times interpreted in config zone;
     event in another zone (America/New_York) converted correctly;
  6. only occurrences overlapping `[from, to)` returned; iteration cap prevents runaway
     rules (test with an unbounded `FREQ=MINUTELY`… capped, no hang);
  7. empty VCALENDAR → `[]`; malformed/non-ICS input → typed `FeedParseError`, no throw
     leaks raw content;
  8. works inside the Workers runtime (test runs in `@cloudflare/vitest-plugin`); fixtures are
     loaded via Vite `?raw` imports (no `fs` in workerd) with an ambient module declaration.

- [x] **T-09 Normalization** (risk: medium, deps: T-07, T-08)
  Acceptance:
  1. `normalize(occurrences, source, config)` → `CalendarEvent[]` / `Meal[]` using the title
     parser; `childIds` from source `childId` ∪ title prefix.
  2. Meals: all-day events in `meals` sources; multi-day meal events produce one `Meal` per
     day; timed meal events are assigned to a slot by band times if no prefix.
  3. Stable ids (hash of source, uid, recurrence id) – identical across runs.
  4. Output sorted (all-day first, then by start, then title) and validated against the zod
     schema in tests.

- [x] **T-10 Worker API** (risk: **high** → Opus, deps: T-09)
  Acceptance:
  1. `GET /api/agenda?from=YYYY-MM-DD&days=N` (1 ≤ N ≤ 31, raised from 14 in T-19; default 8;
     `from` default today in config zone) returns `AgendaResponse`; input validated → 400 on bad input.
  2. `GET /api/config` returns the public config; `GET /api/health` returns status without
     secrets.
  3. Feeds fetched in parallel with timeout (10 s) and size limit (5 MB); per-source fresh
     cache (TTL from `KIDBOARD_CACHE_TTL`, default 3600 s) and last-good cache (7 d) via
     KV (`KIDBOARD_CACHE`, auto-provisioned) with Cache API/memory fallback; on upstream failure the last-good data is served with
     `status: 'stale'`, `stale: true`; no data at all → `status: 'error'` for that source,
     still 200 for the response if any source succeeded, 502 otherwise.
  4. Secrets read from env `CAL_<ID>_URL`; never logged, never in responses or error
     messages (test asserts the URL string is absent from all responses and console output).
  5. Optional `KIDBOARD_ACCESS_TOKEN`: if set, `/api/*` requires
     `Authorization: Bearer <token>` or `?key=<token>` (constant-time compare) → 401 otherwise.
  6. CORS only for origins in `KIDBOARD_ALLOWED_ORIGINS` (default none; same-origin works
     without CORS). Security headers on API responses (`X-Content-Type-Options`,
     `Cache-Control` appropriate, `Content-Type: application/json`).
  7. Typed `Env` bindings (`CAL_*_URL`, `KIDBOARD_*`) for the Hono app.
  8. Integration tests in `@cloudflare/vitest-plugin` with mocked upstream `fetch` serving
     fixtures: happy path, upstream 500 with/without last-good, timeout, invalid config.

**M1 exit:** milestone review (`reviewer-opus`), CI green.

## M2 – App skeleton, i18n, data, PWA

- [x] **T-11 Web shell & design tokens** (risk: medium, deps: M1)
  Acceptance:
  1. Tailwind 4 via `@tailwindcss/vite`; all colors, radii, spacing, shadows, font sizes,
     motion durations defined as CSS variables in `apps/web/src/styles/tokens.css` and
     exposed through `@theme`; components use only token-based utilities (placeholder
     child-friendly theme; light + night token sets).
  2. Child palette of ≥ 6 color-blind-friendly colors as tokens; text/background pairs meet
     WCAG AA (unit test computing contrast ratios of token pairs).
  3. Nunito via Fontsource, self-hosted.
  4. Layout scales fluidly between 1280×800 and 2000×1200 without scrolling (root font size
     from viewport); `prefers-reduced-motion` disables transitions.
  5. App-level error boundary with friendly fallback.
  7. `pnpm dev` works on a fresh clone (worker needs `apps/web/dist`: predev build or placeholder; documented).
  6. Split `apps/web` tsconfig: browser code without Node types; a separate
     `tsconfig.node.json` for vite/vitest/playwright configs and e2e.

- [x] **T-12 i18n** (risk: low, deps: T-11)
  Acceptance:
  1. i18next + react-i18next, bundled `de` / `en` resources, typed keys.
  2. Language: config `locale` → else browser language → else `de`; `<html lang>` updated;
     docs/CONFIG.md `auto` fallback aligned.
  3. Test: both locales have identical key sets and no empty values.
  4. Date/time formatting helpers use the active locale and configured time zone.
  5. Lint/test guard against hard-coded UI strings in JSX (e.g. `i18next/no-literal-string`
     or equivalent check) – no exceptions except emoji.

- [x] **T-13 Data layer** (risk: **high** → Opus, deps: T-10, T-12)
  Acceptance:
  1. Typed API client (`/api/config`, `/api/agenda`) validating responses with shared zod
     schemas; access token read once from `?key=` and stored locally, sent as Bearer header.
  2. TanStack Query + `PersistQueryClientProvider` with localStorage persister per ADR-0006
     (`buster` versioned, `maxAge` 7 d, `staleTime` 15 min, `refetchInterval` =
     `config.refreshMinutes`, refetch on focus/reconnect).
  3. `useAgenda(range)` and `useConnectionStatus()` exposing
     `loading | ready | offline | stale | error` deterministically (unit tests for each).
  5. Client request timeout > worker upstream timeout + margin (≈ 11 s), so stale data can arrive.
  4. Tests with MSW or fetch mocks: first load, refetch, offline with persisted data,
     schema-invalid response treated as error without wiping persisted data.

- [x] **T-14 PWA** (risk: **high** → Opus, deps: T-11)
  Acceptance:
  1. vite-plugin-pwa (`generateSW`, `registerType: 'autoUpdate'`), manifest (name, short
     name, `display: fullscreen`, `orientation: landscape`, theme/background colors from
     tokens, maskable + any icons generated from an original SVG).
  2. Precache app shell + fonts; `/api/*` `NetworkOnly` in SW.
  3. Built app passes Lighthouse-style installability checks (manifest + SW present –
     verified in a Playwright test reading the manifest and SW registration).
  4. App shell loads offline after first visit (Playwright offline test).

**M2 exit:** milestone review, CI green.

## M3 – Day view

- [x] **T-15 Core components** (risk: medium, deps: M2)
  Acceptance: `Emoji` (ADR-0009, `role="img"`, `aria-label` from title), `EventTile`
  (icon large, title small, time small, child color edge + avatar dots, past/current/all-day
  variants, long titles clamp to 2 lines), `MealCard`, `ChildLegend`, `StatusBanner`
  (offline/stale/error, discreet). Component tests incl. a11y roles; touch targets ≥ 64 px;
  titles rendered as text (XSS test with HTML-looking title).
  M2 follow-ups: `StatusBanner`/error state distinguishes `useApiErrorKind() === "unauthorized"`
  (parent-readable "access link expired, open the new `?key=` link", de + en); move
  `AppErrorBoundary` above `DataProvider` in `main.tsx`.

- [x] **T-16 Clock & day rollover** (risk: **high** → Opus, deps: T-12)
  Acceptance:
  1. `useNow()` ticks each minute aligned to the minute boundary; `useToday()` derives the
     date in the configured zone and changes exactly at local midnight without reload.
  2. Midnight rollover triggers an agenda refetch for the new range.
  3. Tests with fake timers: normal midnight, DST spring-forward and fall-back nights,
     device zone ≠ config zone, tab sleeping across midnight (`visibilitychange`).
  4. Current-band computation tested at band boundaries.
  5. (M2 follow-up) Shared, runtime-agnostic "today as `YYYY-MM-DD` in zone" helper in
     `packages/shared`, used by worker and web so `range.from` matches the worker window.
  6. (M2 follow-up) Midnight while offline: `useAgenda` gets placeholder data from a cached
     agenda whose range covers the new day; status stays `offline`/`stale`, never empty/`loading`.
  7. (M2 follow-up) Documented behaviour before the config (time zone) has loaded.

- [x] **T-17 Day view** (risk: medium, deps: T-15, T-16)
  Acceptance:
  1. Header: localized weekday + date large.
  2. Three bands morning/midday/evening (config boundaries, symbols 🌅 ☀️ 🌙), events placed
     by start time; all-day events in a top row; multi-day events shown on each day.
  3. Current band highlighted, past bands and past events visibly receded.
  4. Today's meals (breakfast/lunch/dinner/unspecified) visible without scrolling.
  5. States: loading skeleton, empty day ("Heute ist nichts geplant" with friendly emoji
     illustration), offline/stale banner, error state (parent-readable, child-calm).
  6. Fits 1280×800 and 2000×1200 with 8 events + 3 meals without scrolling (Playwright).
  7. (M2 follow-up) `formatTime` throws for date keys: only call it for timed events
     (`allDay === false`); format helpers need ISO instants with offset or `YYYY-MM-DD`.

**M3 exit:** milestone review, CI green.

## M4 – Week view, countdown, meal plan

- [x] **T-18 Week view & navigation** (risk: medium, deps: M3)
  Acceptance:
  1. Next 7 days (today first) side by side; each column: weekday, up to 3 most important
     icons (+N indicator), the day's meals compact; weekend visually distinct.
  2. Meal plan is integrated into the week columns (decision recorded in PLAN change log
     rationale: no extra screen, one glance).
  3. Big pictorial toggle (☀️ day / 🗓️ week) ≥ 64 px, understandable without reading,
     accessible names via i18n.
  4. Auto-return to day view after `config.autoReturnSeconds` (default 120 s) of
     inactivity.
  5. (M3 follow-ups) Header (date, status banner, child legend) moves out of `DayBoard` into a
     shared board frame for day + week; `buildDayModel` reused per column (rename `today` →
     `date`). Continuing multi-day timed events get a "continues" hint instead of the
     original start time.

- [x] **T-19 "How many sleeps?" countdown** (risk: medium, deps: T-18, T-16)
  Acceptance:
  1. Picks the nearest upcoming `countdown` event within 30 days.
  2. Nights = calendar-day difference in configured zone (event today → 0 → "today!"
     state; tomorrow → 1 moon).
  3. Rendered as countable 🌙 symbols (≤ 14 shown individually, beyond that grouped with a
     number) plus an accessible localized label with plural rules (DE/EN).
  4. Shown on week view and as a compact badge on the day view. DST-crossing tests.
  5. (M3 review, structural) Data: `/api/agenda` `days` limit raised from 14 to 31 (still inside
     the worker window `[today−1, today+32)`) and the client `AGENDA_DAYS` raised from 8 to 31, so
     day, week and countdown share one query, status and offline seed. Worker tests, ARCHITECTURE
     "Worker API details" and T-10 wording updated accordingly.

**M4 exit:** milestone review, CI green.

## M5 – Kiosk features

- [x] **T-20 Wake lock & fullscreen** (risk: medium, deps: M4)
  Acceptance: Screen Wake Lock requested when visible and re-acquired on
  `visibilitychange`; graceful no-op where unsupported; small, unobtrusive parent control
  for fullscreen (Fullscreen API); unit tests with mocked APIs. (M3 follow-up) `AppErrorBoundary` auto-resets after a delay with backoff so an unattended
  kiosk recovers without a tap (test that the reset lands in the day view).

- [x] **T-21 Night mode** (risk: medium, deps: T-11, T-16)
  Acceptance: automatic switch by `config.nightMode` times (spanning midnight works),
  dimmed warm token set, smooth transition (none under reduced motion), optional manual
  toggle via URL param `?night=1|0` for testing; contrast of night tokens meets AA. (M3 follow-up) Use `useCurrentBand` or remove it and fix its ARCHITECTURE mention. (M4 follow-up) Night-token contrast for weekend columns, countdown surface, band accents and
  `ring-accent`. (M2 follow-up) `<meta name="theme-color">` follows night mode, or the reason it doesn't is
  documented.

- [x] **T-22 Burn-in protection** (risk: low, deps: T-11)
  Acceptance: whole layout shifts by a few px on a slow orbit every few minutes, never
  causes overflow/scrolling; under reduced motion shifts happen without animation; tests
  with fake timers.
  (M4 follow-ups) Shift moves an inner wrapper within the gutter (not `<main>`), e2e re-run with
  max shift + banner + 14 moons; the view toggle keeps a fixed place when a banner appears
  (reserve a banner slot or keep the toggle on header row 1).

- [x] **T-23 Offline & stale UX end-to-end** (risk: **high** → Opus, deps: T-13, T-14, T-17)
  Acceptance: Playwright: load online → go offline → reload → last state + discreet
  offline hint; API returns `stale: true` → stale hint; API 502 with persisted data →
  data + hint; API 502 without data → error state; back online → hint disappears after
  refetch. (M2 follow-ups) offline across midnight keeps showing data; 401 with persisted
  data wipes storage and `kidboard.accessToken`. (M3 follow-ups) the e2e clock Proxy gets a test-only offset setter (offline across midnight)
  and an `apply` trap; Playwright projects set `timezoneId` (e.g. America/Los_Angeles) so the
  config zone is proven against a non-UTC device zone; `mockApi.ts` derives fixture dates (`dateOf`) and the clock from one constant; `pwa.spec.ts` offline test asserts day
  content or the offline banner again; ARCHITECTURE gets a day-view section (placement rules,
  5 s stale-banner delay) and ADR-0006/ADR-0009 mention the delay and the decorative emoji mode.

- [x] **T-24 Visual screenshots** (risk: medium, deps: T-21, T-23)
  Acceptance: a dev/screenshot fixture with dates relative to "today" (or recurring) exists so manual dev
  and screenshots show realistic data; Playwright generates screenshots of day + week view at 1280×800 and
  2000×1200 in light and night mode with fixture data (Mia 🦊 / Ben 🐻 example) into
  `docs/screenshots/`; a CI job runs them (artifact upload), committed copies are used in
  the README.
  (M4 follow-ups) Glanceability pass on the screenshots: larger compact countdown moons on the
  day view, a pictorial "today!" cue (e.g. 🎉), check 🌙/☀️ double meanings (band vs. sleep
  unit vs. toggle), child colour cue on week icons, past events in today's week column ranked
  last or dimmed.

**M5 exit:** milestone review, CI green.

## M5b – Design hand-off

Adopts the final design from `docs/design/` (Claude Design, 2026-11-22). Runs before T-27
so v1.0.0 ships with the final look (T-25 was already built before M5b landed).

**Merge rules (design × built app, three-perspective review 2026-11-22: child UX, tech, a11y/kiosk).**
The hand-off is adopted, except where the built app already solved a problem the hand-off does
not address. These rules apply to every M5b task:

1. *One symbol, one meaning:* 🌙 only counts sleeps; evening on tiles uses 🌆 (not the moon);
   all-day events get their own treatment (a banner at the top of the column, not the midday
   sun); the "Heute" button does not turn into a moon at night. Keep the e2e check.
2. *Never hide silently:* the "vorbei" strip has an accessible name listing the titles; past
   events give way first, then "+N" (with sr-only label), decided by available space, not a
   fixed count. Keep the no-loss assertion (`shown + hidden === n`).
3. *Now and next without reading:* keep the now line, keep the `current` tile state with a ring,
   and emphasise the next upcoming tile.
4. *Past events recede through tested tokens, not opacity alone* (opacity 0.4/0.5 fails AA);
   `--opacity-past*` only where the blended contrast is tested.
5. *Behaviour stays, visuals change:* `AppErrorBoundary` (backoff, single announcement, auto
   reset), `StatusBanner` (5 s stale delay), 401 wipe, wake lock outside the boundary,
   burn-in shift, theme-color meta and CSP hash all keep working; no hard-coded retry seconds.
6. *Kiosk corner:* no parent lock until M8; the rail's bottom slot hosts the long-press
   fullscreen control; burn-in and kiosk e2e re-run against the rail and the today ring.

- [x] **T-29 Final design tokens** (risk: medium, deps: M5)
  Acceptance: `apps/web/src/styles/tokens.css` replaced by `docs/design/tokens.css` (legacy band
  tokens stay until T-30b); a weekend surface token kept; `tokens.test.ts` extended with the
  pairs listed in `docs/design/README.md` (text on child tints, time-of-day accents on tints,
  today ring, nav, soft error) plus: night `nav-active` vs. inactive button and page (≥ 3:1, or a
  non-colour active cue), past text after any opacity, every `-tint` token has a matching child
  token; both themes; no raw hex in components; screenshots regenerated.

- [x] **T-29a Stable test hooks** (risk: low, deps: T-29)
  Acceptance: `data-testid` hooks independent of the band layout (e.g. `board-ready`,
  `day-column`, `event-tile`) and all e2e specs/`layout.ts` moved to them while the bands still
  exist; one green commit; no behaviour change.

- [x] **T-30a Overview model and layout logic** (risk: medium, deps: T-29a)
  Acceptance: `buildDayModel` kept and extended with `timeOfDay` per event; `buildOverviewModel`
  (today + 3 days); pure `columnLayout` (vorbei strip, compact from 6 events, "+N", past first,
  space-based capacity); `resolveChildTint` (token → `--color-child-N-tint`, other CSS colours →
  `color-mix` with the surface, as `var()`/style, CSP-safe); all unit-tested incl. property-style
  sweep like `bandLayout`.

- [x] **T-30b Four-day overview as main screen** (risk: medium, deps: T-30a)
  Acceptance: today + next 3 days as columns, today clearly the widest (about 2×) with emoji
  ≥ 3.5rem; events top to bottom, time-of-day icon (inline SVG or emoji per rule 1), now line
  with accessible name, `current` ring (rule 3); all-day banner per column; tiles with child
  tint, edge and badge (several children: split tint + overlapping badges; 3+: neutral + "+N");
  meals at the bottom (plates with accessible names, short name in today's column, a place for
  the `unspecified` slot); 🎉 0-night countdown state kept, countdown target in the child's
  tint; navigation rail on the right reusing `ViewToggle`/auto-return, "Stand" time not a live
  region, fullscreen control in the rail (rule 6); bands, `bandLayout` and legacy band tokens
  removed; density matrix rewritten (1–12 events in today's column, 3 children, long German
  title, 📅 fallback) fits 1280×800 and 2000×1200 without scrolling, incl. burn-in corners;
  i18n DE + EN; `docs/screenshots` regenerated.

- [x] **T-31 Week view in the new tile language** (risk: low, deps: T-30b)
  Acceptance: week tiles tinted with child badge and time-of-day icon; weekend columns stay
  visually distinct (T-18); past events of today ranked last (T-24); "+N" only when there is
  no room; countdown day in the child's tint and edge, moons in the column headers up to the
  target day; up to 14 moons shown individually (no "+N" for counting); meals as a three-row
  list; existing week, countdown and burn-in e2e adjusted.

- [x] **T-32 States and night mode per hand-off** (risk: medium, deps: T-30b)
  Acceptance: loading skeleton (4 columns, no spinner), offline/stale pill merged into
  `StatusBanner`, friendly error card (🧸, parent line, retry ≥ 64 px, short error code, no
  fixed seconds) on top of the existing boundary logic (rule 5), calm 401 variant ("open the
  link again" for parents), empty day illustration with meals; night theme with dimmed emoji in
  `<Emoji>` and past events per rule 4; contrast tests green; reduced motion respected;
  `csp.spec` green.

**M5b exit:** milestone review, CI green.

## M10 – School (before v1.0.0)

Built before the release (T-28 waits for M10); the number stays from the "Later" list.
School children without a new calendar kind or config: subjects stay normal recurring
events in the events calendar (e.g. `Mia: 🏊 Schwimmen`, weekly; holidays by deleting single
occurrences, EXDATE already works). Decisions: [ADR-0010](adr/0010-bring-list-from-description.md)
(bring list from the description, server-side), [ADR-0011](adr/0011-emoji-version-baseline.md)
(emoji baseline Emoji 13.0 for built-in icons). Merge rules 1–6 of M5b apply to every M10
task; 🎒 means only "tomorrow bring" (rule 1).

- [x] **T-33 Bring list: parsing and event DTO** (risk: **high** → Opus, deps: M5b)
  Goal: a `Mitbringen:` / `Bring:` description line becomes an icon list on `CalendarEvent`,
  and nothing else of the description reaches the client (ADR-0010).
  Acceptance:
  1. Pure `parseBringList(description): string[]` in `packages/shared` (runtime-agnostic),
     table-driven tests: `Mitbringen: 👟 🩱 🧴`, `bring:`/`BRING :` (case-insensitive,
     optional space before the colon), leading whitespace and bullets (`-`, `*`, `•`),
     keyword only at a line start and as a whole word (`Bringdienst:`, `Bitte mitbringen:`
     and a keyword mid-line do not match), several bring lines merged in order, text and
     digits between the emoji dropped (`Mitbringen: 👟 Turnschuhe, 🩱` → 👟 🩱), text-only
     symbols (`©`, `#`, `1`) dropped, ZWJ/skin-tone/flag/keycap/VS16 emoji kept whole,
     duplicates removed (with and without VS16), more than 8 icons capped at 8, a bring line
     without emoji → `[]`, empty/absent description → `[]`.
  2. Google-style formatted descriptions: `<br>`, `<br/>`, `</p>`, `</div>`, `</li>` count as
     line breaks, `<b>Mitbringen:</b> 👟` matches, `&nbsp;` between keyword and emoji works;
     HTML-looking content (`<img src=x onerror=…>`, `<script>`) yields only the emoji of the
     bring line. Input bounded (first 8 KB of the description, first 500 characters of a
     bring line); a 5 MB description and a line of 100 000 emoji finish fast (test with a
     time budget) and never throw.
  3. `CalendarEventSchema` gets optional `bring` (array of `EmojiSchema`, max 8), omitted when
     empty; an agenda without `bring` (old persisted client data, old worker cache entry)
     still validates (test); ARCHITECTURE data model and "Title conventions" (new rule 7) and
     ADR-0005 cross-reference updated.
  4. `normalize` sets `bring` for events only (meals ignore bring lines); `#countdown` and a
     bring line in one description both work. ical.js description unescaping (`\n`, `\,`)
     verified via Context7 and covered by a fixture.
  5. Synthetic `fixtures/ics/bring.ics` (weekly series with a bring list, a `RECURRENCE-ID`
     override with a different bring list, an EXDATE, an HTML description, an all-day event
     with a bring list, a meal with a bring line, a description with a private note marker
     `TESTONLY-private-note`); worker integration test asserts the bring lists per
     occurrence and that the marker and the word `Mitbringen` appear in no response body or
     console output.
  6. Worker cache: entries normalized before this change are not served as fresh (cache entry
     version or key bumped), so bring lists appear right after a deploy; last-good fallback
     to an old entry still works (test).

- [x] **T-34 Subject fallback icons and emoji baseline** (risk: medium, deps: M5b)
  Goal: common school subjects get a picture without an emoji in the title; no built-in icon
  is newer than the baseline (ADR-0011).
  Acceptance:
  1. Fallback table extended (DE + EN, whole-word, case-insensitive, umlaut-aware), at
     least: Kunst/art 🎨, Sport/PE/Sportunterricht 👟, Musik/music 🎵 (existing entry kept),
     Mathe/Mathematik/math/maths 🔢, Deutsch/German and Englisch/English 📖,
     Sachkunde/Sachunterricht/science 🔬, Werken/crafts 🔨, Schwimmunterricht 🏊 (existing
     entry extended); Turnen stays 🤸, Schule stays 🏫; no keyword maps to 🎒 (rule 1).
  2. Table-driven parser tests for every new keyword in both languages, compound titles
     (`Mia: Kunst AG` → 🎨), first-match rule with several keywords, no false hit inside
     words (`Sportplatzfest` does not match `sport`; `Kunststoff` not `kunst`); known
     ambiguity of `Art` in German documented in the table comment.
  3. Baseline test per ADR-0011: every emoji in the fallback table, the default icons and the
     default countdown emoji has emoji version ≤ 13.0 according to `emojibase-data`
     (devDependency, verified via Context7 and npm metadata); a web test covers the UI emoji
     constants (rail, states, 🎒, time-of-day icons). 🛝 is replaced by an older glyph in the
     table, demo data and e2e fixtures; a test with 🪈 in the table data fails (negative case).
  4. ARCHITECTURE "Title conventions" rule 5 examples and the README title table list the
     subject icons.

- [x] **T-35 Bring chips on tiles** (risk: medium, deps: T-33)
  Goal: an event's bring list is visible as small emoji chips on its tile in the overview
  and the week.
  Acceptance:
  1. `EventTile` shows `bring` as emoji chips (through `<Emoji>`, React text only, no
     `dangerouslySetInnerHTML`) on every overview and week size; only whole chips that fit
     the tile width are shown, the rest as a plain-text "+N" (as `stripIconsThatFit`); the
     tile has one accessible description listing all icons ("Bring along: 👟 🩱", i18n DE +
     EN), chips themselves decorative.
  2. Chips fit into the existing tile heights (`TILE_HEIGHT_REM` unchanged), or, if a size
     must grow, `columnCapacity`/`fitWeekColumn` constants and the density matrix e2e are
     updated so 1–12 events with bring lists still fit 1280×800 and 2000×1200 without
     scrolling; property-style sweep in `columnCapacity.test.ts` with bring lists.
  3. Past tiles and the "vorbei"/"done" strip show no chips; current/next cues (rule 3) and
     the child tint/badges stay unchanged; chips readable on every child tint and at night
     (contrast test for the chip surface token if a new token is added).
  4. An XSS-looking title together with a bring list still renders as text (component test).

- [x] **T-36 Evening-before 🎒 "tomorrow bring" area** (risk: **high** → Opus, deps: T-33, T-35)
  Goal: the evening before, the today column shows what to pack for the next day, per
  child, until the event has started.
  Acceptance:
  1. Pure `buildBringReminder(agenda, config, now)` (config zone only, never the device
     zone): from `bands.eveningStart` until midnight it collects the bring lists of
     **tomorrow's** events; from midnight until `bands.eveningStart` it collects those of
     **today's** events that have not started yet (timed: until their start; all-day: until
     `bands.middayStart`); each event's icons leave the area when its time is over, the area
     is empty when nothing is left. Unit tests at every boundary (eveningStart − 1 min /
     exact, midnight, event start − 1 min / exact, middayStart for all-day), DST spring-forward
     and fall-back evenings, device zone ≠ config zone, multi-day timed event continuing into
     tomorrow (not counted again), recurring event with an override.
  2. Grouping: one group per child in config order (child's avatar badge and tint, icons
     deduplicated per child); events for everyone (`childIds: []`) form one neutral group
     shown first; an event for several children adds its icons to each named child.
  3. Placement: inside today's overview column, between the event list and `MealPlates`,
     led by 🎒 with a day cue (evening: arrow + tomorrow's short weekday + "Morgen"/"Tomorrow";
     morning: "Heute"/"Today"; no 🌙); rendered only when non-empty; one row per group (fixed
     height from the row count, no wrapping), rows granted only while the event list keeps its
     minimum (`listMinRem`: done strip, now line, two slim tiles, "+N"); as a last resort the
     remaining groups share the last row; whole icons only plus a plain-text "+N" per overflow
     (as `stripIconsThatFit`); the event list
     above shrinks through the existing space-based steps (`useContentHeight`/`fitColumn`,
     the area is outside the `flex-1 min-h-0` list), so nothing scrolls. Not shown in the
     other overview columns or the week view.
  4. A11y and i18n: a labelled region ("Pack for tomorrow" / "Für morgen einpacken", the
     morning variant "Today bring" / "Heute mitbringen") whose accessible name lists every
     child and icon, nothing hidden silently (rule 2); not a live region; no touch
     interaction (no touch target needed), DE + EN.
  5. Night mode: the area stays visible (useful before night mode ends in the morning),
     rendered with night tokens and the dimmed `<Emoji>`; contrast of its surface/text pairs
     tested in both themes. 🎒 is used nowhere else in the UI or built-in tables (rule 1,
     test).
  6. Midnight rollover (`useToday`) switches from "tomorrow" to "today" without reload, also
     offline with persisted data (test with fake timers).
  7. ARCHITECTURE overview section documents the window, grouping and placement.

- [x] **T-37 Fixtures, demo data, e2e and screenshots** (risk: medium, deps: T-34, T-36)
  Acceptance:
  1. `apps/web/demo/demoData.ts` (relative dates): school subjects with fallback icons and
     bring lists for Mia 🦊 and Ben 🐻 so tomorrow has bring items; `demoData.test.ts`
     validates it against the shared schema.
  2. `e2e/bring.spec.ts` (e2e clock, device zone `America/Los_Angeles`): chips on overview
     and week tiles; area absent before `eveningStart`, present from it with both children,
     still present next morning, an event's icons gone once it started; night mode; the
     description marker never appears in the DOM.
  3. Density e2e re-run with the area present (3 children with bring lists, 1–12 events in
     today's column) at 1280×800 and 2000×1200, incl. burn-in corners: no scrolling, no clipped
     icon, `shown + hidden === n`.
  4. Screenshots `docs/screenshots/day-bring-evening-*` (light + night) and a week shot with
     chips at both sizes, generated by the screenshot job.

- [x] **T-38 School docs** (risk: low, deps: T-37)
  Acceptance: README + README.de: feature bullet, a "Bring list" section (how to write
  `Mitbringen: 👟 🩱` / `Bring: 👟 🩱` on its own line in the Google Calendar event
  description on phone and web, text next to the emoji is allowed but never shown, the rest
  of the description stays private and is never sent to the tablet, recurring series vs.
  "only this event", when the 🎒 area appears and disappears), subject fallback icons in
  the title table, the emoji baseline (Android 11+) in the kiosk tips, the new screenshots;
  `docs/CONFIG.md` EN + DE: `bands.eveningStart` also starts the 🎒 area, `bands.middayStart`
  ends it for all-day events; troubleshooting entry "bring icons do not show" (own line,
  colon, emoji, cache delay up to `KIDBOARD_CACHE_TTL`).

**M10 exit:** milestone review by `reviewer-opus` (privacy of descriptions, parser
robustness, layout without scrolling), a short T-27a-style UI/UX check of the new surfaces
(one Sonnet agent, both sizes, light/night, findings fixed via the loop), CI green.

## M11 – Parent editor (before v1.0.0)

Parents add and change entries on the tablet (or a phone) instead of typing title
conventions in Google Calendar: pick the child, the activity icon, once or weekly, done.
Decisions: [ADR-0014](adr/0014-app-entries-in-d1.md) (app entries stored by KidBoard in
the family's own Cloudflare D1, merged with the Google feeds through the existing iCal
pipeline, no Google setup), [ADR-0013](adr/0013-parent-lock.md) (parent PIN, short
sessions, lockout, hidden entry) and [ADR-0012](adr/0012-write-via-google-calendar-api.md)
(deferred: optional Google sync via a service account, later). M11 touches no M10 file
except the nav rail and i18n files and may be worked in parallel to T-36–T-38 (rebase
often). Merge rules 1–6 of M5b apply. The editor is a parent surface: touch targets ≥ 48 px
(≥ 64 px for the hold-to-open entry and the PIN pad), WCAG AA, DE + EN.

- [x] **T-39 Editor model: compose and parse entries** (risk: **high** → Opus, deps: T-33)
  Goal: one pure, runtime-agnostic description of an editor entry in `packages/shared` and
  loss-free conversion to and from Google event fields.
  Acceptance:
  1. zod schemas `EditorEntryInput` (kind `event`/`meal`; `childIds` (configured ids, `[]` =
     everyone); `icon` (`EmojiSchema`); `title` (trimmed, 1–60 chars, plain text, no line
     breaks); `allDay`; `date` + optional `startTime`/`endTime` (`HH:mm`, end after start,
     default duration 1 h) or all-day `endDate` (multi-day, exclusive end); `repeat`:
     `none` | `{ weekly: { weekdays (1–7 unique), interval 1|2, until? } }`; `bring`
     (≤ 8 emoji); `countdown`; `slot` for meals) and `EditorEntry` (adds Google ids,
     `sourceId`, `recurringEventId`, `repeatEditable`) exported from `@kidboard/shared`.
  2. `composeTitle(entry, config)` writes ADR-0005 titles: `Mia: 🏊 Schwimmen`,
     `Mia, Ben: 🛁 Baden`, everyone → no prefix, child of a per-child calendar → no prefix,
     meals `Mittag: 🍝 Spaghetti` / `Lunch: …` by config locale; round-trip property test:
     `parseTitle(composeTitle(x))` returns the same children, icon, title and slot for
     every generated input (names with umlauts, titles starting with a child name or a
     meal word, titles with colons, emoji with ZWJ/VS16/skin tones).
  3. `composeDescription(existing, { bring, countdown, locale })` replaces only bring lines
     and the `#countdown` marker and keeps every other line and its HTML byte for byte
     (Google-style HTML descriptions, `TESTONLY-private-note` marker test); empty bring +
     no countdown on an empty description → empty string; `parseBringList` of the result
     equals `bring`.
  4. `buildRecurrence(repeat, start, timeZone)` → `RRULE:FREQ=WEEKLY;BYDAY=…[;INTERVAL=2][;UNTIL=…]`
     (UNTIL as `YYYYMMDD` for all-day, UTC `…T…Z` covering the last local day otherwise,
     DST-safe); `parseRecurrence(lines)` returns the editor form for exactly these shapes
     and `null` (= `repeatEditable: false`) for anything else (COUNT, BYMONTHDAY, MONTHLY,
     RDATE, EXRULE, several RRULEs); EXDATE lines are kept on master edits. Table tests
     incl. DST weeks in `Europe/Berlin` and `America/Los_Angeles`.
  5. `toGoogleEvent(input, config)` / `fromGoogleEvent(event, source, config)` (Google
     REST shapes typed with zod, unknown fields ignored, title through `parseTitle`, bring
     through `parseBringList`, times in the config zone, never the device zone); tests for
     timed, all-day, multi-day, series master, instance, meal.
  6. `pickTargetCalendar(entry, writableSources, config)` implements the ADR-0012 rule;
     table tests. (Criteria 5–6 prepare the optional Google sync of ADR-0012.) ARCHITECTURE gets an "Editor" section (model, conventions, target rule).

- [x] **T-40 Worker: entry store in D1** (risk: **high** → Opus, deps: T-39)
  Goal: app entries are stored durably in the family's own deployment, with no setup step.
  Acceptance:
  1. `KIDBOARD_DATA` D1 binding without an id in `wrangler.jsonc` (auto-provisioning and
     vitest/`wrangler dev` local database verified via Context7 or installed sources);
     `env.ts` typed; the worker creates its tables on first use (`CREATE TABLE IF NOT
     EXISTS`, schema version row), idempotent and safe under concurrent first requests.
  2. Small repository module: `list(from?, to?)`, `get(id)`, `create(input)`,
     `update(id, revision, input)` (revision mismatch → `conflict`), `remove(id, revision)`,
     `addException(id, date)` / `setOverride(id, date, input)` for "only this day",
     `exportAll()` / `importAll(doc, mode)`; every input validated with the T-39 schemas;
     limits 1 000 entries, 8 KB per entry (→ `limit_reached`); prepared statements only.
  3. `/api/config` gains `editor: boolean` (true only with `KIDBOARD_DATA` bound and a valid
     PIN per ADR-0013); shared `PublicConfigSchema` defaults it to `false`; old clients
     ignore it.
  4. Tests with the local D1 of the vitest plugin: CRUD, revision conflicts, exceptions and
     overrides, limits, export → import round trip, table creation from an empty database,
     binding absent → editor off and `/api/agenda` unchanged.

- [x] **T-41 Worker: app entries on the board** (risk: **high** → Opus, deps: T-40)
  Goal: entries from the app appear on the board exactly like Google events.
  Acceptance:
  1. Entries rendered as an in-memory iCalendar with ical.js (`composeTitle`,
     `composeDescription`, `buildRecurrence`, `TZID` = config zone; EXDATE for removed
     days, `RECURRENCE-ID` components for "only this day" overrides) and passed through the
     existing `expandCalendar`/`normalize` path as two virtual sources `app-events`
     (kind events) and `app-meals` (kind meals); ids stable per entry and occurrence.
  2. The virtual sources appear in `AgendaResponse.sources` only when the editor is on;
     their cache entry is dropped after every write (memory + KV/Cache API) so the next
     `/api/agenda` reflects the change; D1 unavailable → their status `stale` (last good)
     or `error`, the Google sources unaffected.
  3. Integration tests: once, weekly, every 2 weeks, until, all-day, multi-day, meal,
     bring list, countdown, override and exception, a DST week in `Europe/Berlin`, device
     zone ≠ config zone; an entry's title text with HTML-looking content comes out as plain
     text; the round trip entry → agenda event keeps children, icon, title, slot, bring.

- [x] **T-42 Worker: parent lock** (risk: **high** → Opus, deps: T-40)
  Acceptance: ADR-0013 implemented and tested: PIN validation (6–12 digits, template →
  off); server secret generated once in D1; `POST /api/parent/unlock` constant-time
  compare, session token format and 15 min expiry (fake clock), wrong/expired/tampered/
  other-PIN tokens → 403 `parent_locked` (a wrong PIN → 403 `wrong_pin`; 401 stays reserved for the access token);
  every attempt is reserved before the compare (per isolate and atomically in D1, a success
  deletes its reservation); lockout after 5 failures in 15 min → 429 + `Retry-After`, reset
  after the window; access token still
  required in front of it; CORS adds `POST, PATCH, DELETE`, `Content-Type` and
  `X-KidBoard-Parent` for allowed origins only; request bodies limited to 16 KB and parsed
  with zod; editor off → all `/api/parent/*` 404; `.dev.vars.example` and the deploy-button
  variables list `KIDBOARD_PARENT_PIN`.

- [x] **T-43 Worker: editor API** (risk: **high** → Opus, deps: T-41, T-42)
  Acceptance:
  1. `GET /api/parent/entries?from&days` (≤ 31 days, same window rules as `/api/agenda`)
     → app entries (editable, with revision, series info) and Google occurrences (read-only,
     `origin: "google"`, title/icon/children/time only, never descriptions beyond the
     bring list), sorted by start.
  2. `POST /api/parent/entries`, `PATCH /api/parent/entries/:id?scope=one|series&date=`,
     `DELETE /api/parent/entries/:id?scope=one|series&date=`; `scope=one` on a series
     writes an exception or override for that date only; series edits keep exceptions
     whose dates still exist; revision mismatch → 409 `conflict`; response
     `{ entry, boardRefresh: "now" }`.
  3. `GET /api/parent/templates` → up to 12 suggestions (same icon + title + children, most frequent
     first) from app entries of the last 8 weeks and next 4 and from Google entries of the
     cached feed window (today − 1 to today + 28).
  4. `GET /api/parent/export` (JSON download) and `POST /api/parent/import`
     (`merge`|`replace`, validated, size-limited).
  5. Tests for every route incl. auth (no session → 403 `parent_locked`), validation errors with field
     codes for the UI, conflict, limits, and that responses never contain Google
     descriptions or secrets.

- [x] **T-44 Web: parent gate** (risk: medium, deps: T-42)
  Acceptance: ✏️ entry in the nav rail only when `config.editor` is true, opens after a
  2 s press and hold (≥ 64 px target, progress ring, `prefers-reduced-motion` respected,
  keyboard: Enter held 2 s), short taps do nothing visible; PIN pad (≥ 64 px keys, digits
  masked, error feedback without motion when reduced, lockout message with minutes left);
  session in memory only; auto-lock after 3 min idle, on `visibilitychange` hidden and on
  "Done"; board auto-return paused while open; i18n DE + EN; component tests and an e2e
  with the mock API (unlock, wrong PIN, lockout, auto-lock).

- [x] **T-45 Web: editor screens** (risk: **high** → Opus, deps: T-43, T-44)
  Goal: adding a weekly swimming lesson for one child takes under 20 seconds and no typing
  except the optional name.
  Acceptance:
  1. **List:** next 14 days grouped by day (today first), each entry as the child sees it
     (reusing the `EventTile` look), meals per slot, 🔁 marker for series, Google entries
     marked "from Google Calendar – change it there" with a "use as template" action.
  2. **New entry flow** (one screen, large controls): *who* (child avatars, multi-select,
     "Alle"), *what* (activity catalogue of ≥ 40 icons in 6 groups – sport, school/kita,
     friends & play, appointments, outings, celebrations – each with a DE/EN label that
     pre-fills the title; plus "your own emoji" validated by `EmojiSchema`; all built-in
     icons within the ADR-0011 baseline, test), *when* (today/tomorrow/date chips, time or
     all-day, duration presets), *repeat* (once / weekly with weekday chips preset to the
     chosen date's weekday, every 1 or 2 weeks, optional end date), *bring* (≈ 16 common
     items as toggle chips + own emoji), *countdown* toggle ("count the sleeps"), and a
     **live preview** tile.
  3. **Templates:** an "Again" row with the T-43 suggestions and built-in quick picks
     (e.g. 🏊 Swimming weekly, 🎂 Birthday with countdown, 🦷 Dentist) that pre-fill the form.
  4. **Meals:** "What's for dinner?" mode: day + slot chips, dish catalogue (≈ 24 dishes
     with icons), own emoji/text; "repeat last week's meals" copies the previous week's
     app meals to this week in one confirmed step.
  5. **Edit/delete:** same form pre-filled; for series a clear choice "only on <date>" /
     "every week"; delete asks once, naming the entry; after saving a calm toast and the
     agenda query is refetched so the board shows the change at once.
  6. **Backup:** export (download JSON) and import (merge/replace with confirmation) in a
     small "Data" section.
  7. Demo build (`pnpm dev:demo`) runs the editor against an in-memory fake API (PIN
     `123456` shown in the demo only), so the UI/UX test needs no deployment.
  8. Errors (offline, `conflict`, `limit_reached`, `parent_locked`, validation) as calm
     messages in the `KB-*` style; nothing lost on a failed save (form kept). Component
     tests for every control, a11y (labels, roles, focus order, AA contrast in light and
     night), XSS-looking titles render as text.

- [x] **T-46a Worker: phone feed** (risk: **high** → Opus, deps: T-41, T-42)
  Acceptance: optional secret feed of the app entries: `GET /api/feed.ics?token=<KIDBOARD_FEED_TOKEN>`
  (only when that secret is set, 32–256 chars `[A-Za-z0-9_-]`, not the template; 404 on
  every miss; constant-time compare; no access token needed for exactly GET/HEAD of this
  path so calendar apps can subscribe; `Cache-Control: no-store`; token never logged), the
  same iCalendar as T-41 plus a VTIMEZONE (RFC 5545), and `GET /api/parent/feed` (behind
  the parent session) returning the relative subscribe URL; tests.

- [x] **T-46 Phone feed link, e2e, screenshots and docs** (risk: medium, deps: T-45, T-46a)
  Acceptance:
  1. The parent area shows the subscribe link (absolute URL from `/api/parent/feed`) with a
     copy button and an `aria-live` "copied" confirmation, hidden when the feed is off;
     never logged or cached; i18n DE + EN; component tests.
  2. Playwright e2e at 1280×800 and 2000×1200 against the mock API (create once, create
     weekly, edit one vs series, delete, meal, template, export/import, lockout,
     auto-lock, offline); screenshots `docs/screenshots/editor-*` (light/night).
  3. ~~User docs~~ deferred by the maintainer until the editor is final (README/DEPLOY/CONFIG
     sections for the editor, PIN, D1, backup and phone feed follow in a later task).

- [x] **T-46b Lean deploy form: Google calendars optional** (risk: **high** → Opus, deps: T-46, M11 click-test round 1)
  Acceptance:
  1. `KIDBOARD_CONFIG` may list no calendars (`calendars` defaults to `[]`); the board then
     shows only the app sources (ADR-0014). With no calendars and the editor off the worker
     logs one configuration warning and the board shows its normal empty state (no error).
  2. The "Deploy to Cloudflare" form asks only for `KIDBOARD_ACCESS_TOKEN`,
     `KIDBOARD_PARENT_PIN` and `KIDBOARD_CONFIG` (plus Cloudflare's own fields; KV and D1
     "keep the default"): the `CAL_*_URL` entries in `.dev.vars.example` become commented,
     optional examples, the template config has children but no calendars, and the binding
     descriptions in `package.json` say in one plain sentence what to enter.
  3. Adding Google later works by adding `calendars` to the config plus `CAL_<ID>_URL`
     secrets in the dashboard; existing deployments with calendars behave unchanged.
  4. Web: board, week view, meals and editor work with zero configured calendars (no meal
     calendar → app meals only; Google template list empty); tests in shared, worker and
     web; e2e/demo unchanged or extended; `docs/DEPLOY*.md` and `docs/CONFIG.md` adjust only
     the rows/sentences that became wrong (full editor docs stay deferred).
  5. ADR-0014 notes that app entries are the default source and Google feeds are optional.

**M11 exit:** milestone review by `reviewer-opus` (write auth, lockout, D1 data integrity,
privacy, conventions round trip, board parity of app entries), a T-27a-style UI/UX click
test of the editor by three agents (Haiku, Sonnet, Opus) at both sizes, light/night, fixed
via the builder/reviewer loop and re-checked by Sonnet until no blocking findings; CI green.

**Later (M12 ideas, not planned yet):** optional Google sync of app entries via a service
account (ADR-0012); click-through setup wizard (children, colours, avatars, calendars)
stored in D1 instead of the `KIDBOARD_CONFIG` JSON, behind the same parent lock.

## M9 – Weather and what to wear (before v1.0.0)

Children see the weather and what to put on without reading: a weather icon with the
temperature on every overview day, and a small row of clothing pictures for today (from
`bands.eveningStart` for tomorrow, so it can be laid out the evening before). Pulled forward
from "Later" at the maintainer's request (2026-11-23). Decision:
[ADR-0015](adr/0015-weather-open-meteo.md) (Open-Meteo without a key, fetched and cached by
the worker, place from `KIDBOARD_CONFIG`, clothing rules in `packages/shared`). Merge rules
1–6 of M5b apply. M9 touches the board, i18n and config files that M11 also touches: rebase
often, never force-push.

- [x] **T-47 Weather config, forecast model and clothing rules** (risk: medium, deps: M10)
  Goal: everything pure and runtime-agnostic in `packages/shared`.
  Acceptance:
  1. Optional `weather` block in `AppConfigSchema` (strict): either `place` (1–80 chars,
     optional `country` as ISO 3166-1 alpha-2) or `latitude` (−90…90) + `longitude`
     (−180…180), never both, never neither; `unit` `celsius` (default) | `fahrenheit`. No
     block → weather off. Config tests for every invalid shape.
  2. `PublicConfigSchema`/`toPublicConfig`: only a flag `weather: true` (omitted when off, as
     `editor`), never the place or coordinates (test).
  3. `WeatherResponseSchema` (DTO of `/api/weather`): `fetchedAt`, `unit`, `current`
     (`temperature`, `code`) and `days[]` (`date` `YYYY-MM-DD` in the config zone, `code`,
     `tempMax`, `tempMin`, `feelsMin`, `feelsMax` over the daytime hours 07:00–19:00,
     `rain` (bool), `snow` (bool), `uvMax`), up to 7 days; temperatures rounded to whole
     degrees; old clients ignore unknown keys.
  4. `weatherIcon(code)` maps every WMO code of the Open-Meteo docs to one emoji (☀️ 🌤️ ⛅
     ☁️ 🌫️ 🌦️ 🌧️ ❄️ ⛈️; snow ❄️ so it differs from rain at small sizes), unknown codes →
     ☁️; never 🌙 (rule 1: 🌙 counts sleeps).
  5. `clothingFor(day)` returns at most 5 items (keys; emoji, or one of two drawn pictograms
     for a warm hat and a sweater, ADR-0015) from a documented threshold table (feels-like in
     °C, converted for °F): 🧥 jacket below 14°, warm hat below 8°, 🧣 below 5°, 🧤 below 3°
     or snow, sweater from 14° to below 18° (`feelsMin`); 👕 from 22°, 🩳 from 24°
     (`feelsMax`); rain → 🌂, plus 👢 rain boots only when `feelsMax` < 20°; snow → 🥾 + 🧤;
     🧢 when sunny (code ≤ 2) with UV ≥ 3 and `feelsMax` ≥ 15°, 🧴 when sunny with UV ≥ 4;
     priority when capped: umbrella, boots, jacket, hat, gloves, scarf, sweater, T-shirt,
     shorts, cap, sunscreen; no duplicates. Table tests at every threshold (below
     / exact), °F input, a cool morning + hot afternoon day (jacket and T-shirt).
  6. Every new emoji is in the ADR-0011 baseline (Emoji ≤ 13.0, test).

- [x] **T-48 Worker: `/api/weather`** (risk: **high** → Opus, deps: T-47)
  Goal: the worker fetches, condenses and caches the forecast; the tablet never talks to a
  third party and never learns the place.
  Acceptance:
  1. `place` resolved once via the Open-Meteo geocoding API (first result, `countryCode`
     when given, language from the config locale) and cached for 30 days; no result →
     `/api/weather` answers 503 `weather_place_unknown` (the config stays valid).
  2. Forecast via the Open-Meteo forecast API (JSON, `timezone` = config zone,
     `forecast_days=7`, current + hourly + daily variables per ADR-0015; request shape
     verified via Context7), validated with zod, condensed to `WeatherResponseSchema`;
     daytime feels-like from the hourly values in the config zone (DST day test). Timeout
     5 s and 1 MB size limit; upstream errors never leak upstream text.
  3. Cache: fresh for 30 min in `KIDBOARD_CACHE` (KV) or the Cache API fallback, last good
     forecast served up to 24 h when Open-Meteo fails (marked `stale: true`); KV writes stay
     within `KV_WRITES_PER_DAY_BUDGET` together with the feeds (≤ 48 forecast writes/day,
     test).
  4. Route behind the access token; weather off → 404 `weather_off`; place, coordinates and
     upstream URLs appear in no response body, error or log line (test with a marker
     place `TESTONLY-Weatherplace`). `Cache-Control: no-store` as every API route.
  5. Worker tests with mocked upstreams (forecast fixture modelled on the documented
     response, geocoding hit/miss, timeout, 400 error object, oversize body).

- [x] **T-49 Weather and clothing on the board** (risk: medium, deps: T-47, T-48)
  Acceptance:
  1. Client query `weather` (only when `config.weather`), refetch every 30 min, persisted
     for offline like the agenda; a forecast older than 24 h or for a past date is not
     shown; any weather error hides the weather silently (the board never shows an error
     for it).
  2. Overview: every day column shows a weather chip in its header (icon + temperature;
     today: current temperature, other days: daily high, with a short date so nothing
     truncates); today's column shows the clothing row (`clothingFor`) in its heading row:
     for today until `bands.eveningStart`, from then for tomorrow, led by an arrow +
     tomorrow's weather icon + high (no sun after dark: today's chip becomes 🌡️ + current
     temperature); the row never wraps (icons 2rem → 1.75rem → the evening 🌡️ chip is
     dropped → 1.5rem; the heading is never covered); whole icons only; heights measured so the event
     list shrinks through the existing steps and nothing scrolls (density e2e re-run with
     weather at 1280×800 and 2000×1200, incl. burn-in corners).
  3. Week view: icon + daily high in a row above the weekday for days inside the forecast
     (apart from the countdown 🌙 on the date line).
  4. A11y and i18n (DE + EN): each chip is one image with a full name ("Sunny, 12 degrees"
     / "Sonnig, 12 Grad"), the clothing row a labelled list ("Today wear: jacket, scarf" /
     "Morgen anziehen: Jacke, Schal"); °C/°F from the config; night tokens and dimmed
     `<Emoji>`; contrast tests for any new token pair.
  5. Attribution "Weather: Open-Meteo.com" / "Wetter: Open-Meteo.com" (CC BY 4.0) shown small
     in the rail under "Updated" while weather is on.
  6. Demo data with weather (relative dates, a cold rainy tomorrow so the evening row shows
     jacket + rain gear), e2e `weather.spec.ts` (chips, morning vs. evening row, weather off,
     weather error hides quietly), screenshots `docs/screenshots/day-weather-*` (light +
     night, 1280×800).
  7. Short docs only (maintainer asked for full guides later): README + README.de feature
     bullet and a `weather` entry in `docs/CONFIG.md` EN + DE (example, privacy note,
     Open-Meteo terms).

**M9 exit:** milestone review by `reviewer-opus` (privacy of the place, caching/KV budget,
layout without scrolling), a T-27a-style UI/UX click test of the new surfaces by three
agents (Haiku, Sonnet, Opus) at both sizes, light/night, fixed via the builder/reviewer loop
and re-checked by Sonnet until no blocking findings; CI green.

## M6 – Deploy, docs, v1.0.0

- [x] **T-25 Cloudflare deploy** (risk: **high** → Opus, deps: M5; built before M5b, see change log)
  Acceptance: root `pnpm deploy:cloudflare` builds web + deploys worker; "Deploy to
  Cloudflare" button in README; documented secrets (`wrangler secret put CAL_KINDER_URL`)
  and vars; `wrangler deploy --dry-run` in CI; step-by-step guide verified as far as
  possible without credentials. (M2 follow-up) Verify the Workers Static Assets default `Cache-Control` for `sw.js`,
  `index.html`, `manifest.webmanifest`, and whether Cloudflare logs record the first-visit
  `/?key=` URL; document it. (M5 follow-up) If security headers or a CSP are added, allow the hash of the
  inline theme boot script in `apps/web/index.html`.

- ~~**T-26 Vercel alternative**~~ – moved out of v1.0.0 to issue #3 (Vercel as a second hosting provider).

- [x] **T-27 Documentation** (risk: low, deps: T-25)
  Acceptance: README EN + DE complete: features, screenshots, Google Calendar setup (where
  to find the secret iCal address, creating separate calendars, sharing caveats), title
  conventions with examples, configuration reference, deploy (Cloudflare), kiosk
  tips (Fully Kiosk settings, PWA install, screen dimming), troubleshooting, privacy note. (M2 follow-up) CONFIG.md EN + DE documents the tablet token flow: open `/?key=` once,
  token stored + stripped from URL, forgotten after a 401. (M5b follow-up) Describe the four-day overview, rail ("Stand/Updated"), vorbei strip, now line and "+N"; overview and state screenshots with updated captions; `KB-*` error codes in troubleshooting; `children[].avatar`/colour as tile tint and badge; CONFIG.md: `bands` set the time-of-day icon and meal slot. (M5 follow-up) Kiosk tips explain the hidden
  bottom-right fullscreen control (press and hold), wake-lock behaviour and its limits (battery
  saver), Fully Kiosk "keep screen on" as backup; `?night=` / `?burnin=` in a short developer note.

- [x] **T-27a UI/UX dummy test loop** (risk: medium, deps: T-27; mandatory before T-28)
  Acceptance: the demo build (`pnpm dev:demo` / preview with demo data) is clicked through by
  three independent agents on different models (Haiku, Sonnet, Opus) at 1280×800 and 2000×1200,
  light and night, incl. offline/error states; each rates UI/UX (glanceability for children
  3–8, parent use, a11y, kiosk behaviour) with screenshots and a findings list; findings are
  merged, triaged and fixed via the builder/reviewer loop; a Sonnet agent then re-checks the
  result; repeat the loop until the re-check reports no blocking findings. Findings, decisions
  and rounds are logged in `docs/PROGRESS.md`.
  (M5b follow-up) Explicit checks: English title truncation in narrow columns, week past-event
  ranking for leftover slots, 🌞 vs ☀️ glanceability, faint emoji on light tints, skeleton → board
  header jump, all states at both sizes light/night with 3 children and 1–12 events.

- [ ] **T-28 Release readiness & v1.0.0** (risk: **high** → Opus, deps: T-27a, M9, M10, M11; last task before the release)
  Acceptance: full review by `reviewer-opus`; gitleaks over full history clean;
  `pnpm audit --prod` without high/critical; release-please release `v1.0.0` published;
  branch-protection settings documented/applied; `CLAUDE.md` switched to PR workflow;
  M7+ plan refined. (M3 follow-up) release-please `initial-version` set (e.g. `0.1.0`) so it never proposes
  1.0.0 early; maintainer enables "Allow GitHub Actions to create and approve pull requests". (Pre-release) release-please runs only on manual dispatch; the maintainer cuts the release, then the `push` trigger is restored.

## M7+ – Later (not in MVP)

* **M10 School, later** (the rest of M10 after T-33–T-38, if wanted): optional
  school-holiday feed (public iCal per region) that hides events marked `#schule` during
  holidays; a full timetable as a separate per-child view (all subjects would crowd the board).
* **M7 Routines** – routine checklist (e.g. brush teeth, get dressed) with reward stars,
  stored locally on the tablet; optional emoji asset set (ADR-0009).
* **M8 Parent mode** – PIN-protected settings overlay (refresh, night mode override, locale); reuses the M11 parent lock (ADR-0013).

---

## Change log

| Date | Change | Reason |
|---|---|---|
| 2026-11-22 | Initial plan | Phase 0 |
| 2026-11-23 | M9 after the milestone review and the UI/UX click test: T-47.4 snow ❄️; T-47.5 new clothing thresholds, rain/snow boots, two drawn pictograms (warm hat, sweater), priority order; T-49.2 evening lead with tomorrow's weather, 🌡️ chip, one-line fit, short dates; T-49.3 week weather row above the weekday; forecast via `timeformat=unixtime` (ADR-0015) | Click test (Haiku/Sonnet/Opus): tomorrow's rain clothes next to today's sun, no hat/sweater, boots and sunscreen in summer storms; review: Open-Meteo ignores DST inside the range |
| 2026-11-23 | New milestone M9 Weather and what to wear (T-47–T-49) before v1.0.0, pulled forward from "Later"; ADR-0015; T-28 also depends on M9 | Maintainer request: weather with temperature and child-friendly clothing pictures for today and tomorrow |
| 2026-11-23 | T-46: user docs for the editor (README, DEPLOY, CONFIG EN + DE) deferred | Maintainer: the feature is not final yet, docs would change too much |
| 2026-11-23 | T-46b added: Google calendars optional, deploy form asks only for access token, PIN and config | Maintainer testing the deploy button: too many fields; with the editor storing entries in D1 the iCal feeds are no longer required |
| 2026-11-23 | T-46 split: T-46a (worker phone feed) and T-46 (link in the parent area, e2e, docs); the feed token moves from a path segment to the query (`/api/feed.ics?token=`) | Workers Logs redact query strings (`redact_query_string`) but not path segments; the worker part could be built in parallel to T-45 |
| 2026-11-23 | T-43: Google template suggestions use the cached feed window (today − 1 to today + 28) instead of 8 weeks back | Looking 8 weeks back would need a second feed expansion per request, outside the Workers CPU budget (ADR-0003); app entries still count 8 weeks back |
| 2026-11-23 | T-42/T-43: PIN errors answer 403 (`wrong_pin`, `parent_locked`), 401 stays reserved for the access token; unlock attempts are reserved before the PIN compare (a success deletes its reservation) | The board client wipes its access token on any 401; reserving first closes the parallel-request bypass of the lockout (T-42 review) |
| 2026-11-23 | M11 reworked after the maintainer's storage decision: app entries stored by KidBoard in the family's D1 (ADR-0014) instead of writing to Google; tasks now T-39–T-46 (entry store, board merge, parent lock, editor API, gate, screens, phone feed/docs); ADR-0012 deferred to an optional later Google sync | Per-family Google Cloud setup judged too complicated; central Google sign-in needs verification and a central service |
| 2026-11-23 | New milestone M11 Parent editor (T-39–T-45, exit review + UI/UX click test) before v1.0.0; ADR-0012 (write via Google Calendar API with a service account, reading stays on iCal) and ADR-0013 (parent PIN, sessions, lockout); non-goals updated; T-28 also depends on M11; M12 setup wizard noted as an idea | Maintainer wants to maintain entries in the app (child, activity, once/weekly) instead of typing title conventions in Google Calendar |
| 2026-11-23 | New milestone M10 School (bring list from event description, evening-before 🎒 reminder, later holidays/timetable), scheduled right after v1.0.0 | Maintainer request: school subjects where children must bring something |
| 2026-11-23 | M10 School items 1–3 planned as a milestone before v1.0.0 (T-33 bring list parsing, T-34 subject icons + emoji baseline, T-35 bring chips, T-36 evening-before 🎒 area, T-37 fixtures/demo/e2e/screenshots, T-38 docs, M10 exit review); ADR-0010 (bring list from the description, server-side) and ADR-0011 (Emoji 13.0 baseline for built-in icons, 🛝 replaced); T-28 now depends on M10 and stays last; holiday feed and timetable stay in "Later" | Maintainer wants the school features in the first release; the release itself is cut later by the maintainer |
| 2026-11-23 | T-36.3 reworded: the 🎒 area draws one row per group with a visible day cue, budgeted against the list minimum (`listMinRem`); bring chips on narrow tiles 28px (week-slim 24px) | M10 exit UI/UX check: a single shared row hid a child's school items behind "+4", and evening and morning looked identical |
| 2026-11-23 | T-27a outcome: tile size ladder extended with space-based steps (`medium`, dense 2.75rem emoji, `slim` 2rem emoji row tiles; week `week-small`/`week-slim` with 16–18px time-of-day badge on the emoji corner) so "+N" only appears when another tile cannot fit; remaining week polish tracked as issue #5 | UI/UX dummy test loop (4 rounds): showing every event beats a larger emoji on dense days |
| 2026-11-22 | M5b review: dense overview tiles may use ~3rem emoji (large tiles stay ≥ 3.5rem, T-30b criterion met); English title truncation, week past-event ranking, 🌞/☀️ pair, skeleton header jump become explicit T-27a checks; T-27 docs scope extended (overview, rail, states, `KB-*` codes, CONFIG `bands` wording) | M5b milestone review by reviewer-opus: 3.5rem emoji in a 4rem dense tile tucked under the child edge |
| 2026-11-22 | release-please switched to manual dispatch; early 1.0.0 release PR closed by the maintainer, who cuts the release himself | The automatic release PR proposed 1.0.0 too early |
| 2026-11-22 | T-26 (Vercel) removed from v1.0.0, tracked as issue #3; T-27 no longer depends on it | Maintainer decision: Cloudflare is the only deploy target for v1.0.0 |
| 2026-11-22 | New T-27a: mandatory UI/UX dummy test loop with three agents (Haiku, Sonnet, Opus) before the release, fix + Sonnet re-check until clean | Maintainer request before v1.0.0 |
| 2026-11-22 | M5b refined after a design × built-app comparison (child UX, tech, a11y/kiosk): merge rules 1–6, new T-29a (stable test hooks), T-30 split into T-30a (model/layout) and T-30b (UI + rail), acceptance criteria extended; T-25 kept as done (built before the hand-off landed) | Keep what the built app already solved (one symbol per meaning, no silent hiding, AA for past events, kiosk/boundary behaviour) while adopting the new look |
| 2026-11-22 | New milestone M5b (T-29–T-32): adopt the design hand-off in `docs/design/`; M6 continues after M5b (T-25 was already built before) | Final design from Claude Design replaces the placeholder theme and the band layout before v1.0.0 |
| 2026-11-22 | M4 review follow-ups: burn-in inner wrapper + fixed toggle place (T-22), glanceability pass (T-24), boundary reset test (T-20), night contrast for new surfaces (T-21), single fixture date constant (T-23) | M4 milestone review by reviewer-opus |
| 2026-11-22 | T-18: the meal plan is shown inside the week columns instead of a separate meal screen | No extra screen, one glance: children and parents see events and meals of the whole week at once |
| 2026-11-22 | M3 review: agenda `days` limit 14 → 31 and client range 8 → 31 (T-19, shared query for day/week/countdown); follow-ups to T-18 (shared frame, continuing events), T-20 (boundary auto-reset), T-21 (`useCurrentBand`), T-23 (e2e clock, `timezoneId`, docs), T-28 (release-please initial version) | M3 milestone review by reviewer-opus; countdown needs 30 days but `/api/agenda` capped at 14 |
| 2026-11-22 | M5 review follow-ups: wake lock outside the error boundary, fullscreen glyph contrast token, dense day bands without clipping (+ e2e matrix), single error announcement, demo fixture weekdays (fixed before M5 exit); CSP hash for theme boot script (T-25); kiosk tips (T-27) | M5 milestone review by reviewer-opus |
| 2026-11-22 | M2 review follow-ups: unauthorized state + boundary placement (T-15), shared today helper, offline midnight placeholder, pre-config behaviour (T-16), `formatTime` for timed events only (T-17), theme-color in night mode (T-21), offline-midnight + 401 e2e (T-23), static-asset Cache-Control + `?key=` logging check (T-25), token flow docs (T-27) | M2 milestone review by reviewer-opus |
| 2026-11-22 | M1 review follow-ups: fresh-clone `pnpm dev` (T-11), locale fallback docs (T-12), client timeout (T-13), relative dev fixture (T-24) | M1 milestone review by reviewer-opus |
| 2026-11-22 | T-10: worker cache uses an auto-provisioned KV binding (`KIDBOARD_CACHE`) with Cache API/memory fallback; cached window `[today−1, today+32)` | Cache API is a no-op on `*.workers.dev`; T-19 needs a 30-day countdown lookahead (T-10 review, structural) |
| 2026-11-22 | M0 milestone review follow-ups: `autoReturnSeconds` in T-06, `format:check` in DoD, fixture loading note in T-08, typed `Env` in T-10, tsconfig split in T-11 | Findings of the M0 review by reviewer-opus |
| 2026-11-22 | Worker test tooling renamed to `@cloudflare/vitest-plugin` (T-03, T-08, T-10) | `@cloudflare/vitest-pool-workers` is deprecated on npm and supports only Vitest 4 |
