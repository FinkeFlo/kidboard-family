# Component specs

Sizes are px at the 1280×800 baseline (root 16px); implement them with the tokens in
[`tokens.css`](tokens.css), which are rem and scale with the board. Labels in quotes are the
German UI strings; every one needs an EN counterpart in the locale files.

## EventTile

An event as a picture tile: emoji on a light disc, a title of up to two lines, the
children's badges inside the tile, and the time-of-day icon with the time. Heights are
fixed per size, so a column can compute how many tiles fit.

| Size | Where | Height | Emoji (disc) | Title |
|---|---|---|---|---|
| `large` | today | `--spacing-tile` (80) | 56 (68) | `--text-tile`, 2 lines |
| `medium` | today, 1st step down | 72 | 48 (60) | `--text-tile-compact`, 2 lines |
| `dense` | today, 3rd step | 56 | 44 (50) | `--text-tile-compact`, 1 line |
| `slim` | today, last step before "+N" | 44 | 32 (36) | `--text-tile-compact`, 1 line, time in the same row |
| `compact` | other days | `--spacing-tile-compact` (76) | 40 (48) | `--text-tile-compact`, 2 lines |
| `compact-dense` | other days, last step | 60 | 36 (44) | `--text-tile-compact`, 1 line |
| `week` | week columns | 116 | 40 (no disc) | `--text-meta`, 2 lines |
| `week-dense` | week, 1st step down | 84 | 32 (no disc) | `--text-caption`, 1 line |
| `week-small` | week, 2nd step down | 76 | 28 (no disc) | `--text-caption`, 1 line |
| `week-slim` | week, last step before "+N" | 48 | 28 (no disc), beside the text | `--text-caption`, 1 line, time below |

- **Prominent (now, else next) in today's column:** about 1.3× taller with a larger emoji
  (large: 104 high, emoji 72) whenever a size still fits with it; it is the first thing
  given up at each size. `slim` has no enlargement (ring and cue carry now/next).
- **Titles** break between words only (no automatic hyphenation); a word longer than the
  line ends in "…". The badges keep an 8px gap to the title.
- **Disc:** the emoji sits on a `--color-surface-sunken` disc with a 1px `--color-border`
  ring and `--shadow-card`, so pale glyphs (🦷, 🥛) stay visible, also at night.
- **One child:** fill `--color-child-N-tint`, 4px inset edge `--color-child-N` (drawn above
  the content), one badge.
- **Two or more children:** neutral fill `--color-surface-raised`, one vertical 6px stripe
  per child on the start edge (side by side, never a half-and-half fill that reads as
  "half done"), up to three badges, then "+N". No child: neutral fill, 2px `--color-border`
  edge.
- **Badges:** circles `--color-child-N` with the child's emoji and a 2px ring
  (`--color-on-child`, night `--color-surface`), side by side inside the tile, overlapping
  by at most a quarter. Two-line titles float them at the end of the first line only.
