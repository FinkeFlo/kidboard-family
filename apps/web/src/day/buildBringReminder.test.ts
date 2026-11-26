import type { CalendarEvent, PublicConfig } from "@kidboard/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BEN, eventFixture, MIA } from "../components/fixtures.test-utils";
import { configFixture } from "../data/testing.test-utils";
import {
  BRING_BAG,
  type BringReminder,
  buildBringReminder,
} from "./buildBringReminder";

/** Bands: morning 06:00, midday 11:00, evening 17:00 (the schema defaults). */
const CONFIG: PublicConfig = configFixture({ children: [MIA, BEN] });

const at = (iso: string): number => Date.parse(iso);

function timed(
  id: string,
  start: string,
  bring: string[] | undefined,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent {
  const startMs = Date.parse(start);
  return eventFixture({
    id,
    title: id,
    start,
    end: new Date(startMs + 60 * 60_000).toISOString(),
    ...(bring === undefined ? {} : { bring }),
    ...overrides,
  });
}

function allDay(
  id: string,
  start: string,
  end: string,
  bring: string[],
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent {
  return eventFixture({
    id,
    title: id,
    allDay: true,
    start,
    end,
    bring,
    ...overrides,
  });
}

/** `{ when, groups: [[child id or "everyone", icons]] }`, compact for assertions. */
function summary(reminder: BringReminder): {
  when: string;
  groups: [string, string[]][];
} {
  return {
    when: reminder.when,
    groups: reminder.groups.map((group) => [
      group.child?.id ?? "everyone",
      group.icons,
    ]),
  };
}

function build(
  events: CalendarEvent[],
  now: string,
  config: PublicConfig = CONFIG,
): ReturnType<typeof summary> {
  return summary(buildBringReminder({ events }, config, at(now)));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildBringReminder: window", () => {
  // Sunday 2026-11-22 (CET, +01:00); tomorrow Monday 2026-11-23.
  const EVENTS = [
    timed("today-evening", "2026-11-22T18:30:00+01:00", ["🛁"], {
      childIds: ["mia"],
    }),
    timed("swim", "2026-11-23T07:30:00+01:00", ["🩱", "🧴"], {
      childIds: ["mia"],
    }),
    timed("football", "2026-11-23T15:00:00+01:00", ["👟"], {
      childIds: ["ben"],
    }),
    timed("day-after", "2026-11-24T08:00:00+01:00", ["🎨"], {
      childIds: ["mia"],
    }),
  ];

  it("before eveningStart: today's not yet started events (eveningStart - 1 min)", () => {
    expect(build(EVENTS, "2026-11-22T16:59:00+01:00")).toEqual({
      when: "today",
      groups: [["mia", ["🛁"]]],
    });
  });

  it("from eveningStart (exact): tomorrow's events, today's are no longer counted", () => {
    expect(build(EVENTS, "2026-11-22T17:00:00+01:00")).toEqual({
      when: "tomorrow",
      groups: [
        ["mia", ["🩱", "🧴"]],
        ["ben", ["👟"]],
      ],
    });
  });

  it("stays on tomorrow until midnight (23:59) and never looks two days ahead", () => {
    const late = build(EVENTS, "2026-11-22T23:59:00+01:00");
    expect(late.when).toBe("tomorrow");
    expect(late.groups.flatMap(([, icons]) => icons)).not.toContain("🎨");
  });

  it("at midnight switches to today with the same (not yet started) events", () => {
    expect(build(EVENTS, "2026-11-23T00:00:00+01:00")).toEqual({
      when: "today",
      groups: [
        ["mia", ["🩱", "🧴"]],
        ["ben", ["👟"]],
      ],
    });
  });

  it("drops an event's icons exactly at its start (start - 1 min still shows them)", () => {
    expect(build(EVENTS, "2026-11-23T07:29:00+01:00").groups).toEqual([
      ["mia", ["🩱", "🧴"]],
      ["ben", ["👟"]],
    ]);
    expect(build(EVENTS, "2026-11-23T07:30:00+01:00").groups).toEqual([
      ["ben", ["👟"]],
    ]);
    expect(build(EVENTS, "2026-11-23T14:59:00+01:00").groups).toEqual([
      ["ben", ["👟"]],
    ]);
    // Nothing left: empty, so no area.
    expect(build(EVENTS, "2026-11-23T15:00:00+01:00")).toEqual({
      when: "today",
      groups: [],
    });
  });

  it("is empty without any bring list (and ignores empty lists)", () => {
    const plain = [
      timed("a", "2026-11-23T09:00:00+01:00", undefined),
      timed("b", "2026-11-23T10:00:00+01:00", []),
    ];
    expect(build(plain, "2026-11-22T20:00:00+01:00")).toEqual({
      when: "tomorrow",
      groups: [],
    });
    expect(build([], "2026-11-22T08:00:00+01:00").groups).toEqual([]);
  });

  it("all-day events: from the evening before until middayStart of their day", () => {
    const trip = allDay("trip", "2026-11-23", "2026-11-24", ["🧢", "🥪"]);
    expect(build([trip], "2026-11-22T16:59:00+01:00").groups).toEqual([]);
    expect(build([trip], "2026-11-22T17:00:00+01:00").groups).toEqual([
      ["everyone", ["🧢", "🥪"]],
    ]);
    expect(build([trip], "2026-11-23T10:59:00+01:00").groups).toEqual([
      ["everyone", ["🧢", "🥪"]],
    ]);
    expect(build([trip], "2026-11-23T11:00:00+01:00").groups).toEqual([]);
  });

  it("a multi-day all-day event counts on its first day only", () => {
    const camp = allDay("camp", "2026-11-22", "2026-11-25", ["⛺"]);
    // Evening of its first day: tomorrow is its second day, not packed again.
    expect(build([camp], "2026-11-22T18:00:00+01:00").groups).toEqual([]);
    expect(build([camp], "2026-11-23T08:00:00+01:00").groups).toEqual([]);
    // The morning of its first day it counts (until middayStart).
    expect(build([camp], "2026-11-22T08:00:00+01:00").groups).toEqual([
      ["everyone", ["⛺"]],
    ]);
  });

  it("a timed event continuing into tomorrow is not counted again", () => {
    const sleepover = timed("sleepover", "2026-11-22T16:00:00+01:00", ["🧸"], {
      end: "2026-11-23T10:00:00+01:00",
      childIds: ["mia"],
    });
    expect(build([sleepover], "2026-11-22T15:59:00+01:00").groups).toEqual([
      ["mia", ["🧸"]],
    ]);
    expect(build([sleepover], "2026-11-22T17:00:00+01:00").groups).toEqual([]);
    expect(build([sleepover], "2026-11-23T00:30:00+01:00").groups).toEqual([]);
  });

  it("a timed event starting at 00:30 tomorrow counts the evening before and until 00:30", () => {
    const early = [timed("night-flight", "2026-11-23T00:30:00+01:00", ["🧳"])];
    expect(build(early, "2026-11-22T23:59:00+01:00").groups).toEqual([
      ["everyone", ["🧳"]],
    ]);
    expect(build(early, "2026-11-23T00:29:00+01:00").groups).toEqual([
      ["everyone", ["🧳"]],
    ]);
    expect(build(early, "2026-11-23T00:30:00+01:00").groups).toEqual([]);
  });

  it("uses the configured bands", () => {
    const config = configFixture({
      children: [MIA],
      bands: {
        morningStart: "07:00",
        middayStart: "12:30",
        eveningStart: "19:15",
      },
    });
    const events = [
      timed("swim", "2026-11-23T08:00:00+01:00", ["🩱"], { childIds: ["mia"] }),
      allDay("trip", "2026-11-23", "2026-11-24", ["🧢"]),
    ];
    expect(build(events, "2026-11-22T19:14:00+01:00", config).groups).toEqual(
      [],
    );
    expect(build(events, "2026-11-22T19:15:00+01:00", config).groups).toEqual([
      ["everyone", ["🧢"]],
      ["mia", ["🩱"]],
    ]);
    expect(build(events, "2026-11-23T12:29:00+01:00", config).groups).toEqual([
      ["everyone", ["🧢"]],
    ]);
    expect(build(events, "2026-11-23T12:30:00+01:00", config).groups).toEqual(
      [],
    );
  });

  it("a recurring event with an override: each occurrence carries its own list", () => {
    // Weekly swimming; tomorrow's occurrence was changed ("only this event") to 09:00
    // with its own bring list; next week's still has the series' list.
    const series = [
      timed("swim@2026-11-23", "2026-11-23T09:00:00+01:00", ["🥽"], {
        childIds: ["mia"],
      }),
      timed("swim@2026-11-30", "2026-11-30T07:30:00+01:00", ["🩱", "🧴"], {
        childIds: ["mia"],
      }),
    ];
    expect(build(series, "2026-11-22T20:00:00+01:00").groups).toEqual([
      ["mia", ["🥽"]],
    ]);
    // The override moved to its new start: still shown at the series' old time.
    expect(build(series, "2026-11-23T07:30:00+01:00").groups).toEqual([
      ["mia", ["🥽"]],
    ]);
    expect(build(series, "2026-11-23T09:00:00+01:00").groups).toEqual([]);
    // An occurrence moved away from tomorrow is not packed for tomorrow.
    const moved = [
      timed("swim@2026-11-23", "2026-11-24T07:30:00+01:00", ["🩱"], {
        childIds: ["mia"],
      }),
    ];
    expect(build(moved, "2026-11-22T20:00:00+01:00").groups).toEqual([]);
  });
});

describe("buildBringReminder: time zones and DST (Europe/Berlin)", () => {
  it("uses the config zone, not the device zone", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    // Precondition: the device zone really is different (UTC-8 in November).
    expect(new Date(at("2026-11-22T12:00:00Z")).getTimezoneOffset()).toBe(480);
    const events = [
      timed("swim", "2026-11-23T07:30:00+01:00", ["🩱"], { childIds: ["mia"] }),
    ];
    // 16:59 / 17:00 Berlin = 07:59 / 08:00 Los Angeles.
    expect(build(events, "2026-11-22T15:59:00Z").groups).toEqual([]);
    expect(build(events, "2026-11-22T16:00:00Z")).toEqual({
      when: "tomorrow",
      groups: [["mia", ["🩱"]]],
    });
    // Berlin midnight (Los Angeles still 15:00 the day before): today = the 23rd.
    expect(build(events, "2026-11-22T23:00:00Z")).toEqual({
      when: "today",
      groups: [["mia", ["🩱"]]],
    });
    // Same instants for a family in Tokyo: already past its midnight and morning.
    const tokyo = configFixture({ children: [MIA], timeZone: "Asia/Tokyo" });
    expect(
      build(
        [timed("tokyo", "2026-11-23T09:00:00+09:00", ["🎨"])],
        "2026-11-22T08:00:00Z", // 17:00 Tokyo
        tokyo,
      ),
    ).toEqual({ when: "tomorrow", groups: [["everyone", ["🎨"]]] });
  });

  it("names the day the icons are for in the config zone: tomorrow in the evening, today after midnight", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    const none: CalendarEvent[] = [];
    const reminder = (now: string, config: PublicConfig = CONFIG) =>
      buildBringReminder({ events: none }, config, at(now));
    // 16:59 Berlin: today (the 22nd); 17:00: tomorrow (the 23rd); midnight: the 23rd.
    expect(reminder("2026-11-22T15:59:00Z").date).toBe("2026-11-22");
    expect(reminder("2026-11-22T16:00:00Z").date).toBe("2026-11-23");
    expect(reminder("2026-11-22T23:00:00Z")).toMatchObject({
      when: "today",
      date: "2026-11-23",
    });
    // Across the spring-forward night (Saturday 17:00 CET → Sunday the 29th) and the
    // last evening of a month.
    expect(reminder("2026-03-28T16:00:00Z").date).toBe("2026-03-29");
    expect(reminder("2026-11-30T16:30:00Z").date).toBe("2026-12-01");
    // Tokyo: 17:00 there is 08:00Z, the next day is already its 23rd.
    const tokyo = configFixture({ children: [MIA], timeZone: "Asia/Tokyo" });
    expect(reminder("2026-11-22T08:00:00Z", tokyo).date).toBe("2026-11-23");
  });

  // Spring forward: Sunday 2026-03-29, 02:00 CET → 03:00 CEST.
  it("spring-forward evening: eveningStart on the wall clock, tomorrow's events after the gap", () => {
    const events = [
      timed("early", "2026-03-29T03:30:00+02:00", ["🧦"]),
      timed("swim", "2026-03-29T09:00:00+02:00", ["🩱"], { childIds: ["mia"] }),
      timed("next-day", "2026-03-30T09:00:00+02:00", ["🎨"]),
    ];
    // Saturday 17:00 CET = 16:00Z.
    expect(build(events, "2026-03-28T15:59:00Z").groups).toEqual([]);
    expect(build(events, "2026-03-28T16:00:00Z")).toEqual({
      when: "tomorrow",
      groups: [
        ["everyone", ["🧦"]],
        ["mia", ["🩱"]],
      ],
    });
    // Midnight CET (23:00Z), then across the gap: 01:59 CET is followed by 03:00 CEST.
    expect(build(events, "2026-03-28T23:00:00Z").when).toBe("today");
    expect(build(events, "2026-03-29T00:59:00Z").groups).toHaveLength(2);
    expect(build(events, "2026-03-29T01:00:00Z").groups).toHaveLength(2);
    // 03:29 / 03:30 CEST.
    expect(build(events, "2026-03-29T01:29:00Z").groups).toHaveLength(2);
    expect(build(events, "2026-03-29T01:30:00Z").groups).toEqual([
      ["mia", ["🩱"]],
    ]);
    // The DST day's own evening: 17:00 CEST = 15:00Z (an hour earlier in UTC).
    expect(build(events, "2026-03-29T14:59:00Z")).toEqual({
      when: "today",
      groups: [],
    });
    expect(build(events, "2026-03-29T15:00:00Z")).toEqual({
      when: "tomorrow",
      groups: [["everyone", ["🎨"]]],
    });
  });

  // Fall back: Sunday 2026-10-25, 03:00 CEST → 02:00 CET (02:00-02:59 twice).
  it("fall-back evening: eveningStart on the wall clock, a repeated hour handled by instant", () => {
    const events = [
      // The second 02:30 (CET).
      timed("late-twin", "2026-10-25T02:30:00+01:00", ["🧢"]),
      timed("swim", "2026-10-25T09:00:00+01:00", ["🩱"], { childIds: ["mia"] }),
    ];
    // Saturday 17:00 CEST = 15:00Z.
    expect(build(events, "2026-10-24T14:59:00Z").groups).toEqual([]);
    expect(build(events, "2026-10-24T15:00:00Z").groups).toEqual([
      ["everyone", ["🧢"]],
      ["mia", ["🩱"]],
    ]);
    // Midnight CEST = 22:00Z.
    expect(build(events, "2026-10-24T21:59:00Z").when).toBe("tomorrow");
    expect(build(events, "2026-10-24T22:00:00Z").when).toBe("today");
    // The first 02:30 (CEST, 00:30Z) is not the event's start; the second (01:30Z) is.
    expect(build(events, "2026-10-25T00:30:00Z").groups).toHaveLength(2);
    expect(build(events, "2026-10-25T01:29:00Z").groups).toHaveLength(2);
    expect(build(events, "2026-10-25T01:30:00Z").groups).toEqual([
      ["mia", ["🩱"]],
    ]);
    // The DST day's own evening: 17:00 CET = 16:00Z (an hour later in UTC).
    expect(build(events, "2026-10-25T15:59:00Z").when).toBe("today");
    expect(build(events, "2026-10-25T16:00:00Z").when).toBe("tomorrow");
  });
});

