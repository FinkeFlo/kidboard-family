import {
  type AppConfig,
  AppConfigSchema,
  type EditorEntryInput,
  type EditorEntryInputRaw,
  EditorEntryInputSchema,
} from "@kidboard/shared";
import ICAL from "ical.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppEntry } from "./entryStore";
import { APP_CALENDAR_PRODID, renderAppCalendar } from "./renderCalendar";

const CONFIG: AppConfig = AppConfigSchema.parse({
  locale: "de",
  timeZone: "Europe/Berlin",
  children: [
    { id: "mia", name: "Mia", color: "#E4572E", avatar: "🦊" },
    { id: "ben", name: "Ben", color: "#2E86AB", avatar: "🐻" },
  ],
  calendars: [{ id: "kinder", kind: "events" }],
});

const ID = "0b9f5a52-3c1e-4c4b-9d55-7d1f1f0c2a11";

function input(raw: EditorEntryInputRaw): EditorEntryInput {
  return EditorEntryInputSchema.parse(raw);
}

function entry(
  data: EditorEntryInputRaw,
  extra: Partial<Pick<AppEntry, "exdates" | "overrides" | "id">> = {},
): AppEntry {
  const parsed = input(data);
  return {
    id: extra.id ?? ID,
    revision: 1,
    kind: parsed.kind,
    data: parsed,
    exdates: extra.exdates ?? [],
    overrides: extra.overrides ?? {},
    createdAt: "2026-03-01T08:00:00.000Z",
    updatedAt: "2026-03-02T08:00:00.000Z",
  };
}

const SWIM: EditorEntryInputRaw = {
  kind: "event",
  childIds: ["mia"],
  icon: "🏊",
  title: "Schwimmen",
  allDay: false,
  date: "2026-03-09",
  startTime: "16:00",
  endTime: "17:00",
  repeat: { weekly: { weekdays: [1], interval: 2, until: "2026-04-20" } },
  bring: ["🩱", "🧴"],
};

