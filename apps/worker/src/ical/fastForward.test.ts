import { naiveUtcMs, type WallTime } from "@kidboard/shared";
import ICAL from "ical.js";
import { describe, expect, it } from "vitest";

import { fastForwardStart } from "./fastForward";

const wall = (
  year: number,
  month: number,
  day: number,
  hour = 8,
): WallTime => ({ year, month, day, hour, minute: 0, second: 0 });

/** Window start used for all cases: 2026-03-23, as a wall-clock value read as UTC. */
const LATEST = naiveUtcMs(wall(2026, 3, 23, 0));

function shift(rule: string, start: WallTime): WallTime | null {
  return fastForwardStart(ICAL.Recur.fromString(rule), start, LATEST);
}

describe("fastForwardStart", () => {
  it.each([
    "FREQ=DAILY",
    "FREQ=DAILY;INTERVAL=3;BYDAY=MO,FR",
    "FREQ=DAILY;BYMONTH=3;BYMONTHDAY=1,15",
    "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;WKST=SU",
    "FREQ=WEEKLY;BYMONTH=4",
    "FREQ=WEEKLY;BYMONTH=3;BYDAY=MO",
    "FREQ=MONTHLY;BYDAY=2TU",
    "FREQ=MONTHLY;BYMONTHDAY=-1",
    "FREQ=YEARLY",
    "FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=1",
    "FREQ=DAILY;UNTIL=20270101T000000Z",
  ])("fast-forwards %s", (rule) => {
    const shifted = shift(rule, wall(2021, 3, 17));
    expect(shifted).not.toBeNull();
    expect(naiveUtcMs(shifted ?? wall(0, 1, 1))).toBeLessThan(LATEST);
    expect(shifted?.hour).toBe(8);
  });

  it.each([
    ["COUNT", "FREQ=DAILY;COUNT=5000"],
    ["sub-daily", "FREQ=HOURLY"],
    ["sub-daily", "FREQ=MINUTELY"],
    ["BYSETPOS", "FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=-1"],
    ["BYWEEKNO", "FREQ=YEARLY;BYWEEKNO=10"],
    ["BYYEARDAY", "FREQ=YEARLY;BYYEARDAY=100"],
    ["BYHOUR", "FREQ=DAILY;BYHOUR=8,17"],
    ["ordinal BYDAY in WEEKLY", "FREQ=WEEKLY;BYDAY=1MO"],
    ["ordinal BYDAY in DAILY", "FREQ=DAILY;BYDAY=-1FR"],
    ["YEARLY BYDAY without BYMONTH", "FREQ=YEARLY;BYDAY=20MO"],
    ["YEARLY BYMONTHDAY without BYMONTH", "FREQ=YEARLY;BYMONTHDAY=1"],
  ])("does not fast-forward %s (%s)", (_label, rule) => {
    expect(shift(rule, wall(2021, 3, 17))).toBeNull();
  });

  it("allows day of month 28 but not 29 for MONTHLY and YEARLY", () => {
    expect(shift("FREQ=MONTHLY", wall(2021, 1, 28))).toEqual(
      wall(2025, 12, 28),
    );
    expect(shift("FREQ=MONTHLY", wall(2021, 1, 29))).toBeNull();
    expect(shift("FREQ=YEARLY", wall(2021, 2, 28))).not.toBeNull();
    expect(shift("FREQ=YEARLY", wall(2020, 2, 29))).toBeNull();
  });

  it("allows day 29-31 for DAILY and WEEKLY (whole-day shifts)", () => {
    expect(shift("FREQ=DAILY", wall(2021, 1, 31))).not.toBeNull();
    expect(shift("FREQ=WEEKLY", wall(2021, 1, 31))).not.toBeNull();
  });

  it("shifts by whole periods only and keeps two periods of slack", () => {
    const start = wall(2021, 3, 17); // Wednesday
    const daily = shift("FREQ=DAILY;INTERVAL=3", start);
    const weekly = shift("FREQ=WEEKLY;INTERVAL=2", start);
    const day = 86_400_000;
    const offset = (shifted: WallTime | null): number =>
      (naiveUtcMs(shifted ?? start) - naiveUtcMs(start)) / day;
    expect(offset(daily) % 3).toBe(0);
    expect(offset(weekly) % 14).toBe(0);
    expect(LATEST - naiveUtcMs(daily ?? start)).toBeGreaterThanOrEqual(6 * day);
    expect(LATEST - naiveUtcMs(weekly ?? start)).toBeGreaterThanOrEqual(
      28 * day,
    );
    // From 2015, the latest 2-year step that keeps 4 years of slack is 2021.
    expect(shift("FREQ=YEARLY;INTERVAL=2", wall(2015, 3, 17))).toEqual(
      wall(2021, 3, 17),
    );
  });

  it("returns null when DTSTART is already close to the window", () => {
    expect(shift("FREQ=DAILY", wall(2026, 3, 20))).toBeNull();
    expect(shift("FREQ=WEEKLY", wall(2026, 3, 10))).toBeNull();
    // 22 days before the window: one whole week can still be skipped.
    expect(shift("FREQ=WEEKLY", wall(2026, 3, 1))).toEqual(wall(2026, 3, 8));
  });
});
