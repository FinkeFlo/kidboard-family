import { describe, expect, it } from "vitest";

import {
  formatInstant,
  parseCalendarDate,
  startOfDayMs,
  wallTimeToEpochMs,
} from "./wallTime";

const wall = (iso: string) => {
  const [date = "", time = ""] = iso.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second] = time.split(":").map(Number);
  return {
    year: year ?? 0,
    month: month ?? 0,
    day: day ?? 0,
    hour: hour ?? 0,
    minute: minute ?? 0,
    second: second ?? 0,
  };
};

const toIso = (local: string, zone: string): string =>
  new Date(wallTimeToEpochMs(wall(local), zone)).toISOString();

describe("wallTimeToEpochMs", () => {
  it("converts unambiguous wall times in winter and summer", () => {
    expect(toIso("2026-01-15T08:00:00", "Europe/Berlin")).toBe(
      "2026-01-15T07:00:00.000Z",
    );
    expect(toIso("2026-07-15T08:00:00", "Europe/Berlin")).toBe(
      "2026-07-15T06:00:00.000Z",
    );
    expect(toIso("2026-07-15T08:00:00", "America/New_York")).toBe(
      "2026-07-15T12:00:00.000Z",
    );
  });

  it("resolves a spring-forward gap with the offset before the gap (RFC 5545)", () => {
    // 02:30 does not exist in Berlin on 2026-03-29 → 01:30Z = 03:30+02:00.
    expect(toIso("2026-03-29T02:30:00", "Europe/Berlin")).toBe(
      "2026-03-29T01:30:00.000Z",
    );
    // 02:30 does not exist in New York on 2026-03-08 → 07:30Z = 03:30-04:00.
    expect(toIso("2026-03-08T02:30:00", "America/New_York")).toBe(
      "2026-03-08T07:30:00.000Z",
    );
  });

  it("resolves a fall-back overlap to the first occurrence (RFC 5545)", () => {
    // 02:30 happens twice in Berlin on 2026-10-25: +02:00 first.
    expect(toIso("2026-10-25T02:30:00", "Europe/Berlin")).toBe(
      "2026-10-25T00:30:00.000Z",
    );
    // 01:30 happens twice in New York on 2026-11-01: -04:00 first.
    expect(toIso("2026-11-01T01:30:00", "America/New_York")).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  });

  it("handles the instants right at the transitions", () => {
    expect(toIso("2026-03-29T03:00:00", "Europe/Berlin")).toBe(
      "2026-03-29T01:00:00.000Z",
    );
    expect(toIso("2026-10-25T03:00:00", "Europe/Berlin")).toBe(
      "2026-10-25T02:00:00.000Z",
    );
  });
});

describe("formatInstant", () => {
  it("formats with the zone offset and without milliseconds", () => {
    const ms = Date.UTC(2026, 2, 30, 6, 0, 0);
    expect(formatInstant(ms, "Europe/Berlin")).toBe(
      "2026-03-30T08:00:00+02:00",
    );
    expect(formatInstant(ms, "America/New_York")).toBe(
      "2026-03-30T02:00:00-04:00",
    );
    expect(formatInstant(ms, "Asia/Kolkata")).toBe("2026-03-30T11:30:00+05:30");
    expect(formatInstant(ms, "UTC")).toBe("2026-03-30T06:00:00+00:00");
  });

  it("throws a RangeError for unknown zones", () => {
    expect(() => formatInstant(0, "Mars/Olympus")).toThrow(RangeError);
  });
});

describe("parseCalendarDate / startOfDayMs", () => {
  it("parses strict dates and rejects impossible ones", () => {
    expect(parseCalendarDate("2026-02-28")).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
    expect(parseCalendarDate("2026-02-30")).toBeNull();
    expect(parseCalendarDate("2026-2-3")).toBeNull();
    expect(parseCalendarDate("20260203")).toBeNull();
  });

  it("returns local midnight in the zone", () => {
    expect(
      new Date(
        startOfDayMs({ year: 2026, month: 3, day: 29 }, "Europe/Berlin"),
      ).toISOString(),
    ).toBe("2026-03-28T23:00:00.000Z");
  });
});