/** The unfolded content lines of the rendered calendar. */
function lines(ics: string): string[] {
  return ics.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function events(ics: string): ICAL.Component[] {
  return ICAL.Component.fromString(ics).getAllSubcomponents("vevent");
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

describe("renderAppCalendar", () => {
  it("writes an empty but valid calendar without entries", () => {
    const ics = renderAppCalendar([], "event", CONFIG);
    expect(lines(ics)).toEqual([
      "BEGIN:VCALENDAR",
      `PRODID:${APP_CALENDAR_PRODID}`,
      "VERSION:2.0",
      "END:VCALENDAR",
    ]);
  });

  it("writes a series with TZID wall times, the rule, title and bring line", () => {
    const ics = renderAppCalendar([entry(SWIM)], "event", CONFIG);
    expect(lines(ics)).toEqual([
      "BEGIN:VCALENDAR",
      `PRODID:${APP_CALENDAR_PRODID}`,
      "VERSION:2.0",
      "BEGIN:VEVENT",
      `UID:${ID}`,
      "DTSTAMP:20260302T080000Z",
      "SUMMARY:Mia: 🏊 Schwimmen",
      "DESCRIPTION:Mitbringen: 🩱 🧴",
      "DTSTART;TZID=Europe/Berlin:20260309T160000",
      "DTEND;TZID=Europe/Berlin:20260309T170000",
      // ical.js orders the rule parts; UNTIL: last second of 2026-04-20 in Berlin (CEST), UTC.
      "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;UNTIL=20260420T215959Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ]);
  });

  it("writes EXDATEs and RECURRENCE-ID overrides in the master's value type", () => {
    const moved = input({
      ...SWIM,
      date: "2026-03-24",
      startTime: "17:00",
      endTime: "18:00",
      repeat: "none",
      bring: [],
    });
    const ics = renderAppCalendar(
      [
        entry(SWIM, {
          exdates: ["2026-04-06"],
          overrides: { "2026-03-23": moved },
        }),
      ],
      "event",
      CONFIG,
    );
    const [master, override] = events(ics);
    const exdate = master?.getFirstProperty("exdate");
    expect(exdate?.getParameter("tzid")).toBe("Europe/Berlin");
    expect(exdate?.getFirstValue()?.toString()).toBe("2026-04-06T16:00:00");
    expect(override?.getFirstPropertyValue("uid")).toBe(ID);
    const recurrenceId = override?.getFirstProperty("recurrence-id");
    expect(recurrenceId?.getParameter("tzid")).toBe("Europe/Berlin");
    expect(recurrenceId?.getFirstValue()?.toString()).toBe(
      "2026-03-23T16:00:00",
    );
    expect(override?.getFirstPropertyValue("dtstart")?.toString()).toBe(
      "2026-03-24T17:00:00",
    );
    expect(override?.hasProperty("rrule")).toBe(false);
    expect(override?.hasProperty("description")).toBe(false);
  });

  it("writes all-day series with DATE values throughout", () => {
    const ics = renderAppCalendar(
      [
        entry(
          {
            kind: "event",
            icon: "🏫",
            title: "Kita",
            allDay: true,
            date: "2026-03-09",
            endDate: "2026-03-11",
            repeat: { weekly: { weekdays: [1], until: "2026-03-30" } },
          },
          {
            exdates: ["2026-03-16"],
            overrides: {
              "2026-03-23": input({
                kind: "event",
                icon: "🏫",
                title: "Kita kurz",
                allDay: true,
                date: "2026-03-23",
              }),
            },
          },
        ),
      ],
      "event",
      CONFIG,
    );
    const text = lines(ics);
    expect(text).toContain("DTSTART;VALUE=DATE:20260309");
    expect(text).toContain("DTEND;VALUE=DATE:20260311");
    expect(text).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260330");
    expect(text).toContain("EXDATE;VALUE=DATE:20260316");
    expect(text).toContain("RECURRENCE-ID;VALUE=DATE:20260323");
    expect(text).toContain("DTEND;VALUE=DATE:20260324");
  });

  it("escapes HTML-looking and iCalendar-special title text as plain TEXT", () => {
    const title = "<b>Fest</b>; a, b \\ <script>x</script>";
    const ics = renderAppCalendar(
      [
        entry({
          kind: "event",
          icon: "🎉",
          title,
          allDay: true,
          date: "2026-03-10",
          countdown: true,
        }),
      ],
      "event",
      CONFIG,
    );
    expect(lines(ics)).toContain(
      "SUMMARY:🎉 <b>Fest</b>\\; a\\, b \\\\ <script>x</script>",
    );
    expect(events(ics)[0]?.getFirstPropertyValue("summary")).toBe(
      `🎉 ${title}`,
    );
    expect(events(ics)[0]?.getFirstPropertyValue("description")).toBe(
      "#countdown",
    );
  });

  it("defaults the end to one wall-clock hour, also across the DST change", () => {
    const ics = renderAppCalendar(
      [
        entry({
          kind: "event",
          icon: "🎻",
          title: "Probe",
          allDay: false,
          date: "2026-03-29",
          startTime: "01:30",
        }),
        entry(
          {
            kind: "event",
            icon: "🌙",
            title: "Nachtwanderung",
            allDay: false,
            date: "2026-03-29",
            startTime: "02:30",
          },
          { id: "1c9f5a52-3c1e-4c4b-9d55-7d1f1f0c2a12" },
        ),
      ],
      "event",
      CONFIG,
    );
    const [probe, night] = events(ics);
    // 01:30 + 1 h on the wall clock is 02:30, which the expansion moves to 03:30 CEST.
    expect(probe?.getFirstPropertyValue("dtend")?.toString()).toBe(
      "2026-03-29T02:30:00",
    );
    // A start in the gap (02:30 → 03:30 CEST) ends 60 real minutes later: 04:30.
    expect(night?.getFirstPropertyValue("dtend")?.toString()).toBe(
      "2026-03-29T04:30:00",
    );
  });

  it("renders only entries of the requested kind; meals get no description", () => {
    const meal = entry(
      {
        kind: "meal",
        icon: "🍝",
        title: "Spaghetti",
        allDay: true,
        date: "2026-03-10",
        slot: "lunch",
      },
      { id: "2c9f5a52-3c1e-4c4b-9d55-7d1f1f0c2a13" },
    );
    const both = [entry(SWIM), meal];
    expect(events(renderAppCalendar(both, "event", CONFIG))).toHaveLength(1);
    const meals = events(renderAppCalendar(both, "meal", CONFIG));
    expect(meals).toHaveLength(1);
    expect(meals[0]?.getFirstPropertyValue("summary")).toBe(
      "Mittag: 🍝 Spaghetti",
    );
    expect(meals[0]?.hasProperty("description")).toBe(false);
    expect(
      lines(renderAppCalendar(both, "meal", { ...CONFIG, locale: "en" })),
    ).toContain("SUMMARY:Lunch: 🍝 Spaghetti");
  });

  it("skips entries and hides overrides that the config cannot express any more", () => {
    const withoutBen: AppConfig = {
      ...CONFIG,
      children: CONFIG.children.filter((child) => child.id !== "ben"),
    };
    const benOnly = entry(
      { ...SWIM, childIds: ["ben"], repeat: "none" },
      { id: "3c9f5a52-3c1e-4c4b-9d55-7d1f1f0c2a14" },
    );
    const series = entry(SWIM, {
      overrides: {
        "2026-03-23": input({ ...SWIM, childIds: ["ben"], repeat: "none" }),
      },
    });
    const found = events(
      renderAppCalendar([benOnly, series], "event", withoutBen),
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.getFirstPropertyValue("uid")).toBe(ID);
    expect(found[0]?.getFirstPropertyValue("exdate")?.toString()).toBe(
      "2026-03-23T16:00:00",
    );
    expect(warnings).toEqual([
      `[kidboard] skipped app entry 3c9f5a52-3c1e-4c4b-9d55-7d1f1f0c2a14: unknown_child (config changed?)`,
      `[kidboard] hid one day of app entry ${ID}: unknown_child (config changed?)`,
    ]);
    expect(warnings.join("\n")).not.toContain("Schwimmen");
  });
});
