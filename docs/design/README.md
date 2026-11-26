# Design hand-off (Claude Design) – 2026-11-22

This folder holds the final visual design for KidBoard. It replaces the placeholder theme.
The design was made in Claude Design; its sources are the **KidBoard design system** (tokens,
component guidelines, previews) and a canvas with all screens. Both are private Claude
artifacts of the maintainer; everything an implementer needs is copied into this folder.

| File | What |
|---|---|
| [`tokens.css`](tokens.css) | Drop-in replacement for `apps/web/src/styles/tokens.css` (same structure and variable names, new tokens added). Passes the existing `tokens.test.ts` contrast suite unchanged. |
| [`tokens.json`](tokens.json) | The same tokens as data (design-system format: colour list with `light`/`night` themes, type scale, spacing, radius, shadow, duration, opacity). Source of truth; `tokens.css` is generated from it. |
| [`components.md`](components.md) | Component specs: variants, states, sizes, a11y and i18n rules. |
| [`screens/`](screens/) | PNG exports at 1280×800 and 2000×1200, plus static HTML references in `screens/html/` (open in a browser; not app code). |

## What changes against the current app

This is the hand-off as delivered. The built app refined some points after the merge rules
(docs/PLAN.md, M5b) and the UI/UX dummy test (T-27a): shared tiles use colour stripes
instead of a split tint, the evening icon is 🌆 (🌙 only counts sleeps), columns shrink by
measured space instead of "from 6 events", and the week marks the countdown day with a
neutral ring. [`components.md`](components.md) describes the current state.

1. **Main screen = overview of four days, not three day bands.** Today plus the next three
   days are columns side by side (today 1.4× wider). Inside each column events run **top to
   bottom in time order**; meals sit at the bottom of the column. There is no separate detail
   view for a single day, and tiles are not tappable.
2. **Time of day moves onto the tile.** The morning/midday/evening bands are gone from the
   main screen. Each tile shows a small sunrise / sun / moon icon next to the time. A
   **"jetzt" (now) line** in today's column separates past from upcoming events.
3. **Child colour + child sign on every tile.** One child: tile filled with
   `--color-child-N-tint`, 4px edge `--color-child-N`, the child's sign (avatar emoji) as a
   badge in the top-right corner. Several children: tile split into the children's tints,
   no edge, overlapping badges. Colour never carries meaning alone. The sign is chosen by the
   child (config `children[].emoji`).
4. **Today's column** is `--color-surface-raised` with a 5px `--color-today-ring` and
   `--shadow-raised`; other days are `--color-surface-sunken`.
5. **Navigation** is a rail on the right: two 104×120px buttons "Heute" and "Woche",
   the status line ("Stand 15:18") and the quiet lock for the parent area at the bottom.
   The header keeps weekday + date, the sleep countdown pill and the child legend.
6. **Week view** keeps 7 columns with meals inside (as decided in T-18) but uses the same
   tile language (tinted, child badge, time-of-day icon). A special day (birthday) gets the
   child's tint and edge; each column up to the event shows a moon in its header, so the
   nights can be counted on the board too.
7. **Busy days** (6+ events today): past events collapse into a "vorbei" strip of small
   emoji, upcoming tiles go compact (60px). Beyond that, "+N".
8. **States**: calm skeleton while loading (no spinner), a small notice pill when offline or
   stale (board stays visible), a friendly error card (🧸 "Gleich geht's weiter", one line for
   parents, 64px retry button, small error code). Empty day: illustration in today's column,
   meals stay.
9. **Night mode**: warm near-black theme (`[data-theme="night"]`), emoji dimmed with
   `filter: brightness(0.75) saturate(0.8)`, past events at `--opacity-past-night`.

Routines with reward stars and the PIN-protected parent area are sketched for M7/M8 only
(`screens/2026-11-22-outlook-routines-pin-*.png`).

## Screens

