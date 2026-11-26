# Deploy KidBoard to Cloudflare

[Deutsch](DEPLOY.de.md)

KidBoard runs as **one Cloudflare Worker**: it serves the board (static assets from
`apps/web/dist`) and the JSON API under `/api/*`, stores the entries made in the parent
editor and, optionally, reads your Google calendars' secret iCal addresses on the server.
The Workers Free plan is enough for a family. You get a URL like
`https://kidboard.<your-subdomain>.workers.dev`.

Everything Wrangler needs is in the root [`wrangler.jsonc`](../wrangler.jsonc). Secrets
never go into the repository: they are Worker secrets in your Cloudflare account.

## 1. Before you start

You need:

1. A free **Cloudflare account** (and for option A a GitHub or GitLab account).
2. An **access token** (required): a random string of 32 to 256 characters (`A-Z a-z 0-9 _ -`),
   for example the output of `openssl rand -hex 32`. Without a valid one the API refuses
   every request (`500 server_misconfigured`), so your calendar is never public by accident.
   A deliberately public board needs the explicit opt-in `KIDBOARD_PUBLIC="1"` (and no token).
3. A **parent PIN** of 6 to 12 digits for the editor. Not a single repeated digit or a run
   like `123456`, and no birthdays: the editor stays off with a log message if the PIN is too
   easy to guess. Five wrong PINs lock the editor, the lock time doubles with every further
   lockout (15 minutes up to 2 hours).
4. Your **settings** (`KIDBOARD_CONFIG`) as **one line of JSON**: children, time zone, ...
   The deploy form pre-fills an example with two children and no calendars. All options are
   in [CONFIG.md](CONFIG.md).
5. Optional, also later: the **secret iCal address** of every Google calendar you want to
   show. Google Calendar (web): Settings > your calendar > "Integrate calendar" > **Secret
   address in iCal format**. Treat it like a password: anyone with it can read the
   calendar. List each calendar in `calendars` of `KIDBOARD_CONFIG` and add a matching
   secret `CAL_<ID>_URL` (id in upper case: `kinder` -> `CAL_KINDER_URL`). To turn a config
   file such as [`config.example.json`](../config.example.json) into one line:

   ```sh
   node -e "process.stdout.write(JSON.stringify(require('./config.example.json')))"
   ```

## 2. Secrets and variables

The worker reads exactly these names (`apps/worker/src/env.ts`):

| Name                       | Kind                | Required | Notes                                                                                            |
| -------------------------- | ------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `CAL_<ID>_URL`             | secret              | per calendar (optional) | Only for calendars listed in `KIDBOARD_CONFIG`, e.g. `CAL_KINDER_URL`. A missing one only marks that calendar as `error`. |
| `KIDBOARD_ACCESS_TOKEN`    | secret              | yes      | 32 to 256 characters `A-Z a-z 0-9 _ -`. Unset, empty, too short or still containing `REPLACE_ME`: the API answers `500` (fail closed). Needed for the editor. |
| `KIDBOARD_PUBLIC`          | variable            | no       | `1` = public read-only board without a token (opt-in; ignored when a token is set). |
| `KIDBOARD_CONFIG`          | secret or variable  | yes      | Single-line JSON. Missing/invalid: `/api/config` and `/api/agenda` answer `500`.                 |
| `KIDBOARD_ALLOWED_ORIGINS` | variable            | no       | Only for cross-origin API use; the board itself is same-origin.                                  |
| `KIDBOARD_CACHE_TTL`       | variable            | no       | Seconds a feed counts as fresh, default 3600.                                                    |
| `KIDBOARD_CACHE`           | KV namespace binding | automatic | Declared without an id in `wrangler.jsonc`; Wrangler creates it on the first deploy.            |
| `KIDBOARD_PARENT_PIN`      | secret              | no       | 6 to 12 digits; turns on the parent editor (with `KIDBOARD_DATA` and a valid `KIDBOARD_ACCESS_TOKEN`). Unset, invalid, too easy (`111111`, `123456`) or `REPLACE_ME`, or no valid access token = editor off. |
| `KIDBOARD_DATA`            | D1 database binding | automatic | Entries made in the editor (ADR-0014). Declared without an id in `wrangler.jsonc`; Wrangler creates it on the first deploy, the worker creates its tables. |
| `KIDBOARD_FEED_TOKEN`      | secret              | no       | Turns on the phone feed of the editor's entries (32 to 256 characters `A-Z a-z 0-9 _ -`); the parent area then shows the subscribe link. Unset = no feed. |

Plain-text variables set in the dashboard survive later deploys (`keep_vars: true`);
secrets always do. The template for all of them is [`.dev.vars.example`](../.dev.vars.example).

