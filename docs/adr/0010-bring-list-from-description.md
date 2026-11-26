# ADR-0010: Bring list parsed from the event description (server-side)

- Status: accepted
- Date: 2026-11-23

## Context
M10 "School": parents want to say what a child has to bring to an event (PE kit, swimsuit,
paint shirt) without a new calendar kind or config. Parents only edit Google Calendar, so
the information has to live in the event itself. The title is already used for child
prefix, emoji and text (ADR-0005); the description is free text that may contain private
notes, phone numbers or addresses, and Google Calendar can store it as formatted text
(simple HTML such as `<br>`, `<b>`, `<p>`, entities like `&nbsp;`). The description is
untrusted input and is today never sent to the client (`CalendarEvent` has no
description field).

## Options
1. **Parse a `Mitbringen:` / `Bring:` line in the description server-side** in
   `packages/shared`, keep only emoji graphemes, send a short icon list on the event DTO.
2. Send the description to the client and parse there - leaks private text to the tablet
   (persisted in localStorage for 7 days), enlarges the payload, adds an XSS surface.
3. A separate calendar or a config list for bring items - more setup, contradicts "no new
   calendar kind".
4. Structured iCal properties (`CATEGORIES`, `ATTACH`, custom `X-` properties) - not
   editable in the Google Calendar UI.
5. A library: no maintained library parses this convention; the building blocks are
   already in the stack (`Intl.Segmenter`, `emoji-regex` via `isEmojiGrapheme`, ADR-0005).

## Decision
Option 1, as a small pure function in `packages/shared` (custom code justified here: the
convention is ours, the emoji detection reuses the existing helpers). Rules:

* Lines are split on line breaks and on HTML line boundaries (`<br>`, `</p>`, `</div>`,
  `</li>`); all other tags are removed and the few common entities (`&nbsp;`, `&amp;`)
  decoded *only to find line starts and keywords*. Nothing is ever rendered as HTML and no
  HTML parser runs (the result is only emoji).
* A bring line starts (after optional whitespace and list bullets `-`, `*`, `•`) with the
  keyword `Mitbringen` or `Bring` (case-insensitive, Unicode-aware, whole word) followed by
  `:`. Several bring lines are merged in order.
* Of the rest of the line only emoji graphemes (`isEmojiGrapheme`) are kept; words,
  digits, punctuation and text-only symbols are dropped. Duplicates (compared without
  VS16) are removed, first occurrence wins; at most 8 icons per event (`BRING_MAX`), the
  rest is dropped server-side.
* Work is bounded: only the first 8 KB of a description and the first 500 characters of a
  bring line are scanned.
* The event DTO gets an optional `bring: string[]` (each a single emoji, max 8), omitted
  when empty, so persisted client caches and last-good worker data without the field stay
  valid. Meals never get a bring list. The description itself is never part of any
  response, log or error message.

## Consequences
* Parents write e.g. `Mitbringen: 👟 🩱 🧴` in the description; text next to the emoji is
  allowed but never shown (icons only, readable without reading).
* The client renders `bring` as React text inside `<Emoji>` (ADR-0009), never HTML.
* The convention is a documented public contract (README EN + DE, like `#countdown`);
  changing keywords later is a breaking change.
* A recurring series shares one description; a single changed occurrence
  (`RECURRENCE-ID`) carries its own bring list.

## Implementation notes (T-33)
* `parseBringList` lives in `packages/shared/src/title/parseBringList.ts`; `normalize`
  (worker) calls it for `events` sources only, once per distinct description.
* The 8 KB bound is counted in UTF-16 code units (8 192); of a bring line only graphemes
  that start within its first 500 code units are read, so an emoji sequence at the limit is
  kept whole instead of being cut.
* Besides the tags above, `<script>` and `<style>` elements are removed with their
  content (emoji inside code are not part of the line), in one linear forward pass. Every
  regular expression is free of nested or overlapping quantifiers; adversarial inputs
  (5 MB descriptions, 100 000 emoji, unclosed tags, long bullet or whitespace runs) are
  covered by tests with a time budget.
* ical.js unescapes TEXT values (`\n`/`\N` → line break, `\,` `\;` `\\`) and unfolds
  lines before the description reaches the parser (fixture `fixtures/ics/bring.ics`).
* The worker cache entry carries a version (`SOURCE_ENTRY_VERSION`, now 2). Entries of
  version 1 (written before `bring` existed) are never served as fresh, so bring lists
  appear on the first request after a deploy; they stay valid as last-good under the same
  key until the next successful refresh overwrites them.
* Rollback: after a rollback to a worker that only knows version 1, version 2 cache
  entries fail validation there and act as a cache miss until they are rewritten.
