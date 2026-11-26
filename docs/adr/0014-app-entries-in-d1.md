# ADR-0014: Entries made in the app are stored by KidBoard itself (Cloudflare D1)

- Status: accepted
- Date: 2026-11-23

## Context
The parent editor (M11) needs somewhere to write. ADR-0012 proposed writing to Google
Calendar through a service account, which requires every family to create a Google Cloud
project, a service account and a key and to share calendars with it. The maintainer judged
that too complicated for families: setting up the editor should need nothing beyond the
deploy form. A central "Sign in with Google" app was rejected too: Google can only grant
access to *all* calendars or to calendars the app created itself, a central OAuth app
needs Google verification and a central token service run by the maintainer, which
contradicts "self-hosted per family, no central platform" (ADR-0002).

## Options
1. **Store app entries in the family's own Cloudflare deployment** and merge them with the
   Google feeds on the board. Google optional later (ADR-0012 as an add-on).
   * a. Workers KV (already bound for the cache): eventually consistent, a saved entry may
     be missing from the next read for up to about a minute, last write wins on one
     document.
   * b. **Cloudflare D1** (SQLite): strongly consistent, transactions, generous free tier,
     auto-provisioned by `wrangler deploy` and the deploy button from an id-less binding,
     point-in-time restore (Time Travel).
   * c. Durable Objects: strongly consistent, but more code and concepts for no gain here.
2. Service account per family (ADR-0012) as the only way - rejected as the default (setup).
3. Central OAuth app - rejected (verification, central service, all-calendar access).

## Decision
Option 1b. ADR-0012 stays the design for an **optional Google sync** added later; until
then app entries live only in KidBoard.

* **Binding:** `KIDBOARD_DATA` (D1) declared in `wrangler.jsonc` without an id, so the
  deploy button, Workers Builds and `wrangler deploy` provision it; `wrangler dev` and the
  vitest plugin use a local database. The schema is created by the worker on first use
  (`CREATE TABLE IF NOT EXISTS`, schema version table) so no manual migration step exists
  for families; later schema changes are forward-only steps in the same code path.
* **Storage shape:** one row per entry: `id` (random), `revision` (integer, optimistic
  concurrency: an update names the revision it edited, a mismatch → 409), `kind`, `data`
  (the validated `EditorEntryInput` JSON of `packages/shared`, ADR-0012 model),
  `exdates` and per-occurrence overrides for "only this day" edits of a series,
  `created_at`, `updated_at`. Limits: 1 000 entries, 8 KB per entry. 1 000 entries is
  also the supported size of one import: the import is written in one `db.batch` (one
  transaction, all or nothing) with about one statement per entry, and its body limit is
  sized for the largest export (about 8.3 MiB). Larger documents are refused
  (`limit_reached`) rather than split, so an import never lands half-way.
* **One read path:** the worker renders the stored entries as an in-memory iCalendar with
  ical.js (the same title and description conventions as hand-written Google events,
  ADR-0005/ADR-0010, through `composeTitle`/`composeDescription`/`buildRecurrence`) and
  feeds it through the existing expansion and normalization (ADR-0003). The board sees two
  virtual sources `app-events` and `app-meals` next to the configured Google calendars.
  Every write replaces a random change stamp in D1 in the same batch as the write, so a
  committed write always comes with a new stamp and every isolate rebuilds its cached
  app sources on its next agenda request; the writer also drops its cached copies. The
  board shows a change on its next refresh (the editor triggers that refresh at once). Recurrence, DST, bring
  lists and countdown therefore behave exactly as for Google events.
* **Google entries stay read-only** in the editor (shown with "change in Google Calendar"),
  but can be used as templates ("make an app entry like this").
* **Off by default:** the editor exists only with `KIDBOARD_DATA` bound, a valid
  `KIDBOARD_PARENT_PIN` and an access token `KIDBOARD_ACCESS_TOKEN` (ADR-0013); the deploy
  form asks for the PIN next to the access token. Without them KidBoard is the
  read-only board it was.
* **Getting data out:** the parent area offers a JSON export and import (backup, moving to
  a new deployment), and an optional secret iCal feed of the app entries
  (`/api/feed.ics?token=<feed token>`) that parents can subscribe to in Google Calendar or Apple
  Calendar on their phones (read-only there; Google refreshes subscriptions slowly).
* **Privacy:** descriptions of app entries contain only what the editor writes (bring line,
  `#countdown`); D1 lives in the family's own Cloudflare account.

## Consequences
* Families need no Google Cloud setup; the editor works right after the deploy.
* Entries made in the app are not in Google Calendar unless the phone feed is subscribed
  or the later Google sync (ADR-0012) is turned on; parents edit them in KidBoard (on the
  tablet or on a phone browser with the same link).
* New binding `KIDBOARD_DATA` (D1); free-tier limits are far above a family's use.
* New dependency `timezones-ical-library` (Apache-2.0, tzdb-based VTIMEZONE data) for the
  phone feed: RFC 5545 requires a VTIMEZONE per TZID and clients such as Outlook need it,
  ical.js ships no zone data, and UTC times would shift weekly series at DST switches.
* The T-39 Google conversion helpers (event conversion, target calendar, recurrence parsing)
  were removed as unused; the git history keeps them for an optional sync (ADR-0012).

## Note (2026-11-23, T-46b): app entries are the default source

App entries in D1 are the default source of the board; Google Calendar feeds are an
optional add-on. `KIDBOARD_CONFIG` may list no calendars (`calendars` defaults to `[]`),
so the "Deploy to Cloudflare" form asks only for `KIDBOARD_ACCESS_TOKEN`,
`KIDBOARD_PARENT_PIN` and `KIDBOARD_CONFIG` (KV and D1 are created automatically).
Families add Google later by listing `calendars` in the config and setting one
`CAL_<ID>_URL` secret per calendar in the dashboard; deployments with calendars behave as
before. With no calendars the editor shows no Google entries or templates and the meal band
holds app meals only. With no calendars and the editor off there is no source at all: the
worker logs one configuration warning and `/api/agenda` answers `200` with an empty board
(not `502`).
