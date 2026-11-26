import { tzOffset } from "@date-fns/tz";

/**
 * Calendar-date helpers shared by worker and web (runtime-agnostic: `Intl` via
 * `@date-fns/tz`, no DOM, no Worker globals, no Node built-ins).
 *
 * A *date key* is a calendar date `YYYY-MM-DD` in the configured IANA zone. The device
 * zone is never involved: offsets come from `tzOffset` (the runtime's tz database), and
 * the wall-clock fields are read through UTC getters of a shifted `Date`.
 */

const MINUTE_MS = 60_000;
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number, length = 2): string {
  return String(Math.abs(value)).padStart(length, "0");
}

function formatUtcDate(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * Date key (`YYYY-MM-DD`) of the instant `epochMs` in `timeZone`.
 * Throws a `RangeError` for an unknown zone or an invalid instant.
 */
export function dateKeyInZone(epochMs: number, timeZone: string): string {
  const offset = tzOffset(timeZone, new Date(epochMs));
  if (Number.isNaN(offset)) {
    throw new RangeError("Unknown time zone or invalid instant");
  }
  // Only pre-1900 local mean times have second-level offsets; whole minutes suffice.
  return formatUtcDate(new Date(epochMs + Math.round(offset) * MINUTE_MS));
}

/**
 * Today's date key (`YYYY-MM-DD`) in `timeZone` at `nowMs`. The worker's agenda window
 * and the client's `range.from` both derive from this, so they always agree.
 */
export function todayInZone(nowMs: number, timeZone: string): string {
  return dateKeyInZone(nowMs, timeZone);
}

/** True if `value` is a strict `YYYY-MM-DD` key of an existing date. */
export function isDateKey(value: string): boolean {
  const match = DATE_KEY_RE.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const check = new Date(0);
  check.setUTCFullYear(year, month - 1, day);
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

/**
 * `date` (`YYYY-MM-DD`) shifted by `days` calendar days (pure calendar arithmetic, no
 * zone, so DST cannot affect it). Throws a `RangeError` for a malformed date.
 */
export function addCalendarDays(date: string, days: number): string {
  if (!isDateKey(date)) {
    throw new RangeError("date must be YYYY-MM-DD");
  }
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const shifted = new Date(0);
  shifted.setUTCFullYear(year, month - 1, day + days);
  return formatUtcDate(shifted);
}

function utcDayNumber(date: string): number {
  if (!isDateKey(date)) {
    throw new RangeError("date must be YYYY-MM-DD");
  }
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const at = new Date(0);
  at.setUTCFullYear(year, month - 1, day);
  return Math.round(at.getTime() / 86_400_000);
}

/**
 * Calendar days from `from` to `to` (both `YYYY-MM-DD`): positive if `to` is later,
 * 0 for the same date. Pure calendar arithmetic (UTC day numbers), so a DST change in
 * between never makes a day 23 or 25 hours long. Throws a `RangeError` for a malformed
 * date.
 */
export function calendarDaysBetween(from: string, to: string): number {
  return utcDayNumber(to) - utcDayNumber(from);
}
