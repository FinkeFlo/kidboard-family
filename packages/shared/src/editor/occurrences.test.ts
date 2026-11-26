import { describe, expect, it } from "vitest";

import { type EditorEntryInput, EditorEntryInputSchema } from "./entry";
import { entryDateRange, isOccurrenceDate } from "./items";

function entry(fields: Record<string, unknown>): EditorEntryInput {
  return EditorEntryInputSchema.parse({
    kind: "event",
    icon: "🏊",
    title: "Schwimmen",
    allDay: false,
    date: "2026-03-09",
    startTime: "16:00",
    ...fields,
  });
}

// 2026-03-09 is a Monday.
const weeklyMonWed = entry({
  repeat: { weekly: { weekdays: [1, 3] } },
});
const biweeklyMon = entry({
  repeat: { weekly: { weekdays: [1], interval: 2, until: "2026-04-20" } },
});

describe("isOccurrenceDate", () => {
  it.each([
    ["2026-03-09", true], // first day
    ["2026-03-11", true], // Wednesday
    ["2026-03-10", false], // Tuesday
    ["2026-03-02", false], // Monday before the start
    ["2027-01-04", true], // far later Monday, open-ended
  ])("weekly Mon+Wed: %s → %s", (date, expected) => {
    expect(isOccurrenceDate(weeklyMonWed, date)).toBe(expected);
  });

  it.each([
    ["2026-03-09", true], // week 0
    ["2026-03-16", false], // week 1 (skipped)
    ["2026-03-23", true], // week 2
    ["2026-03-30", false], // week 3, spans the DST change in Europe (calendar dates only)
    ["2026-04-20", true], // until, inclusive
    ["2026-05-04", false], // after until
  ])("every 2 weeks on Monday until 2026-04-20: %s → %s", (date, expected) => {
    expect(isOccurrenceDate(biweeklyMon, date)).toBe(expected);
  });

  it("counts every-other weeks from the first week even when it starts mid-week", () => {
    // Starts Wednesday 2026-03-11 on Mon+Wed every 2 weeks: the Monday of the first
    // week (03-09) is before the start, the next Monday of the series is 03-23.
    const series = entry({
      date: "2026-03-11",
      repeat: { weekly: { weekdays: [1, 3], interval: 2 } },
    });
    expect(isOccurrenceDate(series, "2026-03-09")).toBe(false);
    expect(isOccurrenceDate(series, "2026-03-16")).toBe(false);
    expect(isOccurrenceDate(series, "2026-03-18")).toBe(false);
    expect(isOccurrenceDate(series, "2026-03-23")).toBe(true);
    expect(isOccurrenceDate(series, "2026-03-25")).toBe(true);
  });

  it("a single entry has exactly its own day", () => {
    const single = entry({});
    expect(isOccurrenceDate(single, "2026-03-09")).toBe(true);
    expect(isOccurrenceDate(single, "2026-03-16")).toBe(false);
  });
});

describe("entryDateRange", () => {
  it("covers a timed single entry generously into the next day", () => {
    expect(entryDateRange(entry({ startTime: "23:30" }), {})).toEqual({
      first: "2026-03-09",
      last: "2026-03-10",
    });
  });

  it("uses the exclusive end of an all-day multi-day entry", () => {
    expect(
      entryDateRange(
        entry({
          allDay: true,
          startTime: undefined,
          endDate: "2026-03-12",
        }),
        {},
      ),
    ).toEqual({ first: "2026-03-09", last: "2026-03-11" });
  });

  it("is open-ended for a series without until and bounded with until", () => {
    expect(entryDateRange(weeklyMonWed, {})).toEqual({
      first: "2026-03-09",
      last: null,
    });
    expect(entryDateRange(biweeklyMon, {})).toEqual({
      first: "2026-03-09",
      last: "2026-04-21",
    });
  });

  it("widens the range for overrides moved outside it", () => {
    const movedEarlier = entry({ date: "2026-03-06", startTime: "10:00" });
    const movedLater = entry({ date: "2026-04-24", startTime: "10:00" });
    expect(
      entryDateRange(biweeklyMon, {
        "2026-03-09": movedEarlier,
        "2026-04-20": movedLater,
      }),
    ).toEqual({ first: "2026-03-06", last: "2026-04-25" });
  });
});
