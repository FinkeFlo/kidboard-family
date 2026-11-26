# ADR-0011: Emoji version baseline for built-in icons

- Status: accepted
- Date: 2026-11-23

## Context
ADR-0009 renders native system emoji. A glyph newer than the tablet's emoji font shows as
an empty box ("tofu") or as separate pieces, which a child cannot read. The primary target
is an Android tablet in a kiosk browser whose WebView uses the system emoji font, and such
wall tablets often run older Android versions. ADR-0009 names no version limit, and the
built-in keyword table already contains one newer glyph (🛝, Emoji 14.0). M10 adds more
built-in icons (school subjects).

## Options
1. **A fixed baseline for every emoji KidBoard itself ships** (fallback table, default
   icons, default countdown list, UI emoji), checked by a test.
2. No baseline, fix reports as they come - tofu would reach children first.
3. Bundle an emoji asset set - planned as an option (M7, ADR-0009), too large for now.

## Decision
Option 1 with **Emoji 13.0** as the baseline (shipped with Android 11, 2020). Every emoji
in built-in tables and UI code must have an emoji version ≤ 13.0. A unit test in
`packages/shared` checks the fallback table, `DEFAULT_EVENT_ICON`, `DEFAULT_MEAL_ICON` and
the default countdown emoji against version data from `emojibase-data` (MIT, devDependency
only, never bundled); a web test checks the emoji constants used by UI components. 🛝 is
replaced by an older glyph. Emoji that parents type themselves (titles, bring lists,
avatars) are passed through unchanged: it is their choice and their device.

## Consequences
* README (kiosk tips) states the baseline: tablets with Android 11 or newer show every
  built-in icon; newer emoji typed by parents may not render on older tablets.
* The platform-to-version mapping (Android 11 = Emoji 13.0) is verified by the builder
  against current platform documentation before the ADR is relied on; raising the
  baseline later is a one-line change plus this ADR's update.
* `emojibase-data` is verified via Context7 and npm metadata before use (data shape,
  `version` field).