| Screen | 1280×800 | 2000×1200 |
|---|---|---|
| Overview, day | [png](screens/2026-11-22-overview-day-1280x800.png) | [png](screens/2026-11-22-overview-day-2000x1200.png) |
| Overview, night (19:05) | [png](screens/2026-11-22-overview-night-1280x800.png) | [png](screens/2026-11-22-overview-night-2000x1200.png) |
| Overview, busy day (8 events, long title, no emoji) | [png](screens/2026-11-22-overview-busy-1280x800.png) | [png](screens/2026-11-22-overview-busy-2000x1200.png) |
| Overview, nothing planned today | [png](screens/2026-11-22-overview-empty-1280x800.png) | [png](screens/2026-11-22-overview-empty-2000x1200.png) |
| Week with meals and sleep countdown | [png](screens/2026-11-22-week-1280x800.png) | [png](screens/2026-11-22-week-2000x1200.png) |
| States: loading, offline, error | [png](screens/2026-11-22-states-1280x800.png) | [png](screens/2026-11-22-states-2000x1200.png) |
| Outlook: routines, parent PIN (M7/M8 sketch) | [png](screens/2026-11-22-outlook-routines-pin-1280x800.png) | [png](screens/2026-11-22-outlook-routines-pin-2000x1200.png) |

The 2000×1200 exports scale the 1280×800 layout by 1.5; the app itself is fluid (rem
tokens on a fluid root size), so implement against the tokens, not against pixel positions.
Example data (Mia 🦊, Ben 🐻, meals Monday–Wednesday) is illustrative only.

## Tokens: how they map into the code

1. Replace `apps/web/src/styles/tokens.css` with [`tokens.css`](tokens.css). All existing
   variable names stay, so the current components keep building; the legacy band surfaces
   and `--spacing-band-tile` are marked as legacy.
2. New tokens: `--color-child-{1..6}-tint`, `--color-today-ring`, `--color-now`,
   `--color-nav-active`, `--color-on-nav-active`, `--color-sun`, `--color-soft-error`,
   `--text-tile`, `--text-tile-compact`, `--text-meta` (each with line-height and
   font-weight), `--spacing-tile`, `--spacing-tile-compact`, `--spacing-badge`,
   `--spacing-nav`, `--radius-tile`, `--radius-column`, `--radius-nav`, `--opacity-past`,
   `--opacity-past-night`.
3. Changed values: warmer surfaces (`--color-surface` `#fbf6ee`, `--color-surface-sunken`
   `#f3ece1`; at night `--color-surface-sunken` is now slightly *lighter* than the page so
   the other day columns stay visible), dimmer night text, type scale (`--text-title`
   1.625rem, `--text-display` 3.25rem), `--spacing-gutter` 1rem, `--spacing-page` 1.5rem.
4. Child palette values are unchanged (Okabe-Ito based, already AA); only tints are new.
5. Extend `tokens.test.ts` with the new pairs: `--color-text` and `--color-text-muted` on
   every `--color-child-N-tint`, the three time-of-day accents on every tint (3:1),
   `--color-today-ring` on `--color-surface` (3:1), `--color-on-nav-active` on
   `--color-nav-active`, text on `--color-soft-error`. All pass in both themes (checked when
   the tokens were generated).

## Implementation notes (React + Tailwind 4)

- **Emoji:** always through `<Emoji>` (ADR-0009, Noto Color Emoji first). Night dimming
  belongs in the component, not in every caller.
- **Missing emoji:** title emoji first, then `FALLBACK_ICON_TABLE`, then 📅 (already in
  `packages/shared/src/title/fallbackIcons.ts`).
- **Long titles:** up to two lines where the tile has the height, else one line,
  truncated; full title (plus time and children) in the tile's
  accessible name.
- **Several children:** neutral `--color-surface-raised` tile with one colour stripe per
  child on the start edge (side by side; a split tint read as "half done"), up to three
  badges, then "+N" (see components.md).
- **No scrolling:** columns are flex columns with the meal strip at `margin-top: auto`;
  measured space decides (past events fold into the "vorbei" strip first, then tiles shrink
  step by step, then "+N"), keeping 8 events + 3 meals inside 1280×800 (e2e density
  matrix applies).
- **Now line:** jumps between tiles (no per-minute positioning), so nothing moves every
  minute.
- **Motion:** only `--duration-*` tokens; view change is a fade (max 8px offset), night mode
  cross-fades over `--duration-slow`; all zero under `prefers-reduced-motion`.
- **i18n:** every label ("Heute", "Woche", "jetzt", "vorbei", "Heute ist nichts geplant",
  "Gleich geht's weiter", "Offline · Stand von {{time}}") via the locale files, DE + EN;
  columns and buttons have room for longer English words.

The follow-up implementation tasks are T-29 to T-32 in [`../PLAN.md`](../PLAN.md).
