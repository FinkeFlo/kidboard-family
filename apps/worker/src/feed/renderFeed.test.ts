import {
  APP_NAME,
  type AppConfig,
  AppConfigSchema,
  type EditorEntryInputRaw,
  EditorEntryInputSchema,
} from "@kidboard/shared";
import ICAL from "ical.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppEntry } from "../entries/entryStore";
import { renderAppCalendar } from "../entries/renderCalendar";
import { expandCalendar, type Occurrence } from "../ical/expandCalendar";
import {
  FEED_PRODID,
  FEED_REFRESH_INTERVAL,
  renderAppFeed,
  vtimezoneFor,
} from "./renderFeed";

function config(timeZone: string): AppConfig {
  return AppConfigSchema.parse({
    locale: "de",
    timeZone,
    children: [
      { id: "mia", name: "Mia", color: "#E4572E", avatar: "🦊" },
      { id: "ben", name: "Ben", color: "#2E86AB", avatar: "🐻" },
    ],
    calendars: [{ id: "kinder", kind: "events" }],
  });
}

const BERLIN = config("Europe/Berlin");

let idCounter = 0;

function entry(
  data: EditorEntryInputRaw,
  extra: Partial<Pick<AppEntry, "exdates" | "overrides">> = {},
): AppEntry {
  const parsed = EditorEntryInputSchema.parse(data);
  idCounter += 1;
  return {
    id: `0b9f5a52-3c1e-4c4b-9d55-${String(idCounter).padStart(12, "0")}`,
    revision: 1,
    kind: parsed.kind,
    data: parsed,
    exdates: extra.exdates ?? [],
    overrides: extra.overrides ?? {},
    createdAt: "2026-03-01T08:00:00.000Z",
    updatedAt: "2026-03-02T08:00:00.000Z",
  };
}

/**
 * Weekly on Monday 16:00 across the spring-forward (2026-03-29) and fall-back
 * (2026-10-25) switches in Berlin, with a removed day and a moved day.
 */
const SWIM = entry(
  {
    kind: "event",
    childIds: ["mia"],
    icon: "🏊",
    title: "Schwimmen",
    allDay: false,
    date: "2026-03-09",
    startTime: "16:00",
    endTime: "17:00",
    repeat: { weekly: { weekdays: [1], until: "2026-11-30" } },
    bring: ["🩱"],
  },
  {
    exdates: ["2026-04-06"],
    overrides: {
      "2026-03-30": EditorEntryInputSchema.parse({
        kind: "event",
        childIds: ["mia"],
        icon: "🏊",
        title: "Schwimmen",
        allDay: false,
        date: "2026-03-31",
        startTime: "17:30",
        endTime: "18:30",
      }),
    },
  },
);

const TRIP = entry({
  kind: "event",
  icon: "🎉",
  title: "<b>Fest</b>; a, b",
  allDay: true,
  date: "2026-03-12",
  endDate: "2026-03-14",
  countdown: true,
});

const PIZZA = entry({
  kind: "meal",
  icon: "🍕",
  title: "Pizza",
  allDay: true,
  date: "2026-03-10",
  slot: "dinner",
  repeat: { weekly: { weekdays: [2, 5] } },
});

const BREAKFAST = entry({
  kind: "meal",
  icon: "🥣",
  title: "Müsli",
  allDay: false,
  date: "2026-03-11",
  startTime: "07:15",
  slot: "breakfast",
});

const ENTRIES = [SWIM, TRIP, PIZZA, BREAKFAST];

/** Board window of a whole DST year. */
const WINDOW = { from: "2026-03-01", to: "2026-12-31" };

