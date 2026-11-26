import ICAL from "ical.js";
import { describe, expect, it } from "vitest";

import bringIcs from "../../../../fixtures/ics/bring.ics?raw";
import dstIcs from "../../../../fixtures/ics/dst.ics?raw";
import edgeCasesIcs from "../../../../fixtures/ics/edge-cases.ics?raw";
import emptyIcs from "../../../../fixtures/ics/empty.ics?raw";
import overridesIcs from "../../../../fixtures/ics/overrides.ics?raw";
import periodsIcs from "../../../../fixtures/ics/periods.ics?raw";
import recurrenceIcs from "../../../../fixtures/ics/recurrence.ics?raw";
import runawayIcs from "../../../../fixtures/ics/runaway.ics?raw";
import singleEventsIcs from "../../../../fixtures/ics/single-events.ics?raw";
import timezonesIcs from "../../../../fixtures/ics/timezones.ics?raw";
import truncatedIcs from "../../../../fixtures/ics/truncated.ics?raw";
import unsatisfiableIcs from "../../../../fixtures/ics/unsatisfiable.ics?raw";
import windowIcs from "../../../../fixtures/ics/window.ics?raw";
import { FeedParseError } from "./errors";
import {
  DEFAULT_MAX_ITERATIONS,
  expandCalendar,
  type ExpandOptions,
  guardRule,
  type Occurrence,
} from "./expandCalendar";

const BERLIN = "Europe/Berlin";
const uid = (name: string): string => `${name}@fixtures.kidboard.invalid`;

function expand(
  ics: string,
  from: string,
  to: string,
  extra: Partial<ExpandOptions> = {},
): Occurrence[] {
  return expandCalendar(ics, { from, to, timeZone: BERLIN, ...extra })
    .occurrences;
}

/** Compact view: uid name, start, end. */
function spans(occurrences: Occurrence[]): string[] {
  return occurrences.map(
    (o) =>
      `${o.uid.replace("@fixtures.kidboard.invalid", "")} ${o.start} ${o.end}`,
  );
}

function only(occurrences: Occurrence[], name: string): Occurrence[] {
  return occurrences.filter((o) => o.uid === uid(name));
}

describe("expandCalendar – single events (AC 1)", () => {
  const result = expand(singleEventsIcs, "2026-03-09", "2026-03-20");

  it("returns every kind of single event, sorted by start", () => {
    expect(spans(result)).toEqual([
      "single-timed 2026-03-10T15:00:00+01:00 2026-03-10T16:00:00+01:00",
      "allday-single 2026-03-11 2026-03-12",
      "allday-multi 2026-03-12 2026-03-15",
      "overnight 2026-03-13T22:00:00+01:00 2026-03-14T01:30:00+01:00",
      "with-duration 2026-03-16T10:00:00+01:00 2026-03-16T11:30:00+01:00",
      "allday-no-dtend 2026-03-17 2026-03-18",
    ]);
  });

  it("maps all fields of a timed event (text unescaped, no recurrence id)", () => {
    expect(result[0]).toEqual({
      uid: uid("single-timed"),
      recurrenceId: null,
      summary: "Swimming",
      description:
        "Bring towel, goggles\nand a snack. Pick-up is at the side entrance after the lesson, please be on time.",
      start: "2026-03-10T15:00:00+01:00",
      end: "2026-03-10T16:00:00+01:00",
      allDay: false,
    });
  });

  it("marks all-day events and uses an exclusive date end", () => {
    const allDay = result.filter((o) => o.allDay).map((o) => o.uid);
    expect(allDay).toEqual([
      uid("allday-single"),
      uid("allday-multi"),
      uid("allday-no-dtend"),
    ]);
    expect(only(result, "allday-single")[0]?.description).toBe("");
  });
});

describe("expandCalendar – description unescaping (T-33)", () => {
  const result = expand(bringIcs, "2026-03-09", "2026-04-09");

  it("unescapes \\n and \\, and unfolds lines (ical.js TEXT values)", () => {
    const series = only(result, "bring-gym");
    expect(series.map((o) => o.start)).toEqual([
      "2026-03-10T15:00:00+01:00",
      "2026-03-24T16:00:00+01:00",
      "2026-03-31T15:00:00+02:00",
      "2026-04-07T15:00:00+02:00",
    ]);
    expect(series[0]?.description).toBe(
      "Halle 2, Eingang Süd\nMitbringen: 👟 Turnschuhe, 🩱 Badeanzug 👟\nTESTONLY-private-note",
    );
    expect(series[1]?.description).toBe(
      "Heute draußen\n- Bring: 🧴 🧢\nTESTONLY-private-note",
    );
  });

  it("unescapes \\; and keeps HTML as raw text", () => {
    expect(only(result, "bring-art")[0]?.description).toBe(
      "<p>Kittel nicht vergessen</p><p><b>Mitbringen:</b>&nbsp;🥼 <img src=x onerror=alert(1)> 🧻<script>alert('🐛')</script></p><p>TESTONLY-private-note</p>",
    );
  });
});

