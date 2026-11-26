import { tzOffset } from "@date-fns/tz";

/**
 * Conversion between wall-clock times in an IANA zone and absolute instants.
 *
 * Offsets come from the runtime's tz database through `@date-fns/tz` (`tzOffset`,
 * backed by `Intl.DateTimeFormat`). `TZDate`'s own wall-time constructor is not used
 * because it resolves DST gaps/overlaps through the *system* zone's `Date`, which is
 * not deterministic across runtimes. Instead the RFC 5545 (section 3.3.5) rules are
 * applied explicitly:
 *
 * - Non-existent local time (spring-forward gap): interpreted with the UTC offset in
 *   effect *before* the gap, i.e. 02:30 on the Europe/Berlin spring-forward day
 *   becomes 01:30Z = 03:30+02:00.
 * - Ambiguous local time (fall-back overlap): the *first* occurrence is used, i.e.
 *   02:30 on the Europe/Berlin fall-back day becomes 00:30Z = 02:30+02:00.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** Calendar date-time without zone. `month` is 1-12. */
export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Calendar date. `month` is 1-12. */
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/** `date` shifted by `days` calendar days (pure calendar arithmetic, no zone). */
export function shiftCalendarDate(
  date: CalendarDate,
  days: number,
): CalendarDate {
  const shifted = new Date(0);
  shifted.setUTCFullYear(date.year, date.month - 1, date.day + days);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function exactOffsetMinutes(timeZone: string, epochMs: number): number {
  const offset = tzOffset(timeZone, new Date(epochMs));
  if (Number.isNaN(offset)) {
    throw new RangeError("Unknown time zone or invalid instant");
  }
  // Only pre-1900 local mean times have second-level offsets; whole minutes suffice.
  return Math.round(offset);
}

/**
 * Offset at the first and the last millisecond of each UTC day, per zone. `tzOffset`
 * goes through `Intl.DateTimeFormat#formatToParts` (~10 µs per call), which dominated
 * feed expansion; most instants fall on days without a transition, where both ends
 * agree and the offset holds for the whole day. Days with a transition are resolved
 * exactly. Assumes no zone changes its offset twice within one UTC day and back to the
 * same value (true for the IANA database since 1970). Bounded: cleared when large.
 */
const dayOffsetCache = new Map<string, Map<number, number | null>>();
const DAY_OFFSET_CACHE_LIMIT = 20_000;

/** UTC offset of `timeZone` at `epochMs` in whole minutes. */
export function offsetMinutes(timeZone: string, epochMs: number): number {
  const day = Math.floor(epochMs / DAY_MS);
  let days = dayOffsetCache.get(timeZone);
  if (days === undefined) {
    days = new Map();
    dayOffsetCache.set(timeZone, days);
  }
  let cached = days.get(day);
  if (cached === undefined) {
    const first = exactOffsetMinutes(timeZone, day * DAY_MS);
    const last = exactOffsetMinutes(timeZone, (day + 1) * DAY_MS - 1);
    cached = first === last ? first : null;
    if (days.size >= DAY_OFFSET_CACHE_LIMIT) {
      days.clear();
    }
    days.set(day, cached);
  }
  return cached ?? exactOffsetMinutes(timeZone, epochMs);
}

/** Interprets the wall fields as if they were UTC (handles years < 100 correctly). */
export function naiveUtcMs(wall: WallTime): number {
  const date = new Date(0);
  date.setUTCFullYear(wall.year, wall.month - 1, wall.day);
  date.setUTCHours(wall.hour, wall.minute, wall.second, 0);
  return date.getTime();
}

/**
 * Converts a wall-clock time in `timeZone` to epoch milliseconds, resolving DST gaps
 * and overlaps by the RFC 5545 rules documented at the top of this module.
 * Assumes at most one offset transition within ±24 h of the wall time (true for all
 * current IANA zones).
 */
export function wallTimeToEpochMs(wall: WallTime, timeZone: string): number {
  const naive = naiveUtcMs(wall);
  const offsetBefore = offsetMinutes(timeZone, naive - DAY_MS);
  const offsetAfter = offsetMinutes(timeZone, naive + DAY_MS);
  const candidates = [offsetBefore, offsetAfter]
    .map((offset) => ({ offset, epochMs: naive - offset * MINUTE_MS }))
    .filter(
      ({ offset, epochMs }) => offsetMinutes(timeZone, epochMs) === offset,
    )
    .map(({ epochMs }) => epochMs);
  if (candidates.length > 0) {
    // One candidate: unambiguous. Two: fall-back overlap, take the earlier instant.
    return Math.min(...candidates);
  }
  // Spring-forward gap: use the offset in effect before the gap.
  return naive - offsetBefore * MINUTE_MS;
}

/** Wall-clock time of the instant `epochMs` in `timeZone`. */
export function wallTimeAt(epochMs: number, timeZone: string): WallTime {
  const wall = new Date(epochMs + offsetMinutes(timeZone, epochMs) * MINUTE_MS);
  return {
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth() + 1,
    day: wall.getUTCDate(),
    hour: wall.getUTCHours(),
    minute: wall.getUTCMinutes(),
    second: wall.getUTCSeconds(),
  };
}

function pad(value: number, length = 2): string {
  return String(Math.abs(value)).padStart(length, "0");
}

/** `YYYY-MM-DD`. */
export function formatCalendarDate(date: CalendarDate): string {
  return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;
}

/** Formats an instant as ISO 8601 with the offset of `timeZone`, e.g. `2026-03-30T08:00:00+02:00`. */
export function formatInstant(epochMs: number, timeZone: string): string {
  const offset = offsetMinutes(timeZone, epochMs);
  const wall = new Date(epochMs + offset * MINUTE_MS);
  const sign = offset < 0 ? "-" : "+";
  const date = formatCalendarDate({
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth() + 1,
    day: wall.getUTCDate(),
  });
  const time = `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(wall.getUTCSeconds())}`;
  const zone = `${sign}${pad(Math.trunc(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${date}T${time}${zone}`;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses a strict `YYYY-MM-DD` string; returns null for malformed or impossible dates. */
export function parseCalendarDate(value: string): CalendarDate | null {
  const match = DATE_RE.exec(value);
  if (!match) {
    return null;
  }
  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const check = new Date(0);
  check.setUTCFullYear(date.year, date.month - 1, date.day);
  if (
    check.getUTCFullYear() !== date.year ||
    check.getUTCMonth() !== date.month - 1 ||
    check.getUTCDate() !== date.day
  ) {
    return null;
  }
  return date;
}

/** Epoch milliseconds of local midnight starting `date` in `timeZone`. */
export function startOfDayMs(date: CalendarDate, timeZone: string): number {
  // Explicit fields: `date` may be a class instance with getters (ical.js `Time`).
  return wallTimeToEpochMs(
    {
      year: date.year,
      month: date.month,
      day: date.day,
      hour: 0,
      minute: 0,
      second: 0,
    },
    timeZone,
  );
}