- **Time row:** time-of-day emoji 🌅 / 🌞 / 🌆 (at least 24px, also in the week down to
  `week-dense`; `week-small` 18px, `week-slim` 16px on the emoji's corner; never 🌙)
  plus the time in `--text-meta`, `--color-text-muted`. All-day: a span icon (a bar
  between two end marks) and "Ganztägig".
- **States:** upcoming; **current** ("jetzt"): 4px ring `--color-now` plus a clock cue on
  the disc; **next**: 3px dashed outline `--color-now` with a 2px offset plus an outlined
  ▶ cue on the disc (not the gold of today's column ring); **past**:
  `--color-surface-sunken` fill, `--color-text-muted`, grey emoji, no edge (never opacity:
  `--opacity-past*` fails AA on text). Now/next colours are person-neutral, never a child's.
- **Week tiles:** `week`, `week-dense` and `week-small` are stacked (emoji, title, time
  row); the badges sit in their own column beside the emoji (side by side, overlapping by
  at most a quarter, a 4px gap to the emoji, never on it or in the tile's corner).
  `week` gives the title two lines (broken at spaces, no automatic hyphenation), the others
  one truncated line. `week-slim` is a row: the emoji with its time-of-day icon on the
  corner (as on the meal plates), beside it the title with the badges at its end and the
  time below; an all-day `week-slim` tile shows the span icon and the badges in that row,
  "Ganztägig" stays in the accessible name. The title shows wherever the column's list is
  wide enough (5.5rem, `week-slim` 7rem; CSS container query), on today's column too.
- **Bring chips** (an event's `bring` list, up to 8 emoji): discs in `--color-chip` (the
  emoji disc colour by day, lighter than the tile at night; 1px `--color-border` ring),
  2px apart. Today's sizes put 24px chips (16px emoji) at the end of the time row
  (`slim`: at the end of its one row, at most 40 %) and keep their height. `compact`,
  `compact-dense` and the week sizes give them a row of their own below the time, with
  28px chips (18px emoji) so they stay distinct across the room; `week-slim`, the last
  step before "+N" at about 123px wide, keeps 24px. These tiles get 6px padding at the
  top (week 4px) and grow by the measured row: +32px (`compact`, two title lines),
  +26px (`compact-dense`), +30px (`week`, `week-small`), +32px (`week-dense`), +20px
  (`week-slim`). On `compact`, `compact-dense` and `week-slim` (picture beside the
  text) the chip row spans the tile below picture and text and ends with the child
  badges, so the title keeps the whole width (`compact` two lines); stacked week tiles
  centre the row and keep the badges beside the emoji. Only whole chips are drawn; the
  rest is a plain-text "+N" (`--text-meta`, 900, `--color-text-muted`, no fill). Past
  tiles show none. Decorative; the tile's accessible
  description lists every icon ("Mitbringen: 👟 🩱" / "Bring along: 👟 🩱"). Now/next
  cues, tint, edge and badges are unchanged.
- **Night:** avatar discs, child edges and stripes are dimmed a quarter towards the page
  (`color-mix(in oklab, child 75%, surface)`); emoji are dimmed by the `Emoji` component.
- **Rules:** accessible name = title, time, children, state ("Ballett, 15:30, Für Mia");
  emoji, badges and stripes are decorative. Tiles are not interactive.

## DayColumn

One column per day; events top to bottom in time order, meals at the bottom.

- **Today:** grid share 2fr (others 1fr), `--color-surface-raised`, 5px `--color-today-ring`
  ring and `--shadow-raised`, header "Heute" (`--text-heading`; the full date is in the
  board header, not repeated).
- **Other days:** `--color-surface-sunken`, weekday (`--text-title`) and date (muted).
- Padding 14, gap 10, radius `--radius-column`. Order: header, all-day banner, past events
  (or the "vorbei" strip), NowLine (today only), upcoming events, "+N", the 🎒 area
  (today only, when there is something to pack), MealPlates
  (`margin-top: auto`).
- **Space rule (no fixed count):** the list's height is measured. In this order, the first
  that fits wins: every event as a tile at the largest size (past ones receded); else
  *all* past events fold into the "vorbei" strip and the rest shrinks step by step
  (today `large` → `medium` → `dense` → `slim`, other days `compact` → `compact-dense`),
  with the prominent tile first; only then the latest upcoming events are summed up in
  "+N", and only if one more tile would not fit. Never scroll, never hide silently.
- **All done (today):** when every timed event is over and there is room, a 80px disc
  (`--color-surface-sunken`, `--color-border` ring) with a large check mark and "Alles
  geschafft!" (`--text-title`) below the "vorbei" strip. Never a moon.
- **Nothing planned (other days):** a quiet 64px `--color-surface-raised` disc with 🪁 and
  "Nichts geplant" (`--text-meta`, muted).
- **"vorbei" strip (36 high):** a check mark and "vorbei" (`--text-meta`), then up to 8 grey
  30px emoji with a small check badge, then "+N"; its accessible name lists every title.
  Icons are never clipped: the strip measures its width and draws only whole icons, the
  rest is counted in "+N" (with a screen-reader text).
- **"+N" row (36 high):** the hidden events' emoji (26px, up to 4) and "+N" in
  `--text-meta`, muted, plain text: no border or fill, so it does not look like a button.
  Its screen-reader text names the titles.
- **Week variant (7 equal columns):** weekday (`--text-tile`) and date; a fixed slot right
  of the date holds 🌙 (each day before the countdown day), the awaited event's emoji
  (the countdown day) or nothing, so all dates align. Same space rule with the week sizes
  (`week` → `week-dense` → `week-small` → `week-slim`; "+N" only when one more slim tile
  would not fit); the "vorbei" strip shows only the check mark, up to 2 whole icons (24px)
  and "+N"; the "+N" row up to 2 emoji (22px). Weekend columns
  `--color-surface-weekend`, label `--color-band-morning-accent`.
- **Countdown day (week):** a 4px ring in `--color-band-evening-accent` (the moons' colour,
  person-neutral). Only if the awaited event belongs to exactly one child: that child's
  tint as background and the child's badge next to the emoji in the header.
- **Meals (week):** a three-row list (time-of-day icon + emoji 26), an empty row for a
  missing meal, `unspecified` meals in an extra row.

## AllDayBanner

All-day events at the top of a column, not as timed tiles: a row per event with the emoji
disc, a visible "Ganztägig" label with the span icon above the title, tint, stripes and
badges as on the tiles; a bring list as chips before the badges (as on the tiles, at most
45 % of the row); at most two rows, then a named "+N".

## BringArea (🎒, today's column only)

What to pack, per child: from `bands.eveningStart` the next day's bring lists ("Für morgen
einpacken" / "Pack for tomorrow"), after midnight the not yet started ones of the day
("Heute mitbringen" / "Today bring"; all-day events until `bands.middayStart`); an
event's icons leave when it starts, the area disappears when nothing is left.

- **Place:** today's overview column, between the events (or "+N") and the meal plates;
  never in the other columns or the week view. The list above gives way by the space rule
  (fold, shrink, then "+N"), the area itself never scrolls or wraps.
- **Anatomy:** `--color-surface-sunken` with a 1px `--color-border` ring, radius
  `--radius-tile`, 6px padding. At the start a head (72px wide, centred) says the day,
  so evening and morning never look alike: 🎒 (24px); in the evening below it an arrow
  (16px, `--color-text-muted`, as in the countdown) with tomorrow's short weekday in a
  small raised pill ("Di" / "Tue", `--text-meta`, 900), then "Morgen" / "Tomorrow"
  (`--text-caption`, muted); in the morning only "Heute" / "Today" below the 🎒. Never 🌙
  (moons count sleeps only). Beside the head **one row per group** (36px high, 4px
  apart): the group for everyone first (`--color-surface-raised` pill, 1px ring, no
  badge), then one per child in config order (the child's tint, a 2px ring in the
  child's colour, its 32px avatar badge). Icons as 28px chips (`--color-chip`, 1px
  `--color-border` ring, 18px emoji), 4px apart, in event order, deduplicated per child;
  an event for several children appears with each. Height = padding + the taller of the
  rows and the head (two children: 88px).
- **Space:** the area takes one row per group as long as today's list keeps room for
  the "vorbei" strip, the now line, two slim tiles (now and next) and "+N"; the list
  folds, shrinks and sums up around it. With less room, the last row holds the remaining
  groups side by side.
- **Overflow (last resort):** only whole chips, the earliest event's first; a group's rest
  as a plain-text "+N" (`--text-meta`, 900, `--color-text-muted`), e.g. more than eight
  icons for one child at 1280px; in a shared last row, groups without room for their
  badge are counted in one trailing "+N".
- **Night:** stays visible (night tokens, dimmed emoji, the lighter `--color-chip` disc).
- **Rules:** a labelled region whose name lists every child and icon ("Für morgen
  einpacken: Mia 🩱 🧴 und Ben 👟"); not a live region; not interactive. 🎒 appears nowhere
  else.

## NowLine

Separates started from upcoming events in today's column, all in `--color-now` (person
neutral): a 28px clock disc, a 6px bar and a "jetzt" pill (`--text-meta`, 900, text
`--color-surface`). Moves between tiles only, never per minute. `role="separator"` named
"jetzt, 15:18".

## MealPlates

Breakfast, lunch, dinner in fixed places: circles up to 60 (today) / 52 (other days) with
a 1px `--color-border` ring, emoji at 60 % of the circle and a small time-of-day badge
bottom-right; today on `--color-surface-sunken`, other days on `--color-surface-raised`
inside a `--color-surface` strip. Captions in today's column (`--text-caption`, muted,
tight tracking) use the plate's full share of the width and wrap to two lines between words
(no hyphenation; a too long word ends in "…"). A
missing meal leaves its place empty. There is no separate meal-plan screen.

## SleepCountdown

"How many sleeps?" pill in the header (`--color-surface-raised`, `--shadow-card`, 64 high,
the same height as the name chips), read from start to goal: the number ("6 ×",
`--text-title`, 900), the moons (up to 7 at 32px in one row; 8 to 14 at 26px in two rows of
a week; beyond 14 a single moon after the number), an arrow (`--color-text-muted`), the
event emoji on a disc in the child's tint and edge (neutral with `--color-border` without
a child; up to 3 for events on the same day), then the first title, truncated. Today: 🎉
and "Heute!", then the emoji and title, with a 4px `--color-today-ring` ring. Accessible
name "Wie oft noch schlafen?" and a label "Noch 6 Mal schlafen bis Mias Geburtstag"
(visuals `aria-hidden`). One size in both views (emoji `--text-title` on a 44px disc,
title `--text-body`, up to 160 wide), so the pill does not change between overview and
week. Static.

## ChildLegend

Header chips, 64 high like the countdown: `--color-surface-raised`, `--shadow-card`, 48px
circle `--color-child-N` with the child's emoji (dimmed at night), name in `--text-body`.
Not interactive.

## ViewToggle

Navigation rail on the right (`--spacing-nav` wide): buttons 104×120, radius `--radius-nav`,
label `--text-body` 900. "Heute": ☀️ (also at night; it never becomes a moon). "Woche":
seven bars, the first `--color-sun`, the rest `--color-border`. Active:
`--color-nav-active` / `--color-on-nav-active` (night a little dimmer), `aria-pressed`; at
night the active "Heute" button's ☀️ sits on a 40px `--color-surface` disc (the dimmed sun
would fade on the light tan fill);
inactive: `--color-surface-raised` with a 3px inset `--color-border`. At the bottom of the
rail: "Stand 15:18" (`--text-caption`, muted): the time of the last *successful* fetch.
Below it, in the reserved bottom strip, the long-press fullscreen control (64px target,
`--color-control-quiet` glyph): while held a ring fills (track `--color-border`, arc
`--color-text`, 700 ms; under reduced motion only the static track), and a short tap shows
a small "Gedrückt halten" hint for 2.5 s (no dialog). Auto-return to "Heute" after
`autoReturnSeconds`.