describe("expandCalendar – recurrence rules (AC 2)", () => {
  const result = expand(recurrenceIcs, "2026-03-09", "2026-03-30");

  it("expands a weekly RRULE and honours EXDATE", () => {
    expect(spans(only(result, "weekly-exdate"))).toEqual([
      "weekly-exdate 2026-03-09T09:00:00+01:00 2026-03-09T10:00:00+01:00",
      "weekly-exdate 2026-03-23T09:00:00+01:00 2026-03-23T10:00:00+01:00",
    ]);
    expect(only(result, "weekly-exdate").map((o) => o.recurrenceId)).toEqual([
      "2026-03-09T09:00:00+01:00",
      "2026-03-23T09:00:00+01:00",
    ]);
  });

  it("stops after COUNT occurrences", () => {
    expect(only(result, "daily-count").map((o) => o.start)).toEqual([
      "2026-03-10T07:00:00+01:00",
      "2026-03-11T07:00:00+01:00",
      "2026-03-12T07:00:00+01:00",
    ]);
  });

  it("stops at UNTIL (inclusive)", () => {
    expect(only(result, "weekly-until").map((o) => o.start)).toEqual([
      "2026-03-10T15:30:00+01:00",
      "2026-03-17T15:30:00+01:00",
    ]);
  });

  it("adds RDATE occurrences with the master's duration", () => {
    expect(spans(only(result, "rdate"))).toEqual([
      "rdate 2026-03-11T18:00:00+01:00 2026-03-11T18:30:00+01:00",
      "rdate 2026-03-13T18:00:00+01:00 2026-03-13T18:30:00+01:00",
      "rdate 2026-03-20T19:00:00+01:00 2026-03-20T19:30:00+01:00",
    ]);
  });

  it("returns the whole result sorted by start", () => {
    const starts = result.map((o) => Date.parse(o.start));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});

describe("expandCalendar – RECURRENCE-ID overrides and cancellations (AC 3)", () => {
  it("applies moved and cancelled instances inside the window", () => {
    const result = expand(overridesIcs, "2026-03-09", "2026-03-30");
    expect(
      result.map((o) => [o.summary, o.start, o.end, o.recurrenceId]),
    ).toEqual([
      [
        "Gymnastics",
        "2026-03-09T16:00:00+01:00",
        "2026-03-09T17:00:00+01:00",
        "2026-03-09T16:00:00+01:00",
      ],
      [
        "Gymnastics (later)",
        "2026-03-11T17:30:00+01:00",
        "2026-03-11T18:30:00+01:00",
        "2026-03-11T16:00:00+01:00",
      ],
      [
        "Gymnastics",
        "2026-03-16T16:00:00+01:00",
        "2026-03-16T17:00:00+01:00",
        "2026-03-16T16:00:00+01:00",
      ],
      // Wednesday 18th moved to Thursday 19th.
      [
        "Gymnastics (moved to Thursday)",
        "2026-03-19T10:00:00+01:00",
        "2026-03-19T11:00:00+01:00",
        "2026-03-18T16:00:00+01:00",
      ],
      // Monday 23rd moved OUT of the window (to April 2nd), Wednesday 25th cancelled.
      // Wednesday April 1st (outside) moved INTO the window; its RECURRENCE-ID is UTC.
      [
        "Gymnastics (moved in)",
        "2026-03-28T10:00:00+01:00",
        "2026-03-28T11:00:00+01:00",
        "2026-04-01T16:00:00+02:00",
      ],
    ]);
    expect(result.every((o) => o.uid === uid("series"))).toBe(true);
  });

  it("shows an instance moved out of one window in the window it moved to", () => {
    const result = expand(overridesIcs, "2026-03-30", "2026-04-06");
    expect(result.map((o) => [o.summary, o.start, o.recurrenceId])).toEqual([
      ["Gymnastics", "2026-03-30T16:00:00+02:00", "2026-03-30T16:00:00+02:00"],
      [
        "Gymnastics (moved out)",
        "2026-04-02T16:00:00+02:00",
        "2026-03-23T16:00:00+01:00",
      ],
    ]);
  });

  it("drops a top-level STATUS:CANCELLED event", () => {
    const result = expand(overridesIcs, "2026-03-12", "2026-03-13");
    expect(result.map((o) => o.uid)).not.toContain(uid("cancelled-event"));
    expect(result).toEqual([]);
  });
});

describe("expandCalendar – DST (AC 4)", () => {
  it("keeps a weekly 08:00 Europe/Berlin event at 08:00 across spring-forward", () => {
    const result = only(
      expand(dstIcs, "2026-03-16", "2026-04-07"),
      "weekly-0800",
    );
    expect(result.map((o) => o.start)).toEqual([
      "2026-03-16T08:00:00+01:00",
      "2026-03-23T08:00:00+01:00",
      "2026-03-30T08:00:00+02:00",
      "2026-04-06T08:00:00+02:00",
    ]);
  });

  it("keeps it at 08:00 across fall-back", () => {
    const result = only(
      expand(dstIcs, "2026-10-19", "2026-11-03"),
      "weekly-0800",
    );
    expect(result.map((o) => o.start)).toEqual([
      "2026-10-19T08:00:00+02:00",
      "2026-10-26T08:00:00+01:00",
      "2026-11-02T08:00:00+01:00",
    ]);
  });

  it("shifts a non-existent 02:30 on spring-forward day to 03:30 local", () => {
    const result = expand(dstIcs, "2026-03-29", "2026-03-30");
    expect(spans(result)).toEqual([
      // Same instant: ties are broken by uid.
      "floating-gap 2026-03-29T03:30:00+02:00 2026-03-29T04:00:00+02:00",
      "spring-gap 2026-03-29T03:30:00+02:00 2026-03-29T04:00:00+02:00",
    ]);
  });

  it("resolves an ambiguous 02:30 on fall-back day to the first (summer) occurrence", () => {
    const result = expand(dstIcs, "2026-10-25", "2026-10-26");
    expect(spans(result)).toEqual([
      "fall-overlap 2026-10-25T02:30:00+02:00 2026-10-25T04:00:00+01:00",
    ]);
  });
});

describe("expandCalendar – time zones (AC 5)", () => {
  it("converts every zone flavour to the configured zone", () => {
    const result = expand(timezonesIcs, "2026-03-10", "2026-03-11");
    expect(spans(result)).toEqual([
      // Non-IANA TZID resolved from the feed's VTIMEZONE (+05:30) by ical.js.
      "custom-vtimezone 2026-03-10T07:30:00+01:00 2026-03-10T08:30:00+01:00",
      "berlin-vtimezone 2026-03-10T09:00:00+01:00 2026-03-10T10:00:00+01:00",
      "utc 2026-03-10T13:00:00+01:00 2026-03-10T14:00:00+01:00",
      // New York is already on EDT (-04:00) while Berlin is still on CET.
      "new-york 2026-03-10T14:00:00+01:00 2026-03-10T15:00:00+01:00",
      "floating 2026-03-10T14:30:00+01:00 2026-03-10T15:00:00+01:00",
      "chicago-series-missing-vtimezone 2026-03-10T15:00:00+01:00 2026-03-10T16:00:00+01:00",
      // IANA TZID without VTIMEZONE in the feed: runtime tz database.
      "london-missing-vtimezone 2026-03-10T18:00:00+01:00 2026-03-10T19:00:00+01:00",
      // Neither IANA nor defined in the feed: interpreted in the configured zone.
      "unknown-tzid 2026-03-10T20:00:00+01:00 2026-03-10T21:00:00+01:00",
    ]);
  });

  it("interprets floating times in the configured zone and formats its offset", () => {
    const result = expandCalendar(timezonesIcs, {
      from: "2026-03-10",
      to: "2026-03-11",
      timeZone: "America/New_York",
    }).occurrences;
    const byName = (name: string) => only(result, name)[0]?.start;
    expect(byName("floating")).toBe("2026-03-10T14:30:00-04:00");
    expect(byName("berlin-vtimezone")).toBe("2026-03-10T04:00:00-04:00");
    expect(byName("new-york")).toBe("2026-03-10T09:00:00-04:00");
    expect(byName("utc")).toBe("2026-03-10T08:00:00-04:00");
  });
});

describe("expandCalendar – TZID without VTIMEZONE in a series", () => {
  it.each([true, false])(
    "matches UTC EXDATE and UTC RECURRENCE-ID by instant (optimize: %s)",
    (optimize) => {
      const result = only(
        expand(timezonesIcs, "2026-03-09", "2026-03-14", { optimize }),
        "chicago-series-missing-vtimezone",
      );
      // 09:00 America/Chicago (CDT, -05:00) = 14:00Z = 15:00 Berlin.
      expect(result.map((o) => [o.summary, o.start, o.recurrenceId])).toEqual([
        [
          "Chicago daily",
          "2026-03-09T15:00:00+01:00",
          "2026-03-09T15:00:00+01:00",
        ],
        [
          "Chicago daily",
          "2026-03-10T15:00:00+01:00",
          "2026-03-10T15:00:00+01:00",
        ],
        // 2026-03-11 removed by EXDATE:20260311T140000Z; the 12th is overridden once.
        [
          "Chicago daily (moved)",
          "2026-03-12T17:00:00+01:00",
          "2026-03-12T15:00:00+01:00",
        ],
        // 2026-03-13 14:00Z is after UNTIL=20260313T100000Z (both paths).
      ]);
    },
  );
});

describe("expandCalendar – RDATE;VALUE=PERIOD", () => {
  it.each([true, false])(
    "uses each period's own end, alone and with an RRULE (optimize: %s)",
    (optimize) => {
      const result = expand(periodsIcs, "2026-03-09", "2026-03-16", {
        optimize,
      });
      expect(spans(result)).toEqual([
        "rrule-with-period 2026-03-09T07:00:00+01:00 2026-03-09T07:30:00+01:00",
        "rrule-with-period 2026-03-10T07:00:00+01:00 2026-03-10T07:30:00+01:00",
        "rdate-period-only 2026-03-10T10:00:00+01:00 2026-03-10T11:00:00+01:00",
        "rrule-with-period 2026-03-10T13:00:00+01:00 2026-03-10T14:00:00+01:00",
        "rrule-with-period 2026-03-11T07:00:00+01:00 2026-03-11T07:30:00+01:00",
        "rrule-with-period 2026-03-12T07:00:00+01:00 2026-03-12T07:30:00+01:00",
        "rdate-period-only 2026-03-13T14:00:00+01:00 2026-03-13T17:00:00+01:00",
        "rdate-period-only 2026-03-14T09:00:00+01:00 2026-03-14T09:30:00+01:00",
      ]);
    },
  );
});

describe("expandCalendar – override scoping", () => {
  const vevent = (lines: string[]): string =>
    ["BEGIN:VEVENT", "DTSTAMP:20260101T000000Z", ...lines, "END:VEVENT"].join(
      "\r\n",
    );
  const feed = (events: string[]): string =>
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//KidBoard//Synthetic Inline//EN",
      ...events,
      "END:VCALENDAR",
      "",
    ].join("\r\n");

  it("never applies an override to another UID with the same start", () => {
    const ics = feed([
      vevent([
        "UID:a@fixtures.kidboard.invalid",
        "DTSTART;TZID=Europe/Berlin:20260309T100000",
        "DURATION:PT1H",
        "RRULE:FREQ=DAILY;COUNT=3",
        "SUMMARY:A",
      ]),
      vevent([
        "UID:b@fixtures.kidboard.invalid",
        "DTSTART;TZID=Europe/Berlin:20260309T100000",
        "DURATION:PT1H",
        "RRULE:FREQ=DAILY;COUNT=3",
        "SUMMARY:B",
      ]),
      vevent([
        "UID:b@fixtures.kidboard.invalid",
        "RECURRENCE-ID;TZID=Europe/Berlin:20260310T100000",
        "DTSTART;TZID=Europe/Berlin:20260310T150000",
        "DURATION:PT1H",
        "SUMMARY:B moved",
      ]),
    ]);
    const result = expand(ics, "2026-03-10", "2026-03-11");
    expect(result.map((o) => [o.summary, o.start])).toEqual([
      ["A", "2026-03-10T10:00:00+01:00"],
      ["B moved", "2026-03-10T15:00:00+01:00"],
    ]);
  });

  it("applies a RANGE=THISANDFUTURE override to later instances", () => {
    const ics = feed([
      vevent([
        "UID:r@fixtures.kidboard.invalid",
        "DTSTART;TZID=Europe/Berlin:20260309T100000",
        "DURATION:PT1H",
        "RRULE:FREQ=DAILY;COUNT=4",
        "SUMMARY:Old time",
      ]),
      vevent([
        "UID:r@fixtures.kidboard.invalid",
        "RECURRENCE-ID;RANGE=THISANDFUTURE;TZID=Europe/Berlin:20260310T100000",
        "DTSTART;TZID=Europe/Berlin:20260310T120000",
        "DURATION:PT30M",
        "SUMMARY:New time",
      ]),
    ]);
    const result = expand(ics, "2026-03-09", "2026-03-13");
    expect(result.map((o) => [o.summary, o.start, o.end])).toEqual([
      ["Old time", "2026-03-09T10:00:00+01:00", "2026-03-09T11:00:00+01:00"],
      ["New time", "2026-03-10T12:00:00+01:00", "2026-03-10T12:30:00+01:00"],
      ["New time", "2026-03-11T12:00:00+01:00", "2026-03-11T12:30:00+01:00"],
      ["New time", "2026-03-12T12:00:00+01:00", "2026-03-12T12:30:00+01:00"],
    ]);
  });
});

/**
 * Canary for the hang guard, which relies on ical.js calling the (undocumented)
 * `RecurIterator#check_contracting_rules` for every candidate. Uses only a satisfiable
 * rule, so it cannot hang. The unsatisfiable-rule tests call it first and refuse to
 * run (throw) if the guard is not effective, instead of hanging the test run.
 */
function assertGuardEffective(): void {
  if (
    typeof ICAL.RecurIterator.prototype.check_contracting_rules !== "function"
  ) {
    throw new Error(
      "ical.js no longer has RecurIterator#check_contracting_rules",
    );
  }
  const rule = ICAL.Recur.fromString("FREQ=DAILY;BYDAY=MO");
  const stats = { checks: 0 };
  const budget = { remaining: 1_000 };
  guardRule(rule, budget, stats);
  // Tuesday start: every next() has to reject Tue…Sun before reaching Monday.
  const iterator = rule.iterator(
    ICAL.Time.fromDateTimeString("2026-03-10T08:00:00"),
  );
  const instances: string[] = [];
  for (let i = 0; i < 4; i++) {
    instances.push(iterator.next().toString());
  }
  if (stats.checks === 0 || budget.remaining >= 1_000) {
    throw new Error("Hang guard is not effective with this ical.js version");
  }
  expect(instances).toEqual([
    "2026-03-10T08:00:00",
    "2026-03-16T08:00:00",
    "2026-03-23T08:00:00",
    "2026-03-30T08:00:00",
  ]);
  expect(stats.checks).toBeGreaterThanOrEqual(18);
}

describe("hang guard canary", () => {
  it("counts candidate checks inside ical.js", () => {
    expect(assertGuardEffective).not.toThrow();
  });
});

describe("expandCalendar – unsatisfiable rules", () => {
  it(
    "skips rules that never match instead of hanging, and keeps the rest",
    { timeout: 5_000 },
    () => {
      assertGuardEffective();
      const result = expandCalendar(unsatisfiableIcs, {
        from: "2026-03-09",
        to: "2026-03-17",
        timeZone: BERLIN,
      });
      expect(spans(result.occurrences)).toEqual([
        "good 2026-03-10T09:00:00+01:00 2026-03-10T10:00:00+01:00",
      ]);
      // Rules ical.js would loop on forever are reported; MONTHLY/YEARLY shapes
      // (Feb 30th, Feb 31st, INTERVAL=12 never reaching BYMONTH) end on their own.
      expect(result.warnings).toEqual(
        [
          "daily-interval-byday",
          "daily-feb-30",
          "daily-ordinal-byday",
          "hourly-interval-byday",
          "range-unsatisfiable",
        ].map((name) => ({ code: "invalid-event", uid: uid(name) })),
      );
      expect(result.truncated).toBe(false);
    },
  );

  it("also stops when the window is far after DTSTART (no fast-forward)", () => {
    assertGuardEffective();
    const result = expandCalendar(unsatisfiableIcs, {
      from: "2030-01-01",
      to: "2030-01-08",
      timeZone: BERLIN,
      optimize: false,
    });
    expect(result.occurrences).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain("invalid-event");
  });
});

describe("expandCalendar – warnings", () => {
  const options = { from: "2026-03-09", to: "2026-03-17", timeZone: BERLIN };

  it("reports a capped series", () => {
    const result = expandCalendar(runawayIcs, options);
    expect(result.truncated).toBe(true);
    expect(result.warnings).toEqual([
      { code: "iteration-cap", uid: uid("minutely") },
    ]);
  });

  it("reports an exhausted feed-wide budget once", () => {
    const result = expandCalendar(recurrenceIcs, {
      ...options,
      maxTotalIterations: 3,
    });
    expect(result.truncated).toBe(true);
    expect(result.warnings).toEqual([{ code: "iteration-budget" }]);
  });

  it("reports skipped events without marking the result truncated", () => {
    const result = expandCalendar(edgeCasesIcs, options);
    expect(result.truncated).toBe(false);
    expect(result.warnings).toEqual([
      { code: "invalid-event", uid: uid("broken-dtend") },
    ]);
  });

  it("has no warnings for a clean feed", () => {
    expect(expandCalendar(recurrenceIcs, options)).toMatchObject({
      warnings: [],
      truncated: false,
    });
  });
});

describe("expandCalendar – window and iteration cap (AC 6)", () => {
  it("returns only occurrences overlapping [from, to)", () => {
    const result = expand(windowIcs, "2026-03-10", "2026-03-12");
    expect(spans(result)).toEqual([
      "allday-before 2026-03-07 2026-03-11",
      "crosses-from 2026-03-09T23:30:00+01:00 2026-03-10T00:30:00+01:00",
    ]);
  });

  it("interprets the window in the configured zone", () => {
    // 2026-03-09 23:30 Berlin is 18:30 in New York, i.e. on 2026-03-09 there.
    const result = expandCalendar(windowIcs, {
      from: "2026-03-09",
      to: "2026-03-10",
      timeZone: "America/New_York",
    }).occurrences.filter((o) => !o.allDay);
    expect(result.map((o) => o.uid)).toEqual([
      uid("ends-at-from"),
      uid("crosses-from"),
    ]);
  });

  it(
    "caps an unbounded FREQ=MINUTELY rule from years ago without hanging",
    { timeout: 5_000 },
    () => {
      expect(DEFAULT_MAX_ITERATIONS).toBe(10_000);
      expect(expand(runawayIcs, "2026-03-10", "2026-03-11")).toEqual([]);
    },
  );

  it("emits occurrences only up to the cap", () => {
    const capped = expand(runawayIcs, "2020-01-01", "2020-01-02", {
      maxIterations: 90,
    });
    expect(capped).toHaveLength(90);
    expect(capped.at(-1)?.start).toBe("2020-01-01T01:29:00+01:00");
  });

  it("stops iterating at the window end below the cap", () => {
    const day = expand(runawayIcs, "2020-01-01", "2020-01-02");
    expect(day).toHaveLength(24 * 60);
    expect(day.at(-1)?.end).toBe("2020-01-02T00:00:00+01:00");
  });

  it("rejects invalid options", () => {
    expect(() => expand(emptyIcs, "2026-03-10", "2026-03-10")).toThrow(
      RangeError,
    );
    expect(() => expand(emptyIcs, "2026-3-10", "2026-03-11")).toThrow(
      RangeError,
    );
    expect(() =>
      expand(emptyIcs, "2026-03-10", "2026-03-11", { timeZone: "Nowhere" }),
    ).toThrow(RangeError);
    expect(() =>
      expand(emptyIcs, "2026-03-10", "2026-03-11", { maxIterations: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      expand(emptyIcs, "2026-03-10", "2026-03-11", { maxTotalIterations: 1.5 }),
    ).toThrow(RangeError);
  });
});

describe("expandCalendar – empty and malformed feeds (AC 7)", () => {
  it("returns [] for an empty VCALENDAR", () => {
    expect(expand(emptyIcs, "2026-03-01", "2026-04-01")).toEqual([]);
    expect(
      expand(
        "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
        "2026-03-01",
        "2026-04-01",
      ),
    ).toEqual([]);
  });

  const secret = "TESTONLY-not-a-secret-marker";
  const cases: [string, string, string][] = [
    ["empty string", "", "empty"],
    ["whitespace only", " \r\n\t ", "empty"],
    [
      "HTML error page",
      `<!DOCTYPE html><html><body><h1>404</h1><p>https://calendar.example.invalid/${secret}/basic.ics</p></body></html>`,
      "not-ics",
    ],
    ["JSON", `{"error":"${secret}"}`, "not-ics"],
    ["truncated file", truncatedIcs, "malformed"],
    [
      "garbage inside VCALENDAR",
      `BEGIN:VCALENDAR\r\n${secret} not a content line\r\nEND:VCALENDAR\r\n`,
      "malformed",
    ],
    [
      "wrong root component",
      "BEGIN:VCALENDAR-ISH\r\nEND:VCALENDAR-ISH\r\n",
      "not-ics",
    ],
  ];

  it.each(cases)("throws FeedParseError for %s", (_label, input, reason) => {
    let caught: unknown;
    try {
      expand(input, "2026-03-01", "2026-04-01");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FeedParseError);
    const error = caught as FeedParseError;
    expect(error.name).toBe("FeedParseError");
    expect(error.reason).toBe(reason);
    expect(error.cause).toBeUndefined();
    for (const text of [error.message, String(error), error.stack ?? ""]) {
      expect(text).not.toContain(secret);
      expect(text).not.toContain("html");
      expect(text).not.toContain("DTSTART");
      expect(text).not.toContain("fixtures.kidboard.invalid");
    }
  });
});

describe("expandCalendar – edge cases", () => {
  const result = expand(edgeCasesIcs, "2026-03-09", "2026-03-17");

  it("handles all-day series, SEQUENCE, orphan overrides, RDATE-only and broken events", () => {
    expect(
      result.map((o) => [o.summary, o.start, o.end, o.recurrenceId]),
    ).toEqual([
      ["Gym bag", "2026-03-09", "2026-03-10", "2026-03-09"],
      [
        "Lunch",
        "2026-03-09T12:00:00+01:00",
        "2026-03-09T13:00:00+01:00",
        "2026-03-09T12:00:00+01:00",
      ],
      // Two overrides of the same instance: the higher SEQUENCE wins.
      [
        "Lunch (newer)",
        "2026-03-10T13:00:00+01:00",
        "2026-03-10T14:00:00+01:00",
        "2026-03-10T12:00:00+01:00",
      ],
      // Override without its master in the feed is still shown.
      [
        "Shared single instance",
        "2026-03-11T11:00:00+01:00",
        "2026-03-11T12:00:00+01:00",
        "2026-03-11T10:00:00+01:00",
      ],
      // RDATE-only event whose DTSTART is excluded by EXDATE (and not duplicated).
      [
        "Only on Thursday",
        "2026-03-12T08:00:00+01:00",
        "2026-03-12T09:00:00+01:00",
        "2026-03-12T08:00:00+01:00",
      ],
      // EXDATE on 2026-03-11 removed the Wednesday.
      ["Gym bag", "2026-03-16", "2026-03-17", "2026-03-16"],
    ]);
  });

  it("skips a single unusable event without failing the feed", () => {
    expect(result.map((o) => o.summary)).not.toContain("Broken");
  });

  it("includes DTSTART of an RDATE-only event exactly once", () => {
    const rdate = only(
      expand(recurrenceIcs, "2026-03-11", "2026-03-12"),
      "rdate",
    );
    expect(rdate.map((o) => o.start)).toEqual(["2026-03-11T18:00:00+01:00"]);
  });
});

describe("expandCalendar – runtime and determinism (AC 8)", () => {
  it("runs inside workerd", () => {
    // `navigator.userAgent` is "Cloudflare-Workers" in workerd.
    expect(navigator.userAgent).toBe("Cloudflare-Workers");
  });

  it("is deterministic and independent of VEVENT order", () => {
    const first = expand(overridesIcs, "2026-03-01", "2026-04-15");
    const second = expand(overridesIcs, "2026-03-01", "2026-04-15");
    expect(second).toEqual(first);

    const [head = "", ...rest] = overridesIcs.split("BEGIN:VEVENT");
    const lastEnd = rest.at(-1)?.replace(/END:VCALENDAR\r\n$/, "") ?? "";
    const events = [...rest.slice(0, -1), lastEnd].map(
      (e) => `BEGIN:VEVENT${e}`,
    );
    const reversed = `${head}${events.reverse().join("")}END:VCALENDAR\r\n`;
    expect(expand(reversed, "2026-03-01", "2026-04-15")).toEqual(first);
  });
});
