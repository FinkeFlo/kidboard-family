# ADR-0009: Emoji rendering

- Status: accepted
- Date: 2026-11-22

## Options
1. **Native system emoji font** – zero assets; on the primary target (Android tablet with
   Fully Kiosk) this is Noto Color Emoji everywhere, so rendering is consistent there.
2. Twemoji (jdecked fork, graphics CC-BY 4.0) – uniform across platforms, needs
   attribution and ~MBs of SVGs to cache offline.
3. Fluent Emoji (MIT) / Noto Emoji SVG (Apache/OFL) – similar trade-offs.

## Decision
MVP renders native emoji through one `<Emoji>` component (font stack
`"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`, `role="img"`,
`aria-label`). The component is the single seam to switch to an asset set later
(planned M7 option `emojiStyle`).

The component has two modes. With a non-empty `label` the emoji is an image for
assistive tech (`role="img"`, `aria-label`). Without a label (or a blank one) it is
**decorative**: `aria-hidden="true"`, no role, so screen readers skip it. Use the
decorative mode whenever visible text next to it already says the same (a tile's emoji next to its title, the child legend's avatars next to the names, the
countdown visuals inside its labelled region), so nothing is announced twice.

Night dimming also lives inside the `<Emoji>` seam (`night:brightness-75
night:saturate-80`), so callers never dim emoji themselves.
