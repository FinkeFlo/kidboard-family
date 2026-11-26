import { describe, expect, it } from "vitest";

import {
  type FormatContext,
  formatDayMonth,
  formatDayMonthShort,
  formatLongDate,
  formatTime,
  formatWeekday,
} from "./format";

const berlinDe: FormatContext = { locale: "de", timeZone: "Europe/Berlin" };
const berlinEn: FormatContext = { locale: "en", timeZone: "Europe/Berlin" };

describe("date/time formatting", () => {
  it("formats in the active locale", () => {
    const instant = "2025-03-02T12:00:00Z"; // a Sunday
    expect(formatWeekday(instant, berlinDe)).toBe("Sonntag");
    expect(formatWeekday(instant, berlinEn)).toBe("Sunday");
    expect(formatDayMonth(instant, berlinDe)).toBe("2. März");
    expect(formatDayMonth(instant, berlinEn)).toBe("March 2");
    expect(formatDayMonthShort(instant, berlinEn)).toBe("Mar 2");
    expect(formatDayMonthShort("2025-11-26", berlinEn)).toBe("Nov 26");
    expect(formatDayMonthShort("2025-11-26", berlinDe)).toMatch(/^26\. Nov/);
    expect(formatLongDate(instant, berlinEn)).toBe("March 2, 2025");
    expect(formatLongDate(instant, berlinDe)).toBe("2. März 2025");
  });

  it("uses 24 h for de and 12 h for en", () => {
    const instant = "2025-03-02T13:30:00Z"; // 14:30 in Berlin
    expect(formatTime(instant, berlinDe)).toBe("14:30");
    expect(formatTime(instant, berlinEn)).toBe("2:30 PM");
  });

  it("uses the configured zone, not the device zone", () => {
    const instant = "2025-06-15T22:30:00Z";
    expect(
      formatTime(instant, { locale: "de", timeZone: "Europe/Berlin" }),
    ).toBe("00:30");
    expect(
      formatWeekday(instant, { locale: "de", timeZone: "Europe/Berlin" }),
    ).toBe("Montag");
    expect(
      formatTime(instant, { locale: "de", timeZone: "America/New_York" }),
    ).toBe("18:30");
    expect(
      formatWeekday(instant, { locale: "de", timeZone: "America/New_York" }),
    ).toBe("Sonntag");
  });

  it("handles the spring-forward night (Berlin, 2025-03-30)", () => {
    // 01:30 CET (UTC+1) then 03:30 CEST (UTC+2): 02:xx does not exist.
    expect(formatTime("2025-03-30T00:30:00Z", berlinDe)).toBe("01:30");
    expect(formatTime("2025-03-30T01:30:00Z", berlinDe)).toBe("03:30");
    expect(formatDayMonth("2025-03-30T01:30:00Z", berlinDe)).toBe("30. März");
  });

  it("handles the fall-back night (Berlin, 2025-10-26)", () => {
    // 02:30 occurs twice: CEST (UTC+2) and CET (UTC+1).
    expect(formatTime("2025-10-26T00:30:00Z", berlinDe)).toBe("02:30");
    expect(formatTime("2025-10-26T01:30:00Z", berlinDe)).toBe("02:30");
    expect(formatTime("2025-10-26T02:30:00Z", berlinDe)).toBe("03:30");
  });

  it("assigns instants just around local midnight to the right day", () => {
    // 2025-03-29T22:59Z = 23:59 CET, 23:00Z = 00:00 CET on the 30th.
    expect(formatDayMonth("2025-03-29T22:59:00Z", berlinDe)).toBe("29. März");
    expect(formatDayMonth("2025-03-29T23:00:00Z", berlinDe)).toBe("30. März");
  });

  describe("date keys (YYYY-MM-DD)", () => {
    const nyEn: FormatContext = { locale: "en", timeZone: "America/New_York" };
    const nyDe: FormatContext = { locale: "de", timeZone: "America/New_York" };
    const aklEn: FormatContext = { locale: "en", timeZone: "Pacific/Auckland" };
    const aklDe: FormatContext = { locale: "de", timeZone: "Pacific/Auckland" };

    it("keeps the calendar day west of UTC (America/New_York)", () => {
      // UTC-midnight parsing would yield Saturday, October 25.
      expect(formatWeekday("2025-10-26", nyEn)).toBe("Sunday");
      expect(formatWeekday("2025-10-26", nyDe)).toBe("Sonntag");
      expect(formatLongDate("2025-10-26", nyEn)).toBe("October 26, 2025");
      expect(formatLongDate("2025-10-26", nyDe)).toBe("26. Oktober 2025");
      expect(formatDayMonth("2025-10-26", nyEn)).toBe("October 26");
      expect(formatDayMonth("2025-10-26", nyDe)).toBe("26. Oktober");
    });

    it("keeps the calendar day far east of UTC (Pacific/Auckland)", () => {
      // Auckland is UTC+13 in January; year boundary as an extra edge.
      expect(formatWeekday("2025-01-01", aklEn)).toBe("Wednesday");
      expect(formatWeekday("2025-01-01", aklDe)).toBe("Mittwoch");
      expect(formatLongDate("2025-01-01", aklEn)).toBe("January 1, 2025");
      expect(formatLongDate("2025-01-01", aklDe)).toBe("1. Januar 2025");
      expect(formatDayMonth("2024-12-31", aklEn)).toBe("December 31");
      expect(formatDayMonth("2024-12-31", aklDe)).toBe("31. Dezember");
    });

    it("keeps DST transition days intact (Europe/Berlin)", () => {
      expect(formatWeekday("2025-03-30", berlinDe)).toBe("Sonntag");
      expect(formatLongDate("2025-03-30", berlinDe)).toBe("30. März 2025");
      expect(formatDayMonth("2025-03-30", berlinEn)).toBe("March 30");
      expect(formatWeekday("2025-10-26", berlinEn)).toBe("Sunday");
      expect(formatLongDate("2025-10-26", berlinDe)).toBe("26. Oktober 2025");
      expect(formatDayMonth("2025-10-26", berlinEn)).toBe("October 26");
    });

    it("accepts a leap day", () => {
      expect(formatLongDate("2024-02-29", nyEn)).toBe("February 29, 2024");
    });

    it("rejects malformed date keys instead of rolling over", () => {
      for (const key of [
        "2025-02-30",
        "2025-02-29",
        "2025-13-01",
        "2025-00-10",
      ]) {
        expect(() => formatWeekday(key, berlinDe)).toThrow(RangeError);
        expect(() => formatLongDate(key, berlinDe)).toThrow(/Invalid date key/);
        expect(() => formatDayMonth(key, berlinDe)).toThrow(RangeError);
      }
    });

    it("rejects strings that would be parsed in the device zone", () => {
      for (const value of [
        "2025-1-5",
        "2025-10-26T10:00:00",
        "26.10.2025",
        "",
      ]) {
        expect(() => formatWeekday(value, berlinDe)).toThrow(RangeError);
        expect(() => formatTime(value, berlinDe)).toThrow(RangeError);
      }
    });

    it("formatTime rejects a date key (it has no time of day)", () => {
      expect(() => formatTime("2025-10-26", berlinDe)).toThrow(
        /has no time of day/,
      );
      expect(() => formatTime("2025-02-30", berlinEn)).toThrow(RangeError);
    });
  });

  it("still accepts Date and epoch-ms inputs", () => {
    const ms = Date.UTC(2025, 5, 15, 22, 30);
    expect(formatTime(ms, berlinDe)).toBe("00:30");
    expect(formatWeekday(new Date(ms), berlinEn)).toBe("Monday");
    expect(formatTime("2025-06-15T20:30:00-02:00", berlinDe)).toBe("00:30");
  });
});
