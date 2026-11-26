import { describe, expect, it } from "vitest";

import { formatInstant } from "../wallTime";
import { resolveTimedRange, type TimedFields } from "./timeRange";

const BERLIN = "Europe/Berlin";
const LA = "America/Los_Angeles";

describe("resolveTimedRange across spring-forward gaps", () => {
  it.each<[string, TimedFields, string, string, boolean]>([
    // default end: start in the gap -> start moves forward, end = start + 60 min
    [
      BERLIN,
      { date: "2026-03-29", startTime: "02:30" },
      "2026-03-29T03:30:00+02:00",
      "2026-03-29T04:30:00+02:00",
      true,
    ],
    [
      LA,
      { date: "2026-03-08", startTime: "02:15" },
      "2026-03-08T03:15:00-07:00",
      "2026-03-08T04:15:00-07:00",
      true,
    ],
    // default end in the gap: one hour on the wall clock lands after the gap
    [
      BERLIN,
      { date: "2026-03-29", startTime: "01:30" },
      "2026-03-29T01:30:00+01:00",
      "2026-03-29T03:30:00+02:00",
      true,
    ],
    [
      LA,
      { date: "2026-03-08", startTime: "01:45" },
      "2026-03-08T01:45:00-08:00",
      "2026-03-08T03:45:00-07:00",
      true,
    ],
    // explicit end before the moved start -> invalid (rejected, never clamped)
    [
      BERLIN,
      { date: "2026-03-29", startTime: "02:30", endTime: "03:00" },
      "2026-03-29T03:30:00+02:00",
      "2026-03-29T03:00:00+02:00",
      false,
    ],
    [
      BERLIN,
      { date: "2026-03-29", startTime: "02:30", endTime: "03:30" },
      "2026-03-29T03:30:00+02:00",
      "2026-03-29T03:30:00+02:00",
      false,
    ],
    [
      LA,
      { date: "2026-03-08", startTime: "02:15", endTime: "02:45" },
      "2026-03-08T03:15:00-07:00",
      "2026-03-08T03:45:00-07:00",
      true,
    ],
    [
      LA,
      { date: "2026-03-08", startTime: "02:15", endTime: "03:00" },
      "2026-03-08T03:15:00-07:00",
      "2026-03-08T03:00:00-07:00",
      false,
    ],
    // explicit end after the moved start
    [
      BERLIN,
      { date: "2026-03-29", startTime: "02:30", endTime: "04:00" },
      "2026-03-29T03:30:00+02:00",
      "2026-03-29T04:00:00+02:00",
      true,
    ],
    [
      LA,
      { date: "2026-03-08", startTime: "01:00", endTime: "03:00" },
      "2026-03-08T01:00:00-08:00",
      "2026-03-08T03:00:00-07:00",
      true,
    ],
    // ordinary day and overnight
    [
      BERLIN,
      {
        date: "2026-11-23",
        startTime: "22:00",
        endDate: "2026-11-24",
        endTime: "07:00",
      },
      "2026-11-23T22:00:00+01:00",
      "2026-11-24T07:00:00+01:00",
      true,
    ],
  ])("%s %j", (zone, fields, start, end, valid) => {
    const range = resolveTimedRange(fields, zone);
    expect(formatInstant(range.startMs, zone)).toBe(start);
    expect(formatInstant(range.endMs, zone)).toBe(end);
    expect(range.valid).toBe(valid);
    expect(range.explicitEnd).toBe(fields.endTime !== undefined);
  });
});