describe("buildBringReminder: grouping", () => {
  const EVENING = "2026-11-22T19:40:00+01:00";

  it("one group per child in config order, everyone first, several children each", () => {
    const events = [
      timed("football", "2026-11-23T08:00:00+01:00", ["👟", "🧦"], {
        childIds: ["ben"],
      }),
      timed("library", "2026-11-23T09:00:00+01:00", ["📕"], {
        childIds: ["ben", "mia"],
      }),
      timed("picnic", "2026-11-23T12:00:00+01:00", ["🧺"]),
      timed("swim", "2026-11-23T14:00:00+01:00", ["🩱"], { childIds: ["mia"] }),
    ];
    const reminder = buildBringReminder({ events }, CONFIG, at(EVENING));
    expect(summary(reminder).groups).toEqual([
      ["everyone", ["🧺"]],
      ["mia", ["📕", "🩱"]],
      ["ben", ["👟", "🧦", "📕"]],
    ]);
    // The groups carry the configured child (name, avatar, colour for the badge).
    expect(reminder.groups[1]?.child).toEqual(MIA);
    expect(reminder.groups[2]?.child).toEqual(BEN);
    expect(reminder.groups[0]?.child).toBeNull();
  });

  it("deduplicates per child (ignoring VS16, first spelling wins), in event order", () => {
    const events = [
      // Listed later but starts first: event order decides.
      timed("b", "2026-11-23T10:00:00+01:00", ["☂", "🧢"], {
        childIds: ["mia"],
      }),
      timed("a", "2026-11-23T08:00:00+01:00", ["🧢", "☂️"], {
        childIds: ["mia"],
      }),
      allDay("trip", "2026-11-23", "2026-11-24", ["🥪"], { childIds: ["mia"] }),
      timed("c", "2026-11-23T09:00:00+01:00", ["🧢"], { childIds: ["ben"] }),
    ];
    expect(build(events, EVENING).groups).toEqual([
      ["mia", ["🥪", "🧢", "☂️"]],
      ["ben", ["🧢"]],
    ]);
  });

  it("unknown children count as everyone; a repeated child id adds once", () => {
    const events = [
      timed("x", "2026-11-23T08:00:00+01:00", ["🎻"], {
        childIds: ["someone-else"],
      }),
      timed("y", "2026-11-23T09:00:00+01:00", ["🎨"], {
        childIds: ["mia", "mia", "someone-else"],
      }),
    ];
    expect(build(events, EVENING).groups).toEqual([
      ["everyone", ["🎻"]],
      ["mia", ["🎨"]],
    ]);
  });

  it("does not mutate the agenda", () => {
    const events = [
      timed("b", "2026-11-23T10:00:00+01:00", ["🧢"]),
      timed("a", "2026-11-23T08:00:00+01:00", ["👟"]),
    ];
    const copy = structuredClone(events);
    buildBringReminder({ events }, CONFIG, at(EVENING));
    expect(events).toEqual(copy);
  });

  it("leads with the bring bag", () => {
    expect(BRING_BAG).toBe("🎒");
  });
});
