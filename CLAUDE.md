# CLAUDE.md – KidBoard

KidBoard is an open-source, icon-first family calendar and meal plan for a wall-mounted
tablet in kiosk mode (children ~3–8, many cannot read). Parents edit Google Calendar;
KidBoard reads secret iCal feeds server-side and shows day/week views. Everything is
original work – **never copy texts, graphics, names or layouts from third-party products**.

* Plan (binding): [`docs/PLAN.md`](docs/PLAN.md) · Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
* Decisions: [`docs/adr/`](docs/adr/) · Progress: [`docs/PROGRESS.md`](docs/PROGRESS.md)
* Design hand-off (when present): [`docs/design/`](docs/design/)

## Layout

```
apps/web        Vite + React 19 + Tailwind 4 PWA (UI only)
apps/worker     Cloudflare Worker (Hono): iCal → JSON API, serves apps/web/dist
packages/shared Pure TS: data model, zod schemas, title parser, date helpers
fixtures/ics    Synthetic .ics fixtures (never real data)
docs/           Plan, ADRs, architecture, progress, design, screenshots
```

## Commands

```
pnpm install
pnpm dev            # web (Vite) + worker (wrangler dev)
pnpm lint           # ESLint (flat config)
pnpm format:check   # Prettier
pnpm typecheck      # tsc across all packages
pnpm test           # Vitest (shared, web, worker)
pnpm test:e2e       # Playwright (tablet 1280x800 + 2000x1200)
pnpm build          # all packages
```

Quality gate before every commit: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build`
(`pnpm test:e2e` needs `pnpm build` first). Also run gitleaks before pushing when tests contain
secret-like strings (`gitleaks git . --redact`); CI fails on any finding. Synthetic test markers should be
low-entropy (e.g. `TESTONLY-not-a-secret`); true false positives go into `.gitleaksignore`.

## Non-negotiable rules

1. **Context7 first.** Before using or configuring any library, framework, CLI, cloud API
   or config file: `resolve-library-id` + `query-docs` via Context7, work from current docs.
   If Context7 is unreachable: stop and report, do not guess.
2. **Existing before custom.** Prefer maintained, widely used libraries (MIT/Apache/BSD
   compatible, browser/Worker compatible). Custom code only with a justification in an ADR.
3. **No secrets in the repo.** iCal URLs only as env vars / Worker secrets (`CAL_<ID>_URL`).
   Never in the client bundle, logs, error messages or fixtures. `.env*` / `.dev.vars*`
   except the `*.example` files are git-ignored. gitleaks runs in CI.
4. **The plan is law.** Work `docs/PLAN.md` tasks in order. Plan changes only consciously:
   edit PLAN.md + change-log entry + own commit `docs(plan): …`.
5. **Git:** until `v1.0.0` commit directly to `main`; small Conventional Commits
   (`feat(scope): … (T-xx)`); every commit builds and passes the gate.
6. **Quality over speed:** TypeScript `strict`; no `any` without a justifying comment; no
   disabled lint rules or skipped tests to get green.
7. **Accessible & child-friendly:** WCAG AA contrast, touch targets ≥ 64 px for child
   interactions, respect `prefers-reduced-motion`.

## Code conventions

* Code, comments, commits: English. User docs: EN + DE. UI strings: only via i18n
  (`apps/web/src/i18n/locales/{de,en}.json`), both locales complete.
* Calendar titles are untrusted plain text: render as React text only, never
  `dangerouslySetInnerHTML` (lint: `react/no-danger`).
* Time logic always takes the configured IANA zone explicitly (`@date-fns/tz`); never rely
  on the device time zone. iCal handling via ical.js only (ADR-0003).
* Styling only through design tokens (CSS variables in `apps/web/src/styles/tokens.css`,
  exposed via Tailwind `@theme`). No raw hex colors in components.
* `packages/shared` stays runtime-agnostic: no DOM, no Worker globals, no Node built-ins.
* Tests live next to code (`*.test.ts(x)`); E2E in `apps/web/e2e/`.
* Named exports, small modules, explicit return types on exported functions.

## Builder/Reviewer loop (per task T-xx)

1. **builder** (Sonnet; `builder-opus` for high-risk tasks) gets task id, goal, acceptance
   criteria, affected files, relevant ADRs. Checks APIs via Context7, implements, writes
   tests, runs the quality gate, reports a short summary + changed files. Does not commit.
2. **reviewer** (Sonnet; `reviewer-opus` for high risk) gets only task, acceptance criteria
   and the diff (not the builder's reasoning). Checks each criterion with evidence,
   correctness/edge cases, test meaningfulness, API use vs Context7 docs, security
   (secrets, XSS via titles, CORS), a11y, i18n, CLAUDE.md + plan compliance, and re-runs all
   checks. Output strictly `VERDICT: PASS` or `VERDICT: CHANGES_REQUESTED` + numbered list.
3. On changes requested: builder fixes exactly those points → re-review. Max 3 rounds,
   from round 3 escalate to Opus. After 5 failed rounds: stop, document in PROGRESS.md, ask.
4. On PASS: orchestrator commits, pushes, ticks the task in PLAN.md, updates PROGRESS.md.
5. After each milestone: `reviewer-opus` reviews the whole milestone; CI on GitHub must be
   green before the next milestone.

Escalate to Opus when: a task failed review twice in a row; high-risk work (iCal/recurrence,
time zones/DST, security/secrets, caching/offline, CI/release, architecture); or the
reviewer reports a structural problem. Log every escalation in PROGRESS.md.

## Definition of Done

See `docs/PLAN.md` → "Definition of Done".

## Environment notes

* Node 22 LTS, pnpm 10 (via `packageManager`/corepack).
* Playwright: if a pre-installed Chromium is present (e.g. `/opt/pw-browsers/chromium`),
  set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use it instead of downloading browsers.
* `scripts/check-forbidden-terms.mjs` blocks terms that must never appear in files or commit
  messages (pre-commit, commit-msg and CI). Never add the decoded terms anywhere.
