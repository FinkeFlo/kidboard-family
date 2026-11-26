# KidBoard configuration

KidBoard has two kinds of settings:

1. **Secrets** (access token, parent PIN, optional iCal URLs) - Worker secrets / `.dev.vars` (repository root).
2. **Non-secret settings** - one JSON document in the `KIDBOARD_CONFIG` variable. The
   shape is shown in [`config.example.json`](../config.example.json); the worker validates
   it with the schema from `packages/shared` and exposes the public part at `/api/config`.
   JSON has no comments, so every option is documented here. All options have defaults;
   `calendars` (Google feeds) is optional: without it the board shows the entries made in
   the parent editor (ADR-0014).

Deutsche Kurzfassung am Ende dieses Dokuments.

## Secrets and environment variables

Set locally in `.dev.vars` in the repository root, next to `wrangler.jsonc` (copy from
[`.dev.vars.example`](../.dev.vars.example), dotenv format, git-ignored). In production use
`pnpm exec wrangler secret put NAME` or the hosting dashboard; step by step:
[DEPLOY.md](DEPLOY.md). All of them may be secrets; `KIDBOARD_CONFIG`,
`KIDBOARD_ALLOWED_ORIGINS` and `KIDBOARD_CACHE_TTL` may also be plain-text variables
(`keep_vars: true` keeps dashboard variables across deploys).

