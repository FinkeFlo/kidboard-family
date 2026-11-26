import { describe, expect, it } from "vitest";

import { expandCalendar, type ExpandOptions } from "./expandCalendar";

/**
 * Differential tests: the optimized expansion (fast-forwarded DTSTART, floating
 * wall-time iteration) must produce exactly what the plain full iteration from
 * DTSTART produces, for a generated set of rules, zones, EXDATEs and overrides.
 */

const BERLIN_VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Berlin",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

function calendar(events: string[][]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//KidBoard//Synthetic Equivalence//EN",
    "X-WR-TIMEZONE:Europe/Berlin",
    ...BERLIN_VTIMEZONE,
  ];
  for (const event of events) {
    lines.push("BEGIN:VEVENT", "DTSTAMP:20260101T000000Z", ...event);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

/** Rules that can be fast-forwarded. */
const FAST_RULES = [
  "FREQ=DAILY",
  "FREQ=DAILY;INTERVAL=3",
  "FREQ=DAILY;BYDAY=MO,WE,FR",
  "FREQ=DAILY;BYMONTH=3,4,10",
  "FREQ=DAILY;BYMONTHDAY=1,15,28",
  "FREQ=WEEKLY",
  "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH",
  "FREQ=WEEKLY;INTERVAL=3;BYDAY=SU,MO;WKST=SU",
  "FREQ=WEEKLY;INTERVAL=2;WKST=MO",
  "FREQ=WEEKLY;BYDAY=SA,SU;BYMONTH=4,10",
  "FREQ=MONTHLY",
  "FREQ=MONTHLY;INTERVAL=2",
  "FREQ=MONTHLY;BYDAY=2TU",
  "FREQ=MONTHLY;BYDAY=-1FR",
  "FREQ=MONTHLY;INTERVAL=5;BYDAY=1MO,3MO",
  "FREQ=MONTHLY;BYMONTHDAY=1,15",
  "FREQ=MONTHLY;BYMONTHDAY=-1",
  "FREQ=MONTHLY;BYDAY=MO,TU;BYMONTH=3,10",
  "FREQ=YEARLY",
  "FREQ=YEARLY;INTERVAL=2",
  "FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "FREQ=YEARLY;BYMONTH=4,10;BYMONTHDAY=1",
  "FREQ=YEARLY;INTERVAL=3;BYMONTH=10;BYDAY=4SU",
];

/** Rules that must fall back to full iteration. */
const SLOW_RULES = [
  "FREQ=DAILY;COUNT=2500",
  "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1",
  "FREQ=YEARLY;BYWEEKNO=14",
  "FREQ=YEARLY;BYYEARDAY=90,300",
  "FREQ=DAILY;BYHOUR=8,17",
  "FREQ=HOURLY;INTERVAL=37",
];

/** DTSTART variants (wall clock); includes a DST-gap and a DST-overlap start. */
const STARTS = [
  "20210317T080000",
  "20210328T023000",
  "20231029T023000",
  "20220131T070000",
  "20240229T120000",
  "20251231T235000",
];

type ZoneVariant =
  "berlin" | "utc" | "floating" | "chicago-unresolved" | "date";

const ZONES: ZoneVariant[] = [
  "berlin",
  "utc",
  "floating",
  "chicago-unresolved",
  "date",
];

function dtstartLine(zone: ZoneVariant, wall: string): string {
  switch (zone) {
    case "berlin":
      return `DTSTART;TZID=Europe/Berlin:${wall}`;
    case "utc":
      return `DTSTART:${wall}Z`;
    case "floating":
      return `DTSTART:${wall}`;
    case "chicago-unresolved":
      return `DTSTART;TZID=America/Chicago:${wall}`;
    case "date":
      return `DTSTART;VALUE=DATE:${wall.slice(0, 8)}`;
  }
}

/** `untilDay` (`YYYYMMDD`, inside the window) adds an UNTIL at the end of that day. */
function baseEvents(rules: string[], untilDay: string | null): string[][] {
  const events: string[][] = [];
  let n = 0;
  for (const rule of rules) {
    for (const zone of ZONES) {
      for (const wall of STARTS) {
        n++;
        const until =
          untilDay === null
            ? ""
            : zone === "date"
              ? `;UNTIL=${untilDay}`
              : `;UNTIL=${untilDay}T235959Z`;
        events.push([
          `UID:eq-${String(n)}@fixtures.kidboard.invalid`,
          dtstartLine(zone, wall),
          zone === "date" ? "DURATION:P1D" : "DURATION:PT1H30M",
          `RRULE:${rule}${until}`,
          `SUMMARY:${rule} ${zone} ${wall}`,
        ]);
      }
    }
  }
  return events;
}

/** [from, to, UNTIL day inside the window after the DST change]. */
const WINDOWS: [string, string, string][] = [
  ["2026-03-23", "2026-04-13", "20260407"], // spring-forward
  ["2026-10-19", "2026-11-02", "20261028"], // fall-back
];

const REFERENCE: Partial<ExpandOptions> = {
  optimize: false,
  maxIterations: 1_000_000,
  maxTotalIterations: 100_000_000,
};

/**
 * Adds, for every series with instances in the window, a UTC EXDATE for the first one
 * and a UTC RECURRENCE-ID override (moved by one hour) for the second one, based on
 * the reference expansion.
 */
function withExceptions(events: string[][], from: string, to: string): string {
  const reference = expandCalendar(calendar(events), {
    from,
    to,
    timeZone: "Europe/Berlin",
    ...REFERENCE,
  }).occurrences;
  const byUid = new Map<string, string[]>();
  for (const occurrence of reference) {
    if (occurrence.recurrenceId === null) {
      continue;
    }
    const list = byUid.get(occurrence.uid) ?? [];
    list.push(occurrence.recurrenceId);
    byUid.set(occurrence.uid, list);
  }
  const utc = (id: string): string =>
    id.length === 10
      ? id.replaceAll("-", "")
      : new Date(id).toISOString().replace(/[-:]|\.\d{3}/g, "");
  const augmented: string[][] = [];
  for (const event of events) {
    const uidLine = event[0] ?? "";
    const uid = uidLine.slice("UID:".length);
    const ids = byUid.get(uid) ?? [];
    const [first, second] = ids;
    const extra: string[] = [];
    if (first !== undefined) {
      extra.push(
        first.length === 10
          ? `EXDATE;VALUE=DATE:${utc(first)}`
          : `EXDATE:${utc(first)}`,
      );
    }
    augmented.push([...event, ...extra]);
    if (second !== undefined) {
      if (second.length === 10) {
        augmented.push([
          uidLine,
          `RECURRENCE-ID;VALUE=DATE:${utc(second)}`,
          `DTSTART;VALUE=DATE:${utc(second)}`,
          "SUMMARY:moved",
        ]);
      } else {
        const moved = new Date(Date.parse(second) + 3_600_000);
        augmented.push([
          uidLine,
          `RECURRENCE-ID:${utc(second)}`,
          `DTSTART:${utc(moved.toISOString())}`,
          "DURATION:PT45M",
          "SUMMARY:moved",
        ]);
      }
    }
  }
  return calendar(augmented);
}

describe("optimized expansion equals full iteration", () => {
  for (const [from, to, untilDay] of WINDOWS) {
    for (const withUntil of [false, true]) {
      it(
        `fast-forwardable rules, ${from}..${to}, UNTIL: ${String(withUntil)}`,
        { timeout: 60_000 },
        () => {
          const ics = withExceptions(
            baseEvents(FAST_RULES, withUntil ? untilDay : null),
            from,
            to,
          );
          const options = { from, to, timeZone: "Europe/Berlin" };
          const reference = expandCalendar(ics, { ...options, ...REFERENCE });
          // A low per-series cap proves that fast-forwarding happened: a daily series
          // from 2021 would need ~1 900 iterations without it.
          const optimized = expandCalendar(ics, {
            ...options,
            maxIterations: 400,
            maxTotalIterations: 10_000_000,
          });
          expect(reference.occurrences.length).toBeGreaterThan(250);
          expect(reference.occurrences.some((o) => o.summary === "moved")).toBe(
            true,
          );
          expect(optimized.warnings).toEqual([]);
          expect(optimized.occurrences).toEqual(reference.occurrences);
        },
      );
    }
  }

  it("rules that fall back to full iteration", { timeout: 60_000 }, () => {
    const [from, to] = WINDOWS[0] ?? ["", "", ""];
    const ics = withExceptions(baseEvents(SLOW_RULES, null), from, to);
    const options = { from, to, timeZone: "Europe/Berlin" };
    const reference = expandCalendar(ics, { ...options, ...REFERENCE });
    const optimized = expandCalendar(ics, {
      ...options,
      maxIterations: 1_000_000,
      maxTotalIterations: 100_000_000,
    });
    expect(reference.occurrences.length).toBeGreaterThan(100);
    expect(optimized.occurrences).toEqual(reference.occurrences);
  });
});

describe("performance on a realistic feed", () => {
  /** ~300 events: 250 single events over two years, 50 weekly/daily series up to 5 y old. */
  function realisticFeed(): string {
    const events: string[][] = [];
    const pad = (value: number): string => String(value).padStart(2, "0");
    for (let i = 0; i < 250; i++) {
      const month = 1 + (i % 12);
      const day = 1 + ((i * 7) % 28);
      const year = 2025 + (i % 2);
      const hour = 7 + (i % 12);
      const date = `${String(year)}${pad(month)}${pad(day)}`;
      events.push([
        `UID:single-${String(i)}@fixtures.kidboard.invalid`,
        `DTSTART;TZID=Europe/Berlin:${date}T${pad(hour)}0000`,
        `DTEND;TZID=Europe/Berlin:${date}T${pad(hour + 1)}0000`,
        `SUMMARY:Single ${String(i)}`,
      ]);
    }
    const byDays = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
    for (let i = 0; i < 50; i++) {
      const year = 2021 + (i % 5);
      const start = `${String(year)}${pad(1 + (i % 12))}${pad(1 + (i % 28))}`;
      const rule =
        i % 3 === 0
          ? "FREQ=DAILY"
          : `FREQ=WEEKLY;BYDAY=${byDays[i % 7] ?? "MO"}`;
      const uid = `series-${String(i)}@fixtures.kidboard.invalid`;
      events.push([
        `UID:${uid}`,
        `DTSTART;TZID=Europe/Berlin:${start}T${pad(8 + (i % 9))}0000`,
        `DTEND;TZID=Europe/Berlin:${start}T${pad(9 + (i % 9))}0000`,
        `RRULE:${rule}`,
        `EXDATE;TZID=Europe/Berlin:${start}T${pad(8 + (i % 9))}0000`,
        `SUMMARY:Series ${String(i)}`,
      ]);
    }
    return calendar(events);
  }

  it("expands well under the CPU budget", () => {
    const ics = realisticFeed();
    const options = {
      from: "2026-03-23",
      to: "2026-03-31",
      timeZone: "Europe/Berlin",
    };
    const measure = (opts: Partial<ExpandOptions>): number => {
      // Best of three, to keep scheduler noise out of the assertion.
      let best = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 3; run++) {
        const started = performance.now();
        expandCalendar(ics, { ...options, ...opts });
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    const optimized = measure({});
    const full = measure(REFERENCE);
    // The API's cached window (`[today - 1, today + 32)`, 33 days; see app.ts).
    const apiWindow = { from: "2026-03-22", to: "2026-04-24" };
    const optimizedApi = measure(apiWindow);
    const fullApi = measure({ ...REFERENCE, ...apiWindow });
    // Recorded in ADR-0003. Generous bound: CI machines are slower than workstations.
    console.info(
      `expandCalendar realistic feed: 8 days optimized ${optimized.toFixed(1)} ms, full ${full.toFixed(1)} ms; 33 days optimized ${optimizedApi.toFixed(1)} ms, full ${fullApi.toFixed(1)} ms`,
    );
    expect(optimized).toBeLessThan(full / 3);
    expect(optimized).toBeLessThan(250);
    expect(optimizedApi).toBeLessThan(fullApi / 3);
    expect(optimizedApi).toBeLessThan(250);
  });
});
