# ADR-0012: Editing entries through the Google Calendar API with a service account

- Status: deferred – the default storage for app entries is ADR-0014; this ADR is the
  design for an optional Google sync added later. The unused Google write code (event
  conversion, target calendar, recurrence parsing) was removed from the repository; the git
  history keeps it should this ADR be taken up.
- Date: 2026-11-23

## Context
Until now KidBoard only *reads* the calendars' secret iCal addresses (ADR-0003, ADR-0006)
and parents edit events in the Google Calendar app. In practice the title convention
(`Mia: 🏊 Schwimmen`, `Mittag: 🍝 Spaghetti`, a `Mitbringen:` line in the description) is
hard to remember and easy to get wrong on a phone. The maintainer wants a parent editor in
the app: pick the child, pick the kind of activity (icon), choose once or weekly, done.

Writing needs the Google Calendar API (`events.insert`, `events.patch`, `events.delete`);
an iCal address is read-only. KidBoard is self-hosted per family through a deploy button
(ADR-0002): no central server, no accounts, no database, and every setup step has to be
doable by a non-developer once.

## Options
1. **Service account + calendars shared with it.** The family creates a Google Cloud
   project, enables the Calendar API, creates a service account and a JSON key, and shares
   each KidBoard calendar with the service account's e-mail address ("Make changes to
   events"). The Worker signs a JWT with the key and exchanges it for an access token
   (OAuth 2.0 JWT bearer grant, scope `https://www.googleapis.com/auth/calendar.events`).
   No consent screen, no refresh token that can expire, no redirect URL, works with
   personal Gmail accounts because only calendars explicitly shared are reachable.
2. **OAuth 2.0 web flow with a refresh token** stored in KV. Needs an OAuth consent screen,
   a redirect URL per deployment, and while the app stays in "Testing" Google expires
   refresh tokens after 7 days; publishing an app with a sensitive scope shows "unverified
   app" warnings. Grants access to *all* of the parent's calendars.
3. **Write somewhere else** (KV/D1 as the source of truth, Google read-only). Splits the
   data in two places, parents lose editing in the Google app, sync conflicts.
4. **Client-side Google Identity Services** on the tablet. Puts Google tokens on a kiosk
   device that children use; contradicts "no secrets on the tablet".

## Decision
Option 1.

* **Secrets:** `GOOGLE_SERVICE_ACCOUNT_KEY` = the whole downloaded JSON key (only
  `client_email`, `private_key`, `private_key_id`, `token_uri` are used). Optional per
  calendar `CAL_<ID>_GOOGLE_ID` with the Google calendar id; when absent the id is derived
  from the secret iCal address (`https://calendar.google.com/calendar/ical/<id>/private-…/basic.ics`,
  URL-decoded). Neither ever reaches the client, logs or error messages.
* **Signing:** `jose` (MIT, WebCrypto, runs in Workers; `importPKCS8` + `SignJWT`, RS256)
  instead of custom ASN.1/JWT code. Access tokens are cached per isolate until 60 s before
  expiry. The Google REST endpoints are called with `fetch` (the official Node client does
  not run in Workers); timeouts and response size limits as for feeds.
* **Reading stays on iCal.** The board keeps reading the secret iCal addresses (one read
  path, ADR-0003 expansion unchanged). After a successful write the worker drops the
  cached entry of that source (memory + KV/Cache API), so the next `/api/agenda` refetches
  the export. Google's secret iCal *export* is expected to reflect changes within minutes
  (the well-known multi-hour lag concerns Google's *import* of foreign feeds); this is not
  guaranteed by Google, so if the export lags the next TTL refresh picks it up, and the
  editor says "the board updates within a few minutes" instead of promising "now". If real
  deployments show long lags, reading writable calendars through the API is the follow-up
  (separate ADR). The editor itself lists entries through the API
  (`events.list`, `singleEvents=true`) because it needs Google event ids.
* **Same conventions as hand-written events.** The editor writes exactly the title and
  description conventions of ADR-0005/ADR-0010 (`Mia, Ben: 🏊 Schwimmen`,
  `Mittag: 🍝 Spaghetti`, a `Mitbringen:` line, `#countdown`). Entries made in the app
  look normal in the Google app and vice versa; no new data model on the read side. On
  edit, the rest of an existing description (private notes) is preserved byte for byte;
  only the bring line and the `#countdown` marker are replaced.
* **Recurrence:** "once" or "weekly" (weekdays, interval 1 or 2 weeks, optional end
  date) as one `RRULE:FREQ=WEEKLY;…` line, with `start.timeZone` = configured zone so DST
  keeps the wall-clock time. Series edits support "only this one" (patch/delete the
  instance) and "the whole series" (patch the master). Existing series with rules the
  editor cannot express are shown read-only for their recurrence ("repeats – edit in
  Google Calendar") but their text, icon and children stay editable.
* **Target calendar:** events go to the calendar of the single selected child if that
  calendar is writable (`childId` set), otherwise to the first writable `events` calendar
  without `childId`; meals go to the first writable `meals` calendar. Existing entries
  stay in their calendar.
* **Off by default.** Without `GOOGLE_SERVICE_ACCOUNT_KEY` and `KIDBOARD_PARENT_PIN`
  (ADR-0013) the editor does not exist (routes 404 → `/api/config` says
  `editor: false`); KidBoard stays the read-only board it was.

## Consequences
* One-time setup for families (≈ 10 minutes, documented step by step EN + DE): Google
  Cloud project, enable Calendar API, service account, JSON key, share calendars, two
  secrets. Google Workspace organizations that forbid service account keys or external
  sharing cannot use the editor (the board still works).
* New dependency `jose` in the worker only.
* New attack surface: write endpoints. Protected by the board access token *and* the
  parent PIN session (ADR-0013); a stolen tablet token alone cannot write.
* The service account sees only calendars shared with it; it cannot read the parents'
  other calendars.
* Rejected for now, possible later: a click-through setup wizard that stores the config
  (children, colours, calendars) in KV instead of the `KIDBOARD_CONFIG` JSON (M12 idea).