## StatusBanner

Notice pill for parents in the bottom strip: `--color-notice` / `--color-on-notice`, cloud
icon (crossed out when offline), no blinking; the board stays fully visible underneath.

- "Offline · Stand von 14:02": the device is offline.
- "Aktualisieren klappt nicht · Stand von 14:02": the last refresh failed (API
  unreachable, 5xx); also right after a reload, which always asks the API once.
- "Vielleicht nicht aktuell · Stand von 14:02": the server sent its last good copy.
- "Dieses Tablet braucht einen neuen Zugangslink.": access link no longer valid (alert).

The time is always the last successful fetch. Stale states appear only after 5 s (a
midnight seed must not flash); offline and errors at once. Polite `status`, errors `alert`.

**Loading:** no spinner. First load shows a calm skeleton of the columns in
`--color-surface-sunken` / `--color-surface-raised` and "Der Tag wird geholt …" with a sun.

## EmptyState

- **Nothing planned today:** inside today's column: two discs in the children's tints, a
  `--color-sun` disc at 55%, 🧸 and 🪁; "Heute ist nichts geplant" (`--text-title`), "Zeit zum
  Spielen" (`--text-body`, muted). Meals stay visible below.
- **Error:** card `--color-soft-error`, 🧸, "Gleich geht's weiter" (`--text-title`), one line
  for parents ("Der Kalender ist gerade nicht erreichbar. KidBoard versucht es von selbst
  wieder."; no fixed retry seconds), a 64px button "Jetzt neu laden" (`--color-nav-active`),
  and a small error code below (`KB-*`). No red surfaces, no warning icons.
- **Access link no longer valid (401):** the same card on `--color-surface-raised` with a
  `--color-border` edge, "Ein Erwachsener hilft kurz" and "Eltern: Dieses Tablet braucht
  einen neuen Zugangslink, der alte gilt nicht mehr. Bitte die Person fragen, die KidBoard
  eingerichtet hat." No URL syntax or technical words, no retry button; the code `KB-401`
  below is for parents (the docs explain the `?key=` link).

## Outlook (M7/M8, sketch only)

- **Routine checklist:** per child, rows 84px with emoji 50, label, 56px check circle (done:
  `--color-child-N` with a white check, row in the child's tint); stars on top
  (`--color-sun` fill, `--color-band-midday-accent` outline).
- **Parent PIN:** card `--color-surface-raised`, lock + "Eltern-Bereich", four dots, 3×4 keypad
  of 72px keys in `--color-surface-sunken`, "Abbrechen" as a quiet 64px text button.
