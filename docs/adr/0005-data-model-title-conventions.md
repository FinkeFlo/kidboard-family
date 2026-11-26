# ADR-0005: Data model and calendar title conventions

- Status: accepted
- Date: 2026-11-22

## Context
Parents only edit Google Calendar. All semantics must therefore be encoded in calendar
choice and titles, and be forgiving.

## Decision
* Data model `Child`, `CalendarSource`, `CalendarEvent`, `Meal`, `AgendaResponse` as in
  [ARCHITECTURE.md](../ARCHITECTURE.md), defined once in `packages/shared` with zod schemas.
* Title rules (child prefix, meal prefix DE/EN, leading emoji as icon, keyword fallback,
  countdown flag, bring list from the description) exactly as specified in
  ARCHITECTURE.md → "Title conventions". The bring list (rule 7, optional
  `CalendarEvent.bring`) is decided in [ADR-0010](0010-bring-list-from-description.md).
* Children: either one calendar per child (`childId` on the source) or `Name:` prefix,
  both combinable; no match → event is for everyone.
* Everything is plain text; the UI renders titles as React text nodes only
  (no `dangerouslySetInnerHTML`, enforced by lint rule `react/no-danger`).
* Emoji detection with `emoji-regex` (MIT, maintained, tracks Unicode RGI) applied to the
  first `Intl.Segmenter` grapheme – handles ZWJ, skin tones, flags, keycaps.

## Consequences
* Parsing runs server-side once; the client gets ready-to-render DTOs.
* Changing conventions later is a breaking change → documented in README.