| Name                      | Required | Default            | Description                                                                                                                                      |
| ------------------------- | -------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CAL_<ID>_URL`            | one per calendar in `calendars` | -     | Secret iCal address of the calendar with id `<ID>` (upper case), e.g. `CAL_KINDER_URL`. Google Calendar: Settings > calendar > "Secret address in iCal format". `https://` or `webcal://` (fetched as `https://`); plain `http://` and other schemes are refused. Use your own secondary calendars (e.g. "Kinder", "Essen") instead of the main calendar: a main calendar also lists invitations you have not accepted. Never commit it. A missing or invalid value marks only that calendar as `error`. |
| `KIDBOARD_ACCESS_TOKEN`   | yes (see `KIDBOARD_PUBLIC`) | unset (API refuses, `500 server_misconfigured`) | API requests must present this token as `Authorization: Bearer <token>` or `?key=<token>`, else `401`. 32 to 256 characters of `A-Z a-z 0-9 _ -`, e.g. the output of `openssl rand -hex 32`. Unset, empty, shorter, other characters or still containing `REPLACE_ME` (the template): every protected path answers `500 server_misconfigured` and the log says why (the board fails closed, it never serves data without a valid token). Prefer the header: `?key=` ends up in browser history (Workers Logs drop query strings, `redact_query_string`). `/api/health` stays public (it only returns `{ "ok": true }`). |
| `KIDBOARD_PUBLIC`         | no       | unset              | Explicit opt-in for a public read-only board: with the value `1` **and no** `KIDBOARD_ACCESS_TOKEN`, the board is served without any check (anyone with the link sees your family's calendar; the editor stays off). If a token is set, it is enforced regardless of this variable. |
| `KIDBOARD_ALLOWED_ORIGINS`| no       | same origin only   | Comma-separated list of allowed CORS origins, e.g. `http://localhost:5173`.                                                                      |
| `KIDBOARD_CACHE_TTL`      | no       | `3600`             | Seconds a fetched feed counts as fresh (integer 60-86400; other values fall back to 3600 with a log warning). With the KV cache at least `ceil(calendars × 86400 / 500)` (KV Free plan write quota; 2 calendars → 346; with the parent editor on, its two app sources count as calendars).                                    |
| `KIDBOARD_PARENT_PIN`     | no       | unset (editor off) | 6 to 12 digits that unlock the parent editor. Not accepted (editor stays off, the log says why): unset, shorter or longer, non-digits, still `REPLACE_ME`, one repeated digit (`111111`) or a run of rising or falling digits (`123456`, `654321`). Choose something not guessable: no birthdays or dates. After 5 wrong PINs in 15 minutes the editor locks for 15 minutes; every further lockout while failures continue doubles the time (up to 2 hours); a right PIN resets this. The editor also needs a valid `KIDBOARD_ACCESS_TOKEN` and the D1 binding `KIDBOARD_DATA`. |
| `KIDBOARD_FEED_TOKEN`     | no       | unset (no feed)    | Secret token of the phone feed `/api/feed.ics?token=…` with the editor's entries; 32-256 characters `A-Z a-z 0-9 _ -`. Changing it ends every subscription. |
| `KIDBOARD_CONFIG`         | yes      | -                  | The JSON document described below (single line). Missing or invalid: the API answers `500` and the log lists the validation errors.             |

The root `.env.example` only lists tooling variables (e.g. `PLAYWRIGHT_CHROMIUM_EXECUTABLE`).

## Access token: the tablet link

The board needs the token to load data (without a valid `KIDBOARD_ACCESS_TOKEN` the API refuses
everything except `/api/health`, unless you opt in to a public board with `KIDBOARD_PUBLIC="1"`):

1. Open the board **once** on the tablet as `https://<your-worker>.workers.dev/?key=<token>`
   (for example as the Fully Kiosk start URL or in the installed app).
2. The page stores the token in the tablet's local storage and immediately **removes `?key=`
   from the address bar**, so it does not stay in the URL, bookmarks or screenshots. From
   then on it calls the API with `Authorization: Bearer <token>`.
3. Later visits need no `?key=`. A new `?key=` replaces the stored token (use it after
   rotating the token).
4. After a **`401`** (token revoked or wrong) the tablet **forgets** the stored token and shows
   "This tablet needs a new access link" (error code `KB-401`): open the tablet link with the current
   `?key=<token>` once more.

With the public opt-in (`KIDBOARD_PUBLIC="1"`, no token) nothing of this is needed. The token is not a user login, only a
shared secret for this tablet: treat the link like a password.

## `KIDBOARD_CONFIG` options

| Option                  | Type                          | Default                          | Example                         | Description                                                                                          |
| ----------------------- | ----------------------------- | -------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `locale`                | `"de"` \| `"en"` \| `"auto"`  | `"auto"`                         | `"de"`                          | UI language. `auto` follows the browser language, falling back to `de`.                               |
| `timeZone`              | IANA time zone name           | `"Europe/Berlin"`                | `"America/New_York"`            | Zone for day boundaries, bands, night mode and floating times; the device time zone is never used. Must be a valid IANA name.                        |
| `children`              | array of child                | `[]`                             | see below                       | Children shown on the board. Ids must be unique.                                                     |
| `children[].id`         | string (slug)                 | required                         | `"mia"`                         | Stable identifier.                                                                                   |
| `children[].name`       | string                        | required                         | `"Mia"`                         | Display name; also the title prefix `Mia: ...`.                                                      |
| `children[].color`      | hex colour or token name      | required                         | `"#E4572E"`                     | Child colour: tints the child's event tiles and rings the badge. A token name `child-1` ... `child-6` or a hex colour (`#rgb`, `#rrggbb`); anything else (named colours, `rgb()`, `hsl()` ...) is refused when the configuration is validated, so change old values like `"red"` to `"#cc0000"`. Text stays readable on the tint in both themes. |
| `children[].avatar`     | single emoji                  | required                         | `"🦊"`                          | The child's emoji (this is the field the schema calls `avatar`; there is no `emoji` key). Shown in the badge on the child's tiles and in the "who is who" legend. |
| `calendars`             | array of calendar source      | `[]` (no Google feeds)           | see below                       | Optional Google Calendar feeds, added any time. Ids must be unique.                                  |
| `calendars[].id`        | string                        | required                         | `"kinder"`                      | Maps to the secret `CAL_<ID>_URL`. `app-events` and `app-meals` are reserved (entries made in the app). |
| `calendars[].kind`      | `"events"` \| `"meals"`       | required                         | `"meals"`                       | Events calendar or meal plan.                                                                        |
| `calendars[].childId`   | string (child id)             | unset (event is for everyone)    | `"mia"`                         | Marks a one-calendar-per-child feed. Must reference an existing child.                               |
| `calendars[].label`     | string                        | unset                            | `"Kinder"`                      | Optional human-readable name.                                                                        |
| `bands.morningStart`    | `HH:mm`                       | `"06:00"`                        | `"06:30"`                       | Start of the morning. Together with the other two bands it picks the time-of-day icon on tiles (🌅 morning, 🌞 midday, 🌆 evening) and, for timed meals without a slot word, the meal slot. Bands are not shown as on-screen sections. Must be ascending. |
| `bands.middayStart`     | `HH:mm`                       | `"11:00"`                        | `"11:30"`                       | Start of midday. Timed meals before it are breakfast, from it until `eveningStart` lunch. Also ends the 🎒 bring area for all-day events: their icons show from `eveningStart` the day before until this time on the day itself (timed events: until they start). |
| `bands.eveningStart`    | `HH:mm`                       | `"17:00"`                        | `"17:30"`                       | Start of the evening. Timed meals from here on are dinner. Also the moment the 🎒 bring area starts: from here until midnight today's card lists what to pack for tomorrow ([README](../README.md#bring-list)). |
| `nightMode.enabled`     | boolean                       | `true`                           | `false`                         | Switch to the dark night theme (colours only, the screen stays on).                                       |
| `nightMode.start`       | `HH:mm`                       | `"19:30"`                        | `"20:00"`                       | When night mode starts.                                                                              |
| `nightMode.end`         | `HH:mm`                       | `"06:30"`                        | `"07:00"`                       | When night mode ends (may be on the next day).                                                       |
| `countdown.emojis`      | array of emoji                | `["🎂","🎉","🎁","🎄","🐣","✈️","🏖️"]` | `["🎂","✈️"]`            | Events with one of these icons (or `#countdown` in the description) get the "sleeps until" countdown. |
| `refreshMinutes`        | integer                       | `60`                             | `30`                            | How often the client refetches data.                                                                 |
| `autoReturnSeconds`     | integer                       | `120`                             | `180`                           | Seconds of inactivity before the week view returns to the four-day overview.                                         |

Validation details (schema in `packages/shared`): unknown keys are rejected (typos are
reported, not ignored); ids (children and calendars) match `[a-z0-9][a-z0-9_-]*` (max 32
chars); the secret name is the upper-cased id with `-` replaced by `_` (`school-a` ->
`CAL_SCHOOL_A_URL`), so ids that map to the same name (`a-b` and `a_b`) are rejected; the
calendar ids `app-events` and `app-meals` are reserved for the entries made in the app; child
names must be unique (case-insensitive); `refreshMinutes` is 1-1440; `autoReturnSeconds` is
10-3600; bands must be strictly ascending; `nightMode.start` and `end` must differ.

Notes: calendar `mia` and child `mia` are separate namespaces, so the same slug may be used
for both. The 🎒 bring area (`Bring:` / `Mitbringen:` line in the event description) has no setting of
its own: it follows `timeZone` and the two bands above. The description's other text is
never sent to the tablet. If bring icons do not show: the line must be on its own, start
with `Bring:` or `Mitbringen:` including the colon, contain at least one emoji and sit in
the description (not the title); feed and cache delay changes by up to
`KIDBOARD_CACHE_TTL`. The final schema is defined in T-06 (`packages/shared`); if this document and the
schema ever disagree, the schema wins and this page must be fixed.

## Weather

Optional (ADR-0015). Without a `weather` block the board shows no weather. With it, every
overview day shows a weather icon with a temperature (today: now; other days: the high),
the week view the icon and high in each day header inside the 7-day forecast, and today's
card a row of clothing pictures: for today until `bands.eveningStart`, from then until
midnight for tomorrow.

```json
"weather": { "place": "Hamburg", "country": "DE" }
```

| Key         | Type                             | Default     | Description                                                                                     |
| ----------- | -------------------------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| `place`     | string, 1-80 chars               | -           | Town name, looked up once with the Open-Meteo geocoding API (first match). Not found: no weather, the rest of the board works. |
| `country`   | ISO 3166-1 alpha-2 code          | unset       | Narrows the lookup of `place` (`"DE"`, `"AT"`, `"US"`, ...).                                     |
| `latitude`, `longitude` | number (−90…90, −180…180) | -     | Instead of `place` (never both): `"weather": { "latitude": 53.55, "longitude": 9.99 }`.          |
| `unit`      | `"celsius"` \| `"fahrenheit"`    | `"celsius"` | Temperature unit of the chips (the board shows just `°`).                                        |

- **Privacy:** the place and coordinates stay on the server; the tablet only learns that
  weather is on. The server sends them to Open-Meteo only (forecast and geocoding) and
  caches the forecast for 30 minutes (the last good one up to 24 hours).
- **Terms:** Open-Meteo is free for non-commercial use without an account or API key; its
  data is licensed under CC BY 4.0, so the board shows "Weather: Open-Meteo.com" in the
  rail while weather is on. Commercial use needs an Open-Meteo plan.
- **Evening:** from `bands.eveningStart` the clothing pictures are tomorrow's, led by "→",
  tomorrow's weather icon and high; today's chip then shows only 🌡️ and the current
  temperature.
- **Clothing pictures** (feels-like temperature 07:00-19:00 in °C, °F is converted; "min"
  = coolest, "max" = warmest hour). At most five, in this order (protection first):

  | Picture | Item          | When                                          |
  | ------- | ------------- | --------------------------------------------- |
  | 🌂      | umbrella      | rain                                          |
  | 👢      | rain boots    | rain and max below 20° (not with snow)        |
  | 🥾      | winter boots  | snow                                          |
  | 🧥      | jacket        | min below 14°                                 |
  | (drawn) | warm hat      | min below 8°                                  |
  | 🧤      | gloves        | min below 3°, or snow                         |
  | 🧣      | scarf         | min below 5°                                  |
  | (drawn) | sweater       | min from 14° to below 18° (no jacket)         |
  | 👕      | T-shirt       | max from 22°                                  |
  | 🩳      | shorts        | max from 24°                                  |
  | 🧢      | cap           | sunny (WMO code ≤ 2), UV ≥ 3 and max from 15° |
  | 🧴      | sunscreen     | sunny (WMO code ≤ 2) and UV ≥ 4               |

  The warm hat and the sweater have no emoji, so KidBoard draws them itself.
- A forecast older than 24 hours, or an error answer of the server, hides the weather.
  Without a connection the last forecast stays (while under 24 hours old).

## API behavior

| Endpoint                                | Notes                                                                                                                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                       | Always `{ "ok": true }`; public, does not read the config or the feeds.                                                                                                                                               |
| `GET /api/config`                       | Public part of `KIDBOARD_CONFIG` with defaults applied.                                                                                                                                                                |
| `GET /api/agenda?from=YYYY-MM-DD&days=N` | `days` 1-14 (default 8), `from` default today in `timeZone`. `[from, from + days)` must lie within yesterday ... today + 31 days (the cached window `[today − 1, today + 32)`), else `400`. `200` if any source has data (`ok` or `stale`) or there are no sources (no calendars, editor off: empty board and one log warning), `502` otherwise. |
| `GET /api/weather`                      | The condensed forecast ([Weather](#weather)), never the place. `404 weather_off` without a `weather` block, `503` when the place is unknown or Open-Meteo fails without a last good forecast. |

Feeds are fetched with a 10 s timeout and a 5 MB limit. Each calendar's normalized data
for the window is stored once per refresh: it is fresh for `KIDBOARD_CACHE_TTL` and kept
7 days as last-good, served with `status: "stale"` when the feed fails (an old entry may
cover only part of the requested range). The store is the Workers KV namespace
`KIDBOARD_CACHE`, which Wrangler creates automatically on the first deploy (declared
without an id in the root `wrangler.jsonc`); without that binding the Cache API is
used, which only works on a custom domain (not on `*.workers.dev`). With the parent
editor on (ADR-0014), `sources` also lists `app-events` and `app-meals`: the entries made
in the app, read from D1 and cached the same way; a change in the app shows on the next
refresh, and if D1 is unavailable they are `stale` (or `error`) while the Google calendars
are unaffected. A feed that failed is not fetched again for 5 minutes (the last-good
copy is served meanwhile). Per calendar at most 2000 events are read and titles are cut at
120 characters (`truncated: true` marks it). All API responses
carry `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and
`Referrer-Policy: no-referrer`.

## Deutsche Kurzfassung

**Geheimnisse** (Zugriffstoken, Eltern-PIN, optionale iCal-URLs) liegen als Worker-Secrets bzw.
lokal in `.dev.vars` im Repository-Root (Vorlage: `.dev.vars.example`, nie einchecken;
Deployment: [DEPLOY.de.md](DEPLOY.de.md)). Pro Kalender in `calendars` gibt es
`CAL_<ID>_URL` (ID in Großbuchstaben; fehlt sie, zeigt nur dieser Kalender einen Fehler).
Pflicht: `KIDBOARD_ACCESS_TOKEN` (32-256 Zeichen `A-Z a-z 0-9 _ -`, z. B. `openssl rand -hex 32`; alle API-Aufrufe außer `/api/health` brauchen den
Token als `Authorization: Bearer <token>` oder `?key=<token>`; besser den Header, denn `?key=`
landet im Browserverlauf). Ohne gültiges Token (fehlt, leer, zu kurz, falsche Zeichen oder noch `REPLACE_ME`) verweigert die API alles mit `500` und das Log nennt den Grund: das Board schaltet nie ungeschützt. Ein bewusst öffentliches Board gibt es nur per Opt-in `KIDBOARD_PUBLIC="1"` ohne Token (jeder mit dem Link sieht den Familienkalender, der Editor bleibt aus). `/api/health` bleibt öffentlich und liefert nur `{ "ok": true }`.
Optional: `KIDBOARD_PARENT_PIN` (6-12 Ziffern, schaltet den Eltern-Editor ein; braucht zusätzlich das Zugriffstoken. Abgelehnt werden (Editor bleibt aus, das Log nennt den Grund) zu kurze/lange oder nicht-numerische Werte, eine einzige wiederholte Ziffer (`111111`) und Zahlenreihen (`123456`, `654321`); bitte keine Geburtstage oder Datumsangaben. Nach 5 falschen PINs in 15 Minuten sperrt der Editor 15 Minuten; jede weitere Sperre verdoppelt die Zeit (höchstens 2 Stunden), eine richtige PIN setzt zurück), `KIDBOARD_FEED_TOKEN` (32-256 Zeichen, schaltet den Handy-Feed der Editor-Einträge ein), `KIDBOARD_ALLOWED_ORIGINS`, `KIDBOARD_CACHE_TTL` (Sekunden, 60-86400, Standard 3600; mit
KV-Cache mindestens `Kalender × 86400 / 500`; bei eingeschaltetem Eltern-Editor zählen
seine zwei App-Quellen mit). Die Kalender-IDs `app-events` und `app-meals` sind für die in
der App angelegten Einträge reserviert. Die Adresse `CAL_<ID>_URL` muss mit `https://` (oder
`webcal://`) beginnen; `http://` und andere Schemata werden abgelehnt. Besser eigene
Zweitkalender ("Kinder", "Essen") als den Hauptkalender verwenden: dessen Feed listet auch
noch nicht angenommene Einladungen. Ein fehlgeschlagener Feed wird 5 Minuten nicht neu
abgerufen (solange gilt die letzte gute Kopie); pro Kalender werden höchstens 2000 Termine
gelesen und Titel nach 120 Zeichen gekürzt (`truncated: true`).

**Zugriffstoken: der Tablet-Link.** Ist `KIDBOARD_ACCESS_TOKEN` gesetzt, das Board auf dem
Tablet **einmal** als `https://<dein-worker>.workers.dev/?key=<token>` öffnen (z. B. als
Start-URL in Fully Kiosk). Die Seite speichert das Token im lokalen Speicher des Tablets und
**entfernt `?key=` sofort aus der Adresszeile**; danach ruft sie die API mit
`Authorization: Bearer` auf. Spätere Besuche brauchen kein `?key=`; ein neues `?key=` ersetzt
das gespeicherte Token (nach einem Token-Wechsel). Nach einem **`401`** (Token ungültig oder
widerrufen) **vergisst** das Tablet das Token und zeigt "Dieses Tablet braucht einen neuen Zugangslink" (Fehlercode
`KB-401`): den Tablet-Link mit dem aktuellen `?key=<token>` noch einmal öffnen. Mit
öffentlichem Opt-in (`KIDBOARD_PUBLIC="1"`, kein Token) ist das alles nicht nötig.

**Nicht geheime Einstellungen** stehen als JSON in `KIDBOARD_CONFIG` (Pflicht; Vorlage:
`config.example.json`; fehlerhaft → API antwortet `500`, das Log nennt die Fehler). Alle Optionen haben Standardwerte; `calendars` (Google-Feeds) ist optional, ohne zeigt das Board die Einträge aus dem Eltern-Editor (ADR-0014): `locale`
(`de`/`en`/`auto`; `auto` = Browsersprache, sonst `de`), `timeZone` (IANA, Standard `Europe/Berlin`), `children` (id, name, color (`child-1` bis `child-6` oder Hex `#rgb`/`#rrggbb`; benannte oder `rgb()`-Farben werden abgelehnt),
avatar = Emoji des Kindes; Farbe und Emoji färben die Kacheln des Kindes und bilden das Abzeichen), `calendars` (id, kind `events`/`meals`, optional `childId`, `label`), `bands`
(`morningStart`/`middayStart`/`eveningStart`, `HH:mm` aufsteigend: sie bestimmen das Tageszeit-Icon auf den Kacheln und den Mahlzeit-Slot für Mahlzeiten mit Uhrzeit, keine Abschnitte auf dem Bildschirm), `nightMode` (an/aus, Start, Ende), `countdown.emojis`
(Termine mit diesen Icons bekommen den "Noch x Mal schlafen"-Countdown), `refreshMinutes`,
`autoReturnSeconds` (Rückkehr von der Wochenansicht zur Übersicht nach Inaktivität). Die Tabelle oben nennt Typ,
Standardwert und Beispiel jeder Option.

**Mitbringen-Bereich (🎒).** `bands.eveningStart` startet auch den 🎒-Bereich: ab dann bis
Mitternacht zeigt die heutige Karte, was für morgen einzupacken ist (Zeile `Mitbringen:` /
`Bring:` in der Beschreibung des Termins, siehe [README.de.md](../README.de.md#mitbringen-liste));
nach Mitternacht zeigt sie, was heute noch mitzubringen ist, bis der Termin beginnt.
`bands.middayStart` beendet ihn für ganztägige Termine (ihre Icons stehen vom Vorabend
`eveningStart` bis zu dieser Uhrzeit am Tag selbst). Es gibt keine eigene Einstellung; es
gelten `timeZone` und die Bänder. Zeigt sich nichts: die Zeile muss für sich stehen, mit
`Mitbringen:` oder `Bring:` samt Doppelpunkt beginnen, mindestens ein Emoji enthalten und in
der Beschreibung (nicht im Titel) stehen; Feed- und Cache-Verzögerung bis zu
`KIDBOARD_CACHE_TTL`.

### Wetter

Optional (ADR-0015): ohne `weather`-Block kein Wetter. Mit ihm zeigt jeder Tag der Übersicht
ein Wetter-Icon mit Temperatur (heute: jetzt, sonst: Höchstwert), die Wochenansicht Icon und
Höchstwert im Kopf jedes Tages der 7-Tage-Vorhersage und die heutige Karte eine Reihe
Kleidungsbilder: für heute bis `bands.eveningStart`, ab dann bis Mitternacht für morgen.
Beispiel: `"weather": { "place": "Hamburg", "country": "DE" }`. `place` (1-80 Zeichen) wird
einmal über die Geocoding-API von Open-Meteo gesucht (erster Treffer, `country` als
ISO-3166-1-Alpha-2-Code grenzt ein; kein Treffer: kein Wetter, das Board läuft weiter);
alternativ `latitude` und `longitude` (nie beides). `unit`: `celsius` (Standard) oder
`fahrenheit`.

- **Datenschutz:** Ort und Koordinaten bleiben auf dem Server; das Tablet erfährt nur, dass
  Wetter an ist. Der Server schickt sie nur an Open-Meteo und speichert die Vorhersage 30
  Minuten (die letzte gute bis 24 Stunden).
- **Bedingungen:** Open-Meteo ist für nicht kommerzielle Nutzung kostenlos, ohne Konto und
  API-Schlüssel; die Daten stehen unter CC BY 4.0, daher zeigt die Leiste "Wetter:
  Open-Meteo.com", solange Wetter an ist. Kommerzielle Nutzung braucht einen Open-Meteo-Tarif.
- **Abends:** ab `bands.eveningStart` gelten die Kleidungsbilder für morgen, angeführt von
  "→", dem Wetter-Icon und Höchstwert von morgen; der Chip von heute zeigt dann nur 🌡️ und
  die aktuelle Temperatur.
- **Kleidungsbilder** (gefühlte Temperatur 07:00-19:00 in °C, °F wird umgerechnet; "min" =
  kühlste, "max" = wärmste Stunde). Höchstens fünf, in dieser Reihenfolge (Schutz zuerst):

  | Bild        | Kleidung      | Wann                                           |
  | ----------- | ------------- | ---------------------------------------------- |
  | 🌂          | Regenschirm   | Regen                                          |
  | 👢          | Gummistiefel  | Regen und max unter 20° (nicht bei Schnee)     |
  | 🥾          | Winterstiefel | Schnee                                         |
  | 🧥          | Jacke         | min unter 14°                                  |
  | (gezeichnet)| Mütze         | min unter 8°                                   |
  | 🧤          | Handschuhe    | min unter 3° oder Schnee                       |
  | 🧣          | Schal         | min unter 5°                                   |
  | (gezeichnet)| Pulli         | min von 14° bis unter 18° (ohne Jacke)         |
  | 👕          | T-Shirt       | max ab 22°                                     |
  | 🩳          | kurze Hose    | max ab 24°                                     |
  | 🧢          | Kappe         | sonnig (WMO-Code ≤ 2), UV ≥ 3 und max ab 15°   |
  | 🧴          | Sonnencreme   | sonnig (WMO-Code ≤ 2) und UV ≥ 4               |

  Für Mütze und Pulli gibt es kein Emoji, KidBoard zeichnet sie selbst.
- Eine Vorhersage älter als 24 Stunden oder eine Fehlerantwort des Servers blendet das
  Wetter aus. Ohne Verbindung bleibt die letzte Vorhersage (solange jünger als 24 Stunden).

**API:** `/api/agenda?from=JJJJ-MM-TT&days=N` liefert 1-14 Tage (Standard 8 ab heute) innerhalb
von gestern bis heute + 31 Tage. Kalender werden mit 10 s Timeout und 5 MB Limit geladen und pro
Kalender im KV-Namespace `KIDBOARD_CACHE` gespeichert (legt Wrangler beim ersten Deploy selbst an;
ohne Binding: Cache API, die nur mit eigener Domain funktioniert): frisch für
`KIDBOARD_CACHE_TTL`, danach bis 7 Tage als letzter guter Stand. Fällt ein Kalender aus, wird
dieser Stand mit `status: "stale"` geliefert (ein alter Stand deckt evtl. nur einen Teil des
Zeitraums ab), ohne Stand `error`. Antwort `200`, wenn mindestens eine Quelle Daten hat oder es
keine Quelle gibt (keine Kalender, Editor aus: leeres Board und eine Log-Warnung), sonst
`502`. Mit Eltern-Editor kommen die Quellen `app-events` und `app-meals` (Einträge aus der
App, aus D1) hinzu; eine Änderung in der App ist beim nächsten Abruf sichtbar, fällt D1 aus,
sind nur sie `stale` bzw. `error`.
