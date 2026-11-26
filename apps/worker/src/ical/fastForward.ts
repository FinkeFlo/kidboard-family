import { naiveUtcMs, type WallTime } from "@kidboard/shared";
import type ICAL from "ical.js";

/**
 * Fast-forwarding of long-running recurrence rules (ADR-0003).
 *
 * ical.js always iterates a rule from DTSTART, so a daily series started five years
 * ago costs ~1 800 iterations per request. For the rule shapes below, moving DTSTART
 * forward by a whole number of recurrence periods (FREQ × INTERVAL) produces exactly
 * the same instances from the new start on, because every instance is defined
 * relative to the period it falls in, and whole-period shifts keep the period grid
 * (week start, month and year boundaries, INTERVAL alignment) and the values that
 * ical.js derives implicitly from DTSTART (weekday, day of month, month, time of day).
 *
 * The shifted DTSTART itself may not be an instance of the original rule (RFC 5545
 * counts DTSTART as an instance even if the rule does not match it), so the caller
 * places it at least two periods plus the event duration before the window, where
 * that extra instance can never be emitted.
 *
 * Anything that is not provably equivalent returns null and is iterated in full:
 * COUNT (instances before the window must be counted), sub-daily frequencies,
 * BYSETPOS / BYWEEKNO / BYYEARDAY / BYHOUR / BYMINUTE / BYSECOND, ordinal BYDAY in
 * DAILY/WEEKLY rules, YEARLY day rules without BYMONTH, and days of month above 28
 * (a shifted 29th–31st could fall into a month that lacks it).
 */

const DAY_MS = 86_400_000;

const ALLOWED_PARTS: Readonly<Record<string, readonly string[]>> = {
  DAILY: ["BYDAY", "BYMONTH", "BYMONTHDAY"],
  WEEKLY: ["BYDAY", "BYMONTH"],
  MONTHLY: ["BYDAY", "BYMONTH", "BYMONTHDAY"],
  YEARLY: ["BYDAY", "BYMONTH", "BYMONTHDAY"],
};

/** Approximate upper bound of one period (FREQ with INTERVAL 1) in days. */
const PERIOD_DAYS: Readonly<Record<string, number>> = {
  DAILY: 1,
  WEEKLY: 7,
  MONTHLY: 31,
  YEARLY: 366,
};

/**
 * Returns `start` moved forward by whole recurrence periods so that it lies at least
 * two periods before `latestNaive` (a wall-clock instant read as UTC), or null if the
 * rule cannot be fast-forwarded safely or no shift is needed.
 */
export function fastForwardStart(
  rule: ICAL.Recur,
  start: WallTime,
  latestNaive: number,
): WallTime | null {
  const allowed = ALLOWED_PARTS[rule.freq];
  const periodDays = PERIOD_DAYS[rule.freq];
  if (allowed === undefined || periodDays === undefined) {
    return null;
  }
  if (rule.count !== null) {
    return null;
  }
  const interval = rule.interval;
  if (!Number.isInteger(interval) || interval < 1) {
    return null;
  }

  const used = new Set<string>();
  for (const [name, values] of Object.entries(rule.parts)) {
    if (Array.isArray(values) && values.length > 0) {
      if (!allowed.includes(name)) {
        return null;
      }
      used.add(name);
    }
  }
  const byDay = rule.parts.BYDAY ?? [];
  if (
    (rule.freq === "DAILY" || rule.freq === "WEEKLY") &&
    byDay.some((day) => /\d/.test(day))
  ) {
    return null;
  }
  if (rule.freq === "MONTHLY" || rule.freq === "YEARLY") {
    if (start.day > 28) {
      return null;
    }
    if (
      rule.freq === "YEARLY" &&
      (used.has("BYDAY") || used.has("BYMONTHDAY")) &&
      !used.has("BYMONTH")
    ) {
      return null;
    }
  }

  const target = latestNaive - 2 * interval * periodDays * DAY_MS;
  const startNaive = naiveUtcMs(start);
  if (startNaive >= target) {
    return null;
  }

  let dayShift = 0;
  let monthShift = 0;
  if (rule.freq === "DAILY" || rule.freq === "WEEKLY") {
    const stepDays = interval * periodDays;
    dayShift =
      Math.floor((target - startNaive) / (stepDays * DAY_MS)) * stepDays;
  } else {
    const targetDate = new Date(target);
    const months =
      (targetDate.getUTCFullYear() - start.year) * 12 +
      (targetDate.getUTCMonth() + 1 - start.month) -
      1;
    const stepMonths = rule.freq === "MONTHLY" ? interval : interval * 12;
    monthShift = Math.floor(months / stepMonths) * stepMonths;
  }
  if (dayShift <= 0 && monthShift <= 0) {
    return null;
  }

  const shifted = new Date(0);
  shifted.setUTCFullYear(
    start.year,
    start.month - 1 + monthShift,
    start.day + dayShift,
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: start.hour,
    minute: start.minute,
    second: start.second,
  };
}
