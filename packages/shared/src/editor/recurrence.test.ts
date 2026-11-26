import { describe, expect, it } from "vitest";

import type { EditorRepeat } from "./entry";
import { buildRecurrenceRule, type RecurrenceStart } from "./recurrence";

const BERLIN = "Europe/Berlin";
const LA = "America/Los_Angeles";

function weekly(
  weekdays: number[],
  interval: 1 | 2 = 1,
  until?: string,
): EditorRepeat {
  return {
    weekly: { weekdays, interval, ...(until === undefined ? {} : { until }) },
  };
}

describe("buildRecurrenceRule", () => {
  const timed: RecurrenceStart = { date: "2026-11-23", startTime: "17:00" };
  const allDay: RecurrenceStart = { date: "2026-11-23" };

  it("none -> no rule", () => {
    expect(buildRecurrenceRule("none", timed, BERLIN)).toBeNull();
  });

  it.each<[EditorRepeat, RecurrenceStart, string, string]>([
    [weekly([1]), timed, BERLIN, "FREQ=WEEKLY;BYDAY=MO"],
    [weekly([5, 1, 3]), timed, BERLIN, "FREQ=WEEKLY;BYDAY=MO,WE,FR"],
    [weekly([7, 1], 2), timed, BERLIN, "FREQ=WEEKLY;BYDAY=MO,SU;INTERVAL=2"],
    // all-day: UNTIL is the DATE of the last day
    [
      weekly([1], 1, "2026-12-28"),
      allDay,
      BERLIN,
      "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261228",
    ],
    [
      weekly([1], 2, "2026-12-28"),
      allDay,
      LA,
      "FREQ=WEEKLY;BYDAY=MO;INTERVAL=2;UNTIL=20261228",
    ],
    // timed: last second of the last local day, in UTC, with that day's offset
    [
      weekly([1], 1, "2026-12-31"),
      timed,
      BERLIN,
      "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231T225959Z",
    ],
    [
      weekly([1], 1, "2026-03-28"),
      timed,
      BERLIN,
      "FREQ=WEEKLY;BYDAY=MO;UNTIL=20260328T225959Z",
    ],
    [
      weekly([1], 1, "2026-03-29"),
      timed,
      BERLIN,
      "FREQ=WEEKLY;BYDAY=MO;UNTIL=20260329T215959Z",
    ],
    [
      weekly([1], 1, "2026-10-25"),
      timed,
      BERLIN,
      "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261025T225959Z",
    ],
    [
      weekly([1], 1, "2026-07-01"),
      timed,
      BERLIN,
      "FREQ=WEEKLY;BYDAY=MO;UNTIL=20260701T215959Z",
    ],
    [
      weekly([1], 1, "2026-03-07"),
      timed,
      LA,
      "FREQ=WEEKLY;BYDAY=MO;UNTIL=20260308T075959Z",
    ],
    [
      weekly([1], 1, "2026-03-08"),
      timed,
      LA,
      "FREQ=WEEKLY;BYDAY=MO;UNTIL=20260309T065959Z",
    ],
    [
      weekly([1], 1, "2026-11-01"),
      timed,
      LA,
      "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261102T075959Z",
    ],
  ])("%j %j %s -> %s", (repeat, start, zone, expected) => {
    expect(
      buildRecurrenceRule(repeat, { ...start, date: "2026-01-05" }, zone),
    ).toBe(expected);
  });

  it("rejects an end before the start", () => {
    expect(() =>
      buildRecurrenceRule(weekly([1], 1, "2026-11-16"), timed, BERLIN),
    ).toThrow(RangeError);
  });
});
