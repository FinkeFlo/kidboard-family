import { addCalendarDays } from "../dates";
import { minutesOfTime } from "../primitives";
import {
  formatCalendarDate,
  naiveUtcMs,
  parseCalendarDate,
  startOfDayMs,
  wallTimeAt,
  wallTimeToEpochMs,
} from "../wallTime";

/**
 * String-based (`YYYY-MM-DD`, `HH:mm`) adapters of `../wallTime.ts` for the editor.
 * Wall-clock time <-> instant conversion is always in an explicitly given IANA zone
 * (the configured `timeZone`, never the device zone); DST gaps and overlaps follow
 * RFC 5545 section 3.3.5 (see `../wallTime.ts`), exactly like the worker's feed
 * expansion, because it is the same code.
 */

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `HH:mm` of minutes since midnight (0-1439). */
export function timeOfMinutes(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function parseDate(
  date: string,
): NonNullable<ReturnType<typeof parseCalendarDate>> {
  const parsed = parseCalendarDate(date);
  if (parsed === null) {
    throw new RangeError("date must be YYYY-MM-DD");
  }
  return parsed;
}

/**
 * Epoch ms of the wall-clock `date` + `time` (`HH:mm`, optional extra `seconds`) in
 * `timeZone`. Throws a `RangeError` for a malformed date or time.
 */
export function zonedWallTimeToEpochMs(
  date: string,
  time: string,
  timeZone: string,
  seconds = 0,
): number {
  const minutes = minutesOfTime(time);
  return wallTimeToEpochMs(
    {
      ...parseDate(date),
      hour: Math.floor(minutes / 60),
      minute: minutes % 60,
      second: seconds,
    },
    timeZone,
  );
}

/** Epoch ms of local midnight starting `date` in `timeZone`. */
export function startOfZonedDayMs(date: string, timeZone: string): number {
  return startOfDayMs(parseDate(date), timeZone);
}

export interface ZonedWallTime {
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:mm` */
  time: string;
  /** Seconds within the minute (0-59); the editor works in whole minutes. */
  seconds: number;
}

/** Wall-clock date and time of the instant `epochMs` in `timeZone`. */
export function wallTimeInZone(
  epochMs: number,
  timeZone: string,
): ZonedWallTime {
  const wall = wallTimeAt(epochMs, timeZone);
  return {
    date: formatCalendarDate(wall),
    time: `${pad(wall.hour)}:${pad(wall.minute)}`,
    seconds: wall.second,
  };
}

/** `date` + `time` shifted by `minutes` of wall-clock time (may roll over to other days). */
export function addWallMinutes(
  date: string,
  time: string,
  minutes: number,
): { date: string; time: string } {
  const total = minutesOfTime(time) + minutes;
  const days = Math.floor(total / 1440);
  return {
    date: addCalendarDays(date, days),
    time: timeOfMinutes(total - days * 1440),
  };
}

/** ISO weekday of a `YYYY-MM-DD` date: 1 = Monday … 7 = Sunday (pure calendar arithmetic). */
export function isoWeekday(date: string): number {
  const day = new Date(
    naiveUtcMs({ ...parseDate(date), hour: 0, minute: 0, second: 0 }),
  ).getUTCDay();
  return day === 0 ? 7 : day;
}
