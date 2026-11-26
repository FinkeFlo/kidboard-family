# ADR-0008: Date and time-zone handling

- Status: accepted
- Date: 2026-11-22

## Options
1. **date-fns 4 + @date-fns/tz** (`TZDate`, `tz()` context option) – modular, small,
   DST-safe arithmetic in an explicit zone, works in browsers and Workers.
2. Temporal (`temporal-polyfill`) – best model, but native support on older Android
   WebViews (Fully Kiosk) is not guaranteed and the polyfill adds ~20 kB.
3. Luxon – fine, but larger and not tree-shakable.

## Decision
date-fns + @date-fns/tz. All "which day / which band / how many nights" logic takes the
configured zone explicitly and never relies on the device zone. ical.js handles
feed-level zones (ADR-0003). Revisit Temporal when Baseline-available on target devices.