function lines(ics: string): string[] {
  return ics.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function sorted(occurrences: Occurrence[]): Occurrence[] {
  return [...occurrences].sort(
    (a, b) =>
      a.start.localeCompare(b.start) ||
      a.uid.localeCompare(b.uid) ||
      a.summary.localeCompare(b.summary),
  );
}

/** What the board expands: both virtual sources, as `loadAppSources` renders them. */
function boardOccurrences(entries: AppEntry[], cfg: AppConfig): Occurrence[] {
  return sorted(
    (["event", "meal"] as const).flatMap(
      (kind) =>
        expandCalendar(renderAppCalendar(entries, kind, cfg), {
          ...WINDOW,
          timeZone: cfg.timeZone,
        }).occurrences,
    ),
  );
}

let warnings: string[];

beforeEach(() => {
  warnings = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderAppFeed", () => {
  it("writes the calendar headers and one VTIMEZONE for the configured zone", () => {
    const ics = renderAppFeed([], BERLIN);
    const text = lines(ics);
    expect(text.slice(0, 9)).toEqual([
      "BEGIN:VCALENDAR",
      `PRODID:${FEED_PRODID}`,
      "VERSION:2.0",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${APP_NAME}`,
      "X-WR-TIMEZONE:Europe/Berlin",
      `REFRESH-INTERVAL;VALUE=DURATION:${FEED_REFRESH_INTERVAL}`,
      `X-PUBLISHED-TTL:${FEED_REFRESH_INTERVAL}`,
    ]);
    const calendar = ICAL.Component.fromString(ics);
    const zones = calendar.getAllSubcomponents("vtimezone");
    expect(zones).toHaveLength(1);
    expect(zones[0]?.getFirstPropertyValue("tzid")).toBe("Europe/Berlin");
    expect(calendar.getAllSubcomponents("vevent")).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("publishes events and meals of all entries in one calendar, VTIMEZONE first", () => {
    const calendar = ICAL.Component.fromString(renderAppFeed(ENTRIES, BERLIN));
    const names = calendar.getAllSubcomponents().map((c) => c.name);
    expect(names[0]).toBe("vtimezone");
    const summaries = calendar
      .getAllSubcomponents("vevent")
      .map((c) => String(c.getFirstPropertyValue("summary")));
    expect(summaries).toEqual([
      "Mia: 🏊 Schwimmen",
      "Mia: 🏊 Schwimmen",
      "🎉 <b>Fest</b>; a, b",
      expect.stringContaining("🍕 Pizza"),
      expect.stringContaining("🥣 Müsli"),
    ]);
    // Titles stay plain TEXT (escaped by ical.js), never markup.
    expect(lines(renderAppFeed([TRIP], BERLIN))).toContain(
      "SUMMARY:🎉 <b>Fest</b>\\; a\\, b",
    );
  });

  it("expands to exactly the board's occurrences (runtime tz database)", () => {
    const feed = expandCalendar(renderAppFeed(ENTRIES, BERLIN), {
      ...WINDOW,
      timeZone: BERLIN.timeZone,
    });
    expect(feed.warnings).toEqual([]);
    expect(feed.truncated).toBe(false);
    const board = boardOccurrences(ENTRIES, BERLIN);
    expect(board.length).toBeGreaterThan(100);
    expect(sorted(feed.occurrences)).toEqual(board);
    // Spot checks around both DST switches, the exception and the override.
    const swim = board.filter((o) => o.summary === "Mia: 🏊 Schwimmen");
    const starts = swim.map((o) => o.start);
    expect(starts).toContain("2026-03-23T16:00:00+01:00");
    expect(starts).toContain("2026-03-31T17:30:00+02:00");
    expect(starts).not.toContain("2026-03-30T16:00:00+02:00");
    expect(starts).not.toContain("2026-04-06T16:00:00+02:00");
    expect(starts).toContain("2026-10-19T16:00:00+02:00");
    expect(starts).toContain("2026-10-26T16:00:00+01:00");
  });

  it.each(["Europe/Berlin", "America/New_York", "Australia/Sydney"])(
    "the feed's own VTIMEZONE yields the board's instants (%s, as a client without tz database sees it)",
    (timeZone) => {
      const cfg = config(timeZone);
      const calendar = ICAL.Component.fromString(renderAppFeed([SWIM], cfg));
      const vtimezone = calendar.getFirstSubcomponent("vtimezone");
      expect(vtimezone).not.toBeNull();
      const zone = new ICAL.Timezone(vtimezone);
      const fromVtimezone: number[] = [];
      const until = ICAL.Time.fromDateString("2026-12-31");
      const vevents = calendar.getAllSubcomponents("vevent");
      // Days replaced by a RECURRENCE-ID override (checked separately below).
      const replaced = new Set(
        vevents.map((c) => String(c.getFirstPropertyValue("recurrence-id"))),
      );
      for (const component of vevents) {
        if (component.hasProperty("recurrence-id")) {
          continue;
        }
        const event = new ICAL.Event(component);
        const exdates = new Set(
          component
            .getAllProperties("exdate")
            .map((p) => String(p.getFirstValue())),
        );
        const iterator = event.iterator();
        // ical.js types `next()` as `Time`, but it returns `undefined` once a
        // finite rule (UNTIL) is exhausted.
        const step = (): ICAL.Time | undefined => iterator.next();
        for (
          let next = step();
          next !== undefined && next.compare(until) < 0;
          next = step()
        ) {
          if (exdates.has(next.toString()) || replaced.has(next.toString())) {
            continue;
          }
          // Resolve the wall time through the feed's VTIMEZONE only.
          const wall = next.clone();
          wall.zone = zone;
          fromVtimezone.push(wall.toUnixTime());
        }
      }
      const board = expandCalendar(renderAppCalendar([SWIM], "event", cfg), {
        ...WINDOW,
        timeZone,
      })
        .occurrences.filter((o) => o.start.slice(11, 16) === "16:00")
        .map((o) => Date.parse(o.start) / 1000);
      expect(fromVtimezone.length).toBeGreaterThan(30);
      expect([...fromVtimezone].sort()).toEqual([...board].sort());
    },
  );
});

describe("vtimezoneFor", () => {
  it("returns a parsed VTIMEZONE with STANDARD/DAYLIGHT rules named like the config zone", () => {
    const zone = vtimezoneFor("America/New_York");
    expect(zone?.name).toBe("vtimezone");
    expect(zone?.getFirstPropertyValue("tzid")).toBe("America/New_York");
    const kinds = zone?.getAllSubcomponents().map((c) => c.name);
    expect(kinds).toEqual(expect.arrayContaining(["standard", "daylight"]));
  });

  it("keeps the configured name for zones without DST", () => {
    const zone = vtimezoneFor("Asia/Tokyo");
    expect(zone?.getFirstPropertyValue("tzid")).toBe("Asia/Tokyo");
    expect(zone?.getAllSubcomponents().length).toBeGreaterThan(0);
  });

  it("returns null for a zone the library does not know", () => {
    expect(vtimezoneFor("Nowhere/Atlantis")).toBeNull();
  });
});