## 3. Option A: "Deploy to Cloudflare" button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/FinkeFlo/kidboard)

1. Click the button and log in to Cloudflare.
2. Connect GitHub or GitLab and choose a name for the new repository. Cloudflare copies
   KidBoard into your account; later pushes to it redeploy automatically. This copy is
   separate from this repository: new KidBoard versions do not reach it by themselves.
3. Keep or change the **Worker name** (default `kidboard`, it becomes part of the URL) and
   keep the suggested **KV namespace** (`KIDBOARD_CACHE`) and **D1 database**
   (`KIDBOARD_DATA`).
4. Fill in the three secrets the page asks for (taken from `.dev.vars.example`):
   `KIDBOARD_ACCESS_TOKEN`, `KIDBOARD_PARENT_PIN` and `KIDBOARD_CONFIG` (change the example
   children). **Replace every `REPLACE_ME`** (only `KIDBOARD_PARENT_PIN` may keep it: the
   parent editor then stays off). Google calendars are not asked for; add them later
   (step 7).
5. Check the build settings. The repository is a pnpm monorepo, so the build must run in
   the repository root:
   - Root directory: empty (repository root)
   - Build command: `pnpm run build` (pre-filled from `package.json`; builds the web app,
     then dry-runs the worker)
   - Deploy command: `npx wrangler deploy` (the default; uses the `wrangler` version pinned
     in the root `package.json` and the root `wrangler.jsonc`)

   Node.js 22 comes from `.nvmrc`, pnpm from the `packageManager` field.
6. Create and deploy. The first build takes a few minutes.
7. Google calendars or a changed setting: Workers & Pages > your Worker > Settings >
   Variables and Secrets. Add `calendars` to `KIDBOARD_CONFIG` and one `CAL_<ID>_URL` per
   calendar (Add, type "Secret"). Saving deploys a new version.

## 4. Option B: from a local clone (Wrangler CLI)

Requires Node 22 and pnpm 10 (`corepack enable`).

```sh
git clone https://github.com/FinkeFlo/kidboard.git && cd kidboard
pnpm install
pnpm exec wrangler login          # opens the browser once
pnpm deploy:cloudflare            # builds apps/web, then `wrangler deploy`
```

The first deploy creates the Worker, its KV namespace and its D1 database. Then set the secrets (each command
prompts for the value; every change is deployed at once):

```sh
pnpm exec wrangler secret put KIDBOARD_ACCESS_TOKEN
pnpm exec wrangler secret put KIDBOARD_PARENT_PIN
pnpm exec wrangler secret put CAL_KINDER_URL       # optional: one per calendar, CAL_<ID>_URL
node -e "process.stdout.write(JSON.stringify(require('./my-config.json')))" \
  | pnpm exec wrangler secret put KIDBOARD_CONFIG
```

Or all at once from a filled-in copy of the template, which is git-ignored because of its
name: copy `.dev.vars.example` to `.dev.vars.production`, fill it in, run
`pnpm exec wrangler secret bulk .dev.vars.production` and delete the file afterwards.

Updating later: `git pull && pnpm install && pnpm deploy:cloudflare`. Secrets stay.

## 5. Check the deployment

Replace `<url>` and `<token>`:

```sh
curl -s https://<url>/api/health                                         # {"ok":true}
curl -s -H "Authorization: Bearer <token>" https://<url>/api/config      # your public settings
curl -s -H "Authorization: Bearer <token>" "https://<url>/api/agenda?days=3"
```

In the agenda answer every entry of `sources` should have `"status":"ok"` (without Google
calendars and with the editor off the list is empty). `"error"` means that calendar's
secret is missing, misspelled or the address is wrong.

Then open **`https://<url>/?key=<token>` once on the tablet**. The board stores the token,
removes it from the address bar and from then on sends it as a header. Install it as an app
(browser menu > "Add to home screen") or point your kiosk browser at `https://<url>/`.

Changing the token: set a new `KIDBOARD_ACCESS_TOKEN`; the tablet then says "This tablet
needs a new access link", wipes its stored calendar data and forgets the old token until you open
a new `?key=` link.

## 6. Optional: custom domain

Worker > Settings > Domains & Routes > Add > Custom domain (the domain must be on
Cloudflare). The board works the same; the Cache API is then available as an extra fallback
(on `workers.dev` the worker relies on the KV namespace, ADR-0006).

## 7. HTTP caching and security headers

