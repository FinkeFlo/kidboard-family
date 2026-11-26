# ADR-0003: iCalendar parsing and recurrence expansion

- Status: accepted
- Date: 2026-11-22

## Context
Must handle RRULE, EXDATE, RDATE, RECURRENCE-ID overrides, all-day and multi-day events,
VTIMEZONE/DST, inside the Workers runtime (no Node built-ins).

## Options
| Library | License | Runtime | Recurrence | Notes |
|---|---|---|---|---|
| **ical.js 2.x** (Mozilla/kewisch) | MPL-2.0 | pure JS, ESM, browser + Workers | `ICAL.Event` + `iterator()`, `relateException()`, `getOccurrenceDetails()`, `RecurExpansion` | used by Thunderbird; parses VTIMEZONE from the feed |
| node-ical | Apache-2.0 | Node (fs, axios history) | via rrule.js | not Worker-friendly |
| rrule.js + own parser | BSD | any | RRULE only | would need our own ICS parser → rule 2 violation |

## Decision
ical.js, used through `apps/worker/src/ical/expandCalendar.ts` (T-08).

Expansion pattern (from Context7 docs): parse → group VEVENTs by UID → for each master
without RECURRENCE-ID iterate `event.iterator()` (`RecurExpansion`) until past the window
end. Overrides (RECURRENCE-ID) are emitted from their own DTSTART/DTEND; the instance
they replace is skipped. Instances are matched to overrides and EXDATEs by absolute
instant (dates by calendar date), not by ical.js's string ids. `getOccurrenceDetails()`
is only used for `RANGE=THISANDFUTURE` overrides. Events are always constructed with an
explicit (empty) `exceptions` list: without it ical.js relates every RECURRENCE-ID of the
calendar to every event regardless of UID.

### Time zones
* `VTIMEZONE`s are **not** registered in the global `ICAL.TimezoneService` (it is shared
  by all feeds in an isolate); ical.js resolves TZIDs from the feed's own VTIMEZONEs.
* A TZID the runtime knows as an IANA zone is converted with the runtime tz database via
  `@date-fns/tz` `tzOffset`, whether or not the feed contains a VTIMEZONE for it (Google's
  VTIMEZONEs are copies of IANA rules; the runtime data is authoritative and current).
* Non-IANA TZIDs (custom or Windows names) use the feed's VTIMEZONE through ical.js.
* Floating times, and TZIDs that are neither IANA nor defined in the feed, are
  interpreted in the configured zone.
* Wall time → instant uses the RFC 5545 §3.3.5 rules, implemented in
  `packages/shared/src/wallTime.ts` (custom code, justified here; shared with the editor): a non-existent
  local time (spring-forward gap) uses the offset before the gap (02:30 → 03:30 local),
  an ambiguous one (fall-back) the first occurrence. `TZDate`'s wall-time constructor is
  not used because it resolves gaps/overlaps via the *system* zone's `Date`, and ical.js
  resolves both cases the other way round. Offsets are cached per UTC day.

### Performance and limits
ical.js always iterates from DTSTART (~15 µs per iteration with VTIMEZONE zones). A
realistic family feed (300 events, 50 daily/weekly series started up to five years
ago) took 230–480 ms with plain full iteration in workerd (see table). Optimizations:
1. **Fast-forward** (`fastForward.ts`): DTSTART is moved forward by whole periods
   (FREQ × INTERVAL) to two periods before the window, for DAILY/WEEKLY/MONTHLY/YEARLY
   rules without COUNT, with only BYDAY/BYMONTH/BYMONTHDAY (no ordinal BYDAY in
   DAILY/WEEKLY, YEARLY day rules need BYMONTH, day of month ≤ 28). Everything else
   (COUNT, BYSETPOS, BYWEEKNO, BYYEARDAY, BYHOUR…, sub-daily, RANGE overrides) is
   iterated in full.
2. **Floating wall-time iteration**: IANA-zoned and floating series are iterated as
   floating times (UNTIL/RDATE converted to the same wall clock), so ical.js does not
   evaluate VTIMEZONE rules per comparison.
