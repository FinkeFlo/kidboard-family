import { addCalendarDays, calendarDaysBetween } from "../dates";
import type { EditorRepeat } from "./entry";
import { startOfZonedDayMs } from "./zonedTime";

/**
 * Weekly recurrence for the editor (ADR-0012, ADR-0014): the value of one
 * `RRULE:FREQ=WEEKLY;BYDAY=…[;INTERVAL=2][;UNTIL=…]` line. The series is anchored to
 * `start.timeZone` = configured zone by the caller, so DST keeps the wall-clock time.
 */

/** RFC 5545 weekday codes indexed by ISO weekday - 1 (Monday first). */
const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

/** Start of the series: `date` (`YYYY-MM-DD`), `startTime` (`HH:mm`) for timed series. */
export interface RecurrenceStart {
  date: string;
  startTime?: string | undefined;
}

function compactDate(date: string): string {
  return date.replaceAll("-", "");
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function compactUtc(epochMs: number): string {
  const at = new Date(epochMs);
  return (
    `${String(at.getUTCFullYear()).padStart(4, "0")}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`
  );
}

/**
 * The `RRULE` *value* for `repeat` (`FREQ=WEEKLY;BYDAY=…[;INTERVAL=2][;UNTIL=…]`,
 * without the `RRULE:` property name), or `null` for `none`. This is the form for
 * iCalendar libraries that take the value, e.g. ical.js `ICAL.Recur.fromString(value)`
 * when the worker renders app entries (ADR-0014).
 *
 * `UNTIL` follows RFC 5545 section 3.3.10: for all-day series (`DTSTART` is a DATE) it
 * is the DATE `YYYYMMDD` of the last day; for timed series (`DTSTART` with a zone) it
 * must be UTC, and it is the last second of the last local day in `timeZone`
 * (`until` + 1 day at local midnight - 1 s, computed with that day's offset, so a DST
 * change in between does not cut off or add a day). Throws a `RangeError` if `until` is
 * before `start.date` or a date is malformed.
 */
export function buildRecurrenceRule(
  repeat: EditorRepeat,
  start: RecurrenceStart,
  timeZone: string,
): string | null {
  if (repeat === "none") {
    return null;
  }
  const { weekdays, interval, until } = repeat.weekly;
  const days = [...new Set(weekdays)]
    .sort((a, b) => a - b)
    .map((day) => WEEKDAY_CODES[day - 1]);
  if (days.length === 0 || days.some((code) => code === undefined)) {
    throw new RangeError("weekdays must be 1-7");
  }
  let rule = `FREQ=WEEKLY;BYDAY=${days.join(",")}`;
  if (interval === 2) {
    rule += ";INTERVAL=2";
  }
  if (until !== undefined) {
    if (calendarDaysBetween(start.date, until) < 0) {
      throw new RangeError("until must not be before the start date");
    }
    rule +=
      start.startTime === undefined
        ? `;UNTIL=${compactDate(until)}`
        : `;UNTIL=${compactUtc(startOfZonedDayMs(addCalendarDays(until, 1), timeZone) - 1000)}`;
  }
  return rule;
}