Checked against the Cloudflare docs (Workers Static Assets, "Headers") and with
`wrangler dev`: every static asset is served with **`Cache-Control: public, max-age=0,
must-revalidate`** plus an `ETag`. That holds for `sw.js`, `index.html` (also as the
single-page-application fallback) and `manifest.webmanifest`, so browsers revalidate them
on every use and a new deploy is picked up at once; nothing is cached too long, and
KidBoard does not override it. Hashed files under `/assets/` are also revalidated (cheap
`304`) and the service worker keeps its own copy anyway.

`vite build` generates `apps/web/dist/_headers` (`apps/web/headers/staticHeaders.ts`),
which Workers Static Assets applies to all static responses:

- `Content-Security-Policy`: only same-origin resources, no `eval`, no inline code except
  the theme boot script in `index.html`, allowed by its SHA-256 hash. The hash is computed
  from the built file on every build, so it cannot go stale.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` (the first visit's
  `?key=` is never sent as a referrer), `Permissions-Policy` without camera, microphone,
  geolocation, payment and USB (wake lock and fullscreen stay allowed).
- Framing is limited to the board's own origin (`frame-ancestors 'self'`), so other sites
  cannot embed it. To embed it in a dashboard (e.g. Home Assistant), add that dashboard's
  origin to `FRAME_ANCESTORS` in `apps/web/headers/staticHeaders.ts`.

`_headers` does not apply to `/api/*`: the worker answers those itself with
`Cache-Control: no-store`, `nosniff` and `Referrer-Policy: no-referrer`.

## 8. Logs and the `?key=` link

- **Workers Logs** (enabled in `wrangler.jsonc`, the default for new Workers) record one
  invocation log per **Worker invocation**, with method and URL. The `/?key=…` page load
  never invokes the Worker: `/` is a static asset, only `/api/*` runs the Worker first
  (`run_worker_first`), and since compatibility date 2025-04-01 navigations prefer asset
  serving. So the link with the token is **not** in Workers Logs, and therefore not in
  Workers Logpush (`workers_trace_events`) or Tail Workers either. Local check with
  `wrangler dev`: the captured traces contained only the `/api/*` requests.
- API requests carry the token in the `Authorization` header; Cloudflare's trace events
  redact header values whose name contains "auth", "key" or "token" by default. The API also accepts `?key=` (e.g. for `curl`);
  `observability.redact_query_string: true` removes query strings from logged URLs.
- **Not covered:** zone-level HTTP request logs. With a custom domain, Cloudflare's HTTP
  request logs (Logpush dataset `http_requests`, Enterprise plans) and analytics can
  contain the full request URL including `?key=`. The token also stays in the browser
  history of the device on which you opened the link, and in the place you sent the link
  through. Open it directly on the tablet, and rotate the token if the link leaks.
- KidBoard itself never logs feed URLs, tokens or calendar content (only ids, secret
  _names_ and reason codes).

## 9. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Board says "This tablet needs a new access link" | Wrong or changed token: open `https://<url>/?key=<token>` again. |
| `/api/config` answers `500 server_misconfigured` | `KIDBOARD_CONFIG` missing or invalid (Workers Logs list the validation errors), or `KIDBOARD_ACCESS_TOKEN` is missing, shorter than 32 characters, uses other characters or still contains `REPLACE_ME` (the log names the reason). |
| Editor locked for a long time | Wrong PINs were entered repeatedly (the lock doubles, up to 2 hours at a time) and ends by itself. A holder of the access token can repeat this: rotate `KIDBOARD_ACCESS_TOKEN` and open the tablet link again. |
| A calendar is missing, `sources[].status` is `error` | Secret name does not match the calendar id (`CAL_<ID>_URL`, upper case) or the iCal address is wrong. |
| Build fails with a pnpm error | Add the build variable `PNPM_VERSION=10.28.0` (Worker > Settings > Build). |
| `The directory specified by the "assets.directory" field ... does not exist` | The web app was not built: use `pnpm deploy:cloudflare` or the build command `pnpm run build`. |
| Old version still shown | The tablet checks for a new version hourly and reloads itself; or reload once. |

## How this guide was verified

Without a Cloudflare account (no real deploy): `pnpm exec wrangler deploy --dry-run`
(also in CI) and `pnpm deploy:cloudflare --dry-run` with the root config; `wrangler dev`
with fake secrets (`TESTONLY-not-a-secret` token, calendars from `fixtures/ics` on a local
HTTP server), `curl` against `/api/health`, `/api/config`, `/api/agenda` (with and without
token) and the static paths (`Cache-Control`, `_headers`), and a headless Chromium opening
`/?key=…` (token stored and stripped, service worker active, zero CSP violations). The
button flow, Workers Builds and the production log behaviour follow the Cloudflare docs and
need a real account to confirm.