3. Wall-clock pre-filters skip exact zone conversion for instances clearly outside the
   window.

Equivalence with full iteration is proven by a differential test
(`expandCalendar.equivalence.test.ts`: 23 fast-forwardable and 6 fall-back rule shapes ×
5 zone variants × 6 DTSTARTs incl. DST days, with/without UNTIL, UTC EXDATEs and
overrides, two windows); `fastForward.test.ts` pins which shapes are fast-forwarded.

Measured on the realistic feed above (window of 8 days unless noted), best of three runs per call:

| Environment | Optimized | Full iteration |
|---|---|---|
| local workerd via `@cloudflare/vitest-plugin`, 4 vCPU dev container | 10–32 ms | 230–480 ms |
| same, 33-day window of the API (`[today − 1, today + 32)`, T-10) | 21–26 ms | 264–331 ms |
| Node 22, same machine | ≈ 9.5 ms | – |

The 33-day API window costs about the same as 8 days (re-measured in T-10, three runs:
8 days 22–31 ms vs 33 days 21–26 ms; workerd timers have 1 ms resolution): the cost is
dominated by iterating series up to the window, not by the instances inside it.

The spread comes from machine load (a reviewer run measured 22 ms vs 303 ms); the
ratio is consistently 15–25×. Production CPU time on Cloudflare is not measured here.

### Guards
* `maxIterations` = 10 000 instances per series.
* `maxTotalIterations` = 50 000 rule-evaluation steps per feed (instances plus candidate
  checks inside ical.js).
* Unsatisfiable rules: ical.js's `RecurIterator#next` loops until a candidate passes the
  BY-part filters and has no exit for rules that never match (e.g.
  `FREQ=DAILY;INTERVAL=7;BYDAY=MO` with a Tuesday DTSTART, `FREQ=DAILY;BYDAY=1MO`). Such
  a call never returns, and workerd's clock does not advance during CPU work, so no
  time limit can catch it. The iterators of each rule are wrapped (instance methods of
  our own rule copy, nothing global) to count `check_contracting_rules` calls: more than
  5 000 candidates for one instance (~50 ms, ≈ 14 years of daily candidates) skips the
  event with an `invalid-event` warning; the feed budget applies to these checks too.
  Feeds are untrusted (third-party invites), so this is a security control.
* `check_contracting_rules` is an undocumented ical.js internal. Therefore ical.js is
  **pinned exactly** (`2.2.1` in `apps/worker/package.json`), and **every ical.js upgrade
  (including Dependabot PRs) must be checked manually**: re-read `RecurIterator#next`
  and verify `guardRule` still bounds its loop. A canary test (`hang guard canary` in
  `expandCalendar.test.ts`) asserts the method exists and that the guard counts checks
  for a satisfiable rule; the unsatisfiable-rule tests run the canary first and throw
  instead of hanging if the guard is not effective.
* Trade-off: the 5 000-candidate limit can reject valid but very sparse rules, e.g.
  `FREQ=HOURLY;BYMONTH=3` with a July DTSTART (~5 900 hourly candidates until March).
  Such events are skipped and reported as `invalid-event`, never hung on.
* Hitting a cap or the budget is reported as a warning (`truncated: true`) for the API.

## Consequences
* MPL-2.0 is file-level copyleft; using the unmodified package as a dependency is
  compatible with KidBoard's MIT license. We must not copy ical.js source into the repo.
* **Free-plan risk (ADR-0002):** Workers Free allows 10 ms CPU per request. A typical
  family feed is now around or above that limit (10–30 ms measured locally); large feeds
  or rules that cannot be fast-forwarded exceed it clearly. Mitigations: the per-source fresh cache (default 1 h) means one expensive
  request per source and hour, not per page view; occasional CPU overruns are tolerated
  by the platform rather than failing every request; the iteration budget bounds the
  worst case (~0.5–1 s); the Workers Paid plan (30 s CPU) is the fallback for very large
  calendars. Revisit (e.g. pre-expanding in a Cron Trigger) if overruns are observed.
