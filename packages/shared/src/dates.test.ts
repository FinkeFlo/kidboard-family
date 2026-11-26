import { describe, expect, it } from "vitest";

import {
  addCalendarDays,
  calendarDaysBetween,
  dateKeyInZone,
  isDateKey,
  todayInZone,
} from "./dates";

const at = (iso: string): number => Date.parse(iso);

describe("todayInZone", () => {
  it("changes exactly at local midnight in the given zone", () => {
    // Europe/Berlin is +01:00 in November.
    expect(todayInZone(at("2026-11-22T22:59:59.999Z"), "Europe/Berlin")).toBe(
      "2026-11-22",
    );
    expect(todayInZone(at("2026-11-22T23:00:00.000Z"), "Europe/Berlin")).toBe(
      "2026-11-23",
    );
  });

  it("gives different dates for the same instant in different zones", () => {
    const instant = at("2026-11-23T03:30:00Z");
    expect(todayInZone(instant, "Europe/Berlin")).toBe("2026-11-23");
    expect(todayInZone(instant, "America/Los_Angeles")).toBe("2026-11-22");
    expect(todayInZone(instant, "Pacific/Kiritimati")).toBe("2026-11-23");
    expect(todayInZone(instant, "UTC")).toBe("2026-11-23");
  });

  it("handles the Europe/Berlin DST nights (23 h and 25 h days)", () => {
    // Spring forward 2026-03-29 02:00 → 03:00: the day starts at 23:00Z, ends at 22:00Z.
    expect(todayInZone(at("2026-03-28T22:59:59Z"), "Europe/Berlin")).toBe(
      "2026-03-28",
    );
    expect(todayInZone(at("2026-03-28T23:00:00Z"), "Europe/Berlin")).toBe(
      "2026-03-29",
    );
    expect(todayInZone(at("2026-03-29T21:59:59Z"), "Europe/Berlin")).toBe(
      "2026-03-29",
    );
    expect(todayInZone(at("2026-03-29T22:00:00Z"), "Europe/Berlin")).toBe(
      "2026-03-30",
    );
    // Fall back 2026-10-25 03:00 → 02:00: the day starts at 22:00Z, ends at 23:00Z.
    expect(todayInZone(at("2026-10-24T22:00:00Z"), "Europe/Berlin")).toBe(
      "2026-10-25",
    );
    expect(todayInZone(at("2026-10-25T22:00:00Z"), "Europe/Berlin")).toBe(
      "2026-10-25",
    );
    expect(todayInZone(at("2026-10-25T22:59:59Z"), "Europe/Berlin")).toBe(
      "2026-10-25",
    );
    expect(todayInZone(at("2026-10-25T23:00:00Z"), "Europe/Berlin")).toBe(
      "2026-10-26",
    );
  });

  it("handles a DST change at midnight (America/Santiago skips 00:00-01:00)", () => {
    // 2026-09-06 00:00 -04:00 becomes 01:00 -03:00.
    expect(
      todayInZone(at("2026-09-06T03:59:59.999Z"), "America/Santiago"),
    ).toBe("2026-09-05");
    expect(todayInZone(at("2026-09-06T04:00:00Z"), "America/Santiago")).toBe(
      "2026-09-06",
    );
  });

  it("handles fractional-hour offsets and year boundaries", () => {
    // Asia/Kathmandu is +05:45.
    expect(todayInZone(at("2026-12-31T18:14:59Z"), "Asia/Kathmandu")).toBe(
      "2026-12-31",
    );
    expect(todayInZone(at("2026-12-31T18:15:00Z"), "Asia/Kathmandu")).toBe(
      "2027-01-01",
    );
  });

  it("throws for an unknown zone or an invalid instant", () => {
    expect(() => todayInZone(0, "Mars/Olympus")).toThrow(RangeError);
    expect(() => todayInZone(Number.NaN, "Europe/Berlin")).toThrow(RangeError);
  });

  it("is the same function as dateKeyInZone", () => {
    const instant = at("2026-06-01T12:00:00Z");
    expect(todayInZone(instant, "Asia/Tokyo")).toBe(
      dateKeyInZone(instant, "Asia/Tokyo"),
    );
  });
});

describe("addCalendarDays", () => {
  it("shifts across month, year and leap-day boundaries", () => {
    expect(addCalendarDays("2026-11-22", 8)).toBe("2026-11-30");
    expect(addCalendarDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addCalendarDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addCalendarDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addCalendarDays("2026-11-22", 0)).toBe("2026-11-22");
  });

  it("rejects malformed or impossible dates", () => {
    expect(() => addCalendarDays("2026-02-30", 1)).toThrow(RangeError);
    expect(() => addCalendarDays("2026-1-01", 1)).toThrow(RangeError);
    expect(() => addCalendarDays("", 1)).toThrow(RangeError);
  });
});

describe("isDateKey", () => {
  it("accepts real dates only", () => {
    expect(isDateKey("2028-02-29")).toBe(true);
    expect(isDateKey("2026-02-29")).toBe(false);
    expect(isDateKey("2026-13-01")).toBe(false);
    expect(isDateKey("2026-11-22T00:00:00Z")).toBe(false);
  });
});

describe("calendarDaysBetween", () => {
  it("counts calendar days, negative backwards, 0 for the same day", () => {
    expect(calendarDaysBetween("2026-11-22", "2026-11-22")).toBe(0);
    expect(calendarDaysBetween("2026-11-22", "2026-11-23")).toBe(1);
    expect(calendarDaysBetween("2026-11-23", "2026-11-22")).toBe(-1);
    expect(calendarDaysBetween("2026-11-22", "2026-12-22")).toBe(30);
    expect(calendarDaysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(calendarDaysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(calendarDaysBetween("0099-12-31", "0100-01-01")).toBe(1);
  });

  it("ignores DST changes in between (23 h and 25 h days count as one day)", () => {
    // Europe/Berlin springs forward on 2026-03-29 and falls back on 2026-10-25.
    expect(calendarDaysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(calendarDaysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(calendarDaysBetween("2026-03-01", "2026-11-01")).toBe(245);
  });

  it("is the inverse of addCalendarDays", () => {
    for (const days of [-40, -1, 0, 1, 13, 14, 15, 30, 31, 400]) {
      expect(
        calendarDaysBetween("2026-03-20", addCalendarDays("2026-03-20", days)),
      ).toBe(days);
    }
  });

  it("rejects malformed or impossible dates", () => {
    expect(() => calendarDaysBetween("2026-02-30", "2026-03-01")).toThrow(
      RangeError,
    );
    expect(() => calendarDaysBetween("2026-03-01", "tomorrow")).toThrow(
      RangeError,
    );
  });
});
