import {
  type EditorEntryInput,
  EditorEntryInputSchema,
  type EditorGoogleItem,
  parseEditorEntryInput,
} from "@kidboard/shared";
import { describe, expect, it } from "vitest";

import { BEN, MIA } from "../components/fixtures.test-utils";
import { configFixture } from "../data/testing.test-utils";
import {
  defaultStart,
  draftChanged,
  type EventDraft,
  eventDraftFromEntry,
  eventDraftFromGoogle,
  eventDraftFromTemplate,
  eventDraftProblems,
  eventDraftToInput,
  isCountdownIcon,
  isEmoji,
  mealDraftFromEntry,
  mealDraftProblems,
  mealDraftToInput,
  mealSeriesWeekdays,
  newEventDraft,
  newMealDraft,
  previewEvent,
  problemsOf,
  seriesStartDate,
  startsInPast,
  toggleWeekday,
  withDate,
} from "./draft";

const config = configFixture({ children: [MIA, BEN] });
/** Sunday. */
const TODAY = "2026-11-22";

function draft(overrides: Partial<EventDraft> = {}): EventDraft {
  return {
    ...newEventDraft(TODAY),
    icon: "🏊",
    title: "Swimming",
    ...overrides,
  };
}

describe("event drafts → EditorEntryInput", () => {
  it("a new draft is today, 15:00 for an hour, once, for everyone", () => {
    expect(newEventDraft(TODAY)).toMatchObject({
      childIds: [],
      date: TODAY,
      allDay: false,
      startTime: "15:00",
      duration: 60,
      repeat: "none",
      weekdays: [7],
      bring: [],
      countdown: false,
    });
  });

  it("writes a timed entry with the end from the duration", () => {
    const input = eventDraftToInput(
      draft({ childIds: ["mia"], startTime: "09:30", duration: 45 }),
    );
    expect(input).toEqual({
      kind: "event",
      childIds: ["mia"],
      icon: "🏊",
      title: "Swimming",
      date: TODAY,
      allDay: false,
      startTime: "09:30",
      endTime: "10:15",
      bring: [],
      countdown: false,
      repeat: "none",
    });
    expect(parseEditorEntryInput(input, config).ok).toBe(true);
  });

  it("an end after midnight gets the next day as endDate", () => {
    const input = eventDraftToInput(
      draft({ startTime: "23:30", duration: 90 }),
    );
    expect(input).toMatchObject({
      endTime: "01:00",
      endDate: "2026-11-23",
    });
    expect(parseEditorEntryInput(input, config).ok).toBe(true);
  });

  it("all-day entries have no times; multi-day ones an exclusive endDate", () => {
    expect(eventDraftToInput(draft({ allDay: true }))).not.toHaveProperty(
      "startTime",
    );
    expect(
      eventDraftToInput(draft({ allDay: true, allDayDays: 3 })),
    ).toMatchObject({ allDay: true, endDate: "2026-11-25" });
  });

  it("weekly with sorted weekdays, every 2 weeks and a last day", () => {
    const input = eventDraftToInput(
      draft({
        repeat: "weekly",
        weekdays: [7, 3, 3],
        interval: 2,
        until: "2027-01-31",
      }),
    );
    expect(input.repeat).toEqual({
      weekly: { weekdays: [3, 7], interval: 2, until: "2027-01-31" },
    });
    expect(parseEditorEntryInput(input, config).ok).toBe(true);
  });

  it("weekly without a last day omits until", () => {
    expect(eventDraftToInput(draft({ repeat: "weekly" })).repeat).toEqual({
      weekly: { weekdays: [7], interval: 1 },
    });
  });
});

describe("weekday chips follow the date", () => {
  it("a single weekday moves with the date", () => {
    const moved = withDate(draft({ repeat: "weekly" }), "2026-11-24");
    expect(moved.weekdays).toEqual([2]);
  });

  it("several weekdays stay and the new date's weekday is added", () => {
    const moved = withDate(
      draft({ repeat: "weekly", weekdays: [1, 7] }),
      "2026-11-25",
    );
    expect(moved.weekdays).toEqual([1, 3, 7]);
  });

  it("a last day before the new date is cleared", () => {
    expect(withDate(draft({ until: "2026-11-23" }), "2026-11-25").until).toBe(
      "",
    );
    expect(withDate(draft({ until: "2026-12-23" }), "2026-11-25").until).toBe(
      "2026-12-23",
    );
  });

  it("the date's own weekday cannot be switched off; others toggle", () => {
    const base = draft({ repeat: "weekly", weekdays: [7] });
    expect(toggleWeekday(base, 7)).toBe(base);
    expect(toggleWeekday(base, 2).weekdays).toEqual([2, 7]);
    expect(toggleWeekday(toggleWeekday(base, 2), 2).weekdays).toEqual([7]);
  });
});

describe("a series day moved on its own (anchorDate)", () => {
  // Every Sunday from 2026-11-22; the 29th was moved to Tuesday, December 1.
  const moved = draft({
    date: "2026-12-01",
    repeat: "weekly",
    weekdays: [7],
    anchorDate: "2026-11-29",
  });

  it("locks the rule day's weekday, not the moved day's", () => {
    expect(toggleWeekday(moved, 7)).toBe(moved);
    expect(toggleWeekday(moved, 2).weekdays).toEqual([2, 7]);
  });

  it("is checked as the series from its rule day", () => {
    expect(eventDraftProblems(moved, config)).toEqual([]);
    expect(
      eventDraftProblems({ ...moved, anchorDate: undefined }, config),
    ).toEqual(["until"]);
  });

  it("a new date in the form drops the anchor and becomes a rule day", () => {
    const next = withDate(moved, "2026-12-02");
    expect(next.anchorDate).toBeUndefined();
    expect(next.weekdays).toEqual([3]);
  });
});

describe("mealSeriesWeekdays", () => {
  it("keeps the rule unless the date moved in the form to another weekday", () => {
    expect(mealSeriesWeekdays([7], "2026-11-29", "2026-11-29")).toEqual([7]);
    // Opened on a day moved on its own: unchanged date, rule unchanged.
    expect(mealSeriesWeekdays([7], "2026-12-01", "2026-12-01")).toEqual([7]);
    expect(mealSeriesWeekdays([7], "2026-11-29", "2026-11-24")).toEqual([2]);
    expect(mealSeriesWeekdays([3, 7], "2026-11-29", "2026-11-24")).toEqual([
      2, 3, 7,
    ]);
  });
});

describe("drafts of stored entries", () => {
  const stored: EditorEntryInput = EditorEntryInputSchema.parse({
    kind: "event",
    childIds: ["ben"],
    icon: "⚽",
    title: "Football",
    allDay: false,
    date: "2026-11-24",
    startTime: "16:00",
    endTime: "17:30",
    repeat: { weekly: { weekdays: [2, 4], interval: 2, until: "2027-03-01" } },
    bring: ["👟"],
  });

  it("round-trips through the form", () => {
    const back = eventDraftToInput(eventDraftFromEntry(stored));
    expect(EditorEntryInputSchema.parse(back)).toEqual(stored);
  });

  it("keeps a length that is no preset and a multi-day all-day range", () => {
    expect(eventDraftFromEntry(stored).duration).toBe(90);
    const multi = EditorEntryInputSchema.parse({
      kind: "event",
      icon: "🏖️",
      title: "Holiday",
      allDay: true,
      date: "2026-12-20",
      endDate: "2027-01-03",
      countdown: true,
    });
    expect(eventDraftFromEntry(multi).allDayDays).toBe(14);
    expect(
      EditorEntryInputSchema.parse(
        eventDraftToInput(eventDraftFromEntry(multi)),
      ),
    ).toEqual(multi);
  });

  it("meals round-trip with their slot and repeat", () => {
    const meal = EditorEntryInputSchema.parse({
      kind: "meal",
      icon: "🍝",
      title: "Spaghetti",
      allDay: true,
      date: TODAY,
      slot: "lunch",
    });
    expect(
      EditorEntryInputSchema.parse(mealDraftToInput(mealDraftFromEntry(meal))),
    ).toEqual(meal);
  });

  it("series start: kept while its weekday stays, else the next rule day", () => {
    const shown = { ...eventDraftFromEntry(stored), date: "2026-12-08" };
    expect(seriesStartDate(stored, "2026-12-08", shown, [2, 4])).toBe(
      "2026-11-24",
    );
    expect(seriesStartDate(stored, "2026-12-08", shown, [4])).toBe(
      "2026-11-26",
    );
    // A date moved in the form becomes the new start.
    expect(
      seriesStartDate(
        stored,
        "2026-12-08",
        { ...shown, date: "2026-12-10" },
        [4],
      ),
    ).toBe("2026-12-10");
  });
});

describe("templates and Google entries", () => {
  it("a suggestion pre-fills children, icon, title, times, bring and countdown", () => {
    const result = eventDraftFromTemplate(
      {
        kind: "event",
        icon: "🏊",
        title: "Swimming",
        childIds: ["mia"],
        allDay: false,
        startTime: "16:00",
        endTime: "16:45",
        bring: ["🩱"],
        countdown: false,
        count: 3,
        origins: ["app"],
      },
      TODAY,
    );
    expect(result).toMatchObject({
      date: TODAY,
      childIds: ["mia"],
      startTime: "16:00",
      duration: 45,
      bring: ["🩱"],
      repeat: "none",
    });
  });

  it("a Google occurrence becomes a new draft on its day (never in the past)", () => {
    const item: EditorGoogleItem = {
      origin: "google",
      id: "g1",
      sourceId: "family",
      iconIsFallback: false,
      kind: "event",
      icon: "🎹",
      title: "Piano",
      childIds: ["ben"],
      allDay: false,
      start: "2026-11-23T16:30:00+01:00",
      end: "2026-11-23T17:15:00+01:00",
      date: "2026-11-23",
      bring: [],
      countdown: false,
    };
    expect(eventDraftFromGoogle(item, TODAY)).toMatchObject({
      date: "2026-11-23",
      startTime: "16:30",
      duration: 45,
      icon: "🎹",
      childIds: ["ben"],
    });
    expect(
      eventDraftFromGoogle(
        { ...item, date: "2026-11-21", iconIsFallback: true },
        TODAY,
      ),
    ).toMatchObject({ date: TODAY, icon: "" });
  });
});

describe("problems before saving", () => {
  it("an icon is needed first", () => {
    expect(eventDraftProblems(draft({ icon: "" }), config)).toEqual(["icon"]);
    expect(eventDraftProblems(draft({ icon: "ab" }), config)).toEqual(["icon"]);
    expect(mealDraftProblems(newMealDraft(TODAY, "dinner"), config)).toEqual([
      "icon",
    ]);
  });

  it("an empty or multi-line title and unknown children are named", () => {
    expect(eventDraftProblems(draft({ title: "  " }), config)).toEqual([
      "title",
    ]);
    expect(eventDraftProblems(draft({ title: "a\nb" }), config)).toEqual([
      "title",
    ]);
    expect(
      eventDraftProblems(draft({ title: "x".repeat(61) }), config),
    ).toEqual(["title"]);
    expect(eventDraftProblems(draft({ childIds: ["lea"] }), config)).toEqual([
      "children",
    ]);
  });

  it("a countdown icon without countdown is not ready; a valid draft is", () => {
    expect(isCountdownIcon("🎂", config)).toBe(true);
    expect(
      eventDraftProblems(draft({ icon: "🎂", title: "Birthday" }), config),
    ).toEqual(["invalid"]);
    expect(
      eventDraftProblems(
        draft({ icon: "🎂", title: "Birthday", countdown: true }),
        config,
      ),
    ).toEqual([]);
  });

  it("a last day before the first is a repeat problem", () => {
    expect(
      eventDraftProblems(
        draft({ repeat: "weekly", until: "2026-11-01" }),
        config,
      ),
    ).toEqual(["until"]);
  });

  it("maps worker issue paths to fields", () => {
    expect(
      problemsOf([
        { code: "invalid", path: "title" },
        { code: "unknown_child", path: "childIds.0" },
        { code: "time_range_invalid", path: "endTime" },
        { code: "invalid", path: "repeat" },
        { code: "countdown_icon", path: "countdown" },
        { code: "invalid", path: "icon" },
      ]).sort(),
    ).toEqual(["children", "icon", "invalid", "time", "title", "until"]);
  });

  it("isEmoji accepts one emoji only", () => {
    expect(isEmoji(" 🏊 ")).toBe(true);
    expect(isEmoji("👩‍🏫")).toBe(true);
    expect(isEmoji("🏊🏊")).toBe(false);
    expect(isEmoji("a")).toBe(false);
    expect(isEmoji("")).toBe(false);
  });
});

describe("live preview event", () => {
  it("is null without an icon", () => {
    expect(previewEvent(draft({ icon: "" }), "Europe/Berlin", "Name")).toBe(
      null,
    );
  });

  it("uses the configured zone's offset (DST aware), not the device zone", () => {
    const winter = previewEvent(draft(), "Europe/Berlin", "Name");
    expect(winter).toMatchObject({
      start: "2026-11-22T15:00:00+01:00",
      end: "2026-11-22T16:00:00+01:00",
      allDay: false,
    });
    const summer = previewEvent(
      draft({ date: "2026-07-05" }),
      "Europe/Berlin",
      "Name",
    );
    expect(summer?.start).toBe("2026-07-05T15:00:00+02:00");
    const la = previewEvent(draft(), "America/Los_Angeles", "Name");
    expect(la?.start).toBe("2026-11-22T15:00:00-08:00");
  });

  it("shows the fallback title, children, bring list and countdown", () => {
    expect(
      previewEvent(
        draft({
          title: "  ",
          childIds: ["mia"],
          bring: ["🩱"],
          countdown: true,
          allDay: true,
          allDayDays: 2,
        }),
        "Europe/Berlin",
        "Name",
      ),
    ).toMatchObject({
      title: "Name",
      childIds: ["mia"],
      bring: ["🩱"],
      countdown: true,
      start: TODAY,
      end: "2026-11-24",
    });
  });
});

describe("defaultStart", () => {
  const at = (iso: string): number => Date.parse(iso);
  const BERLIN = "Europe/Berlin";

  it.each([
    ["2026-11-22T12:00:00+01:00", TODAY, "15:00"],
    ["2026-11-22T14:59:59+01:00", TODAY, "15:00"],
    // From the minute of the default start on it is not ahead any more.
    ["2026-11-22T15:00:00+01:00", TODAY, "16:00"],
    ["2026-11-22T15:00:30+01:00", TODAY, "16:00"],
    ["2026-11-22T15:01:00+01:00", TODAY, "16:00"],
    ["2026-11-22T15:59:00+01:00", TODAY, "16:00"],
    ["2026-11-22T16:00:00+01:00", TODAY, "17:00"],
    ["2026-11-22T22:30:00+01:00", TODAY, "23:00"],
    // No full hour of today is left: tomorrow at the default start.
    ["2026-11-22T23:05:00+01:00", "2026-11-23", "15:00"],
  ])("at %s → %s %s", (now, date, startTime) => {
    expect(defaultStart(TODAY, at(now), BERLIN)).toEqual({ date, startTime });
  });

  it("reads the wall clock of the configured zone, not the device", () => {
    const now = at("2026-11-22T15:30:00Z");
    // 16:30 in Berlin, 10:30 in New York.
    expect(defaultStart(TODAY, now, BERLIN).startTime).toBe("17:00");
    expect(defaultStart(TODAY, now, "America/New_York").startTime).toBe(
      "15:00",
    );
  });
});

describe("startsInPast", () => {
  const NOON = Date.parse("2026-11-22T12:00:00+01:00");
  const BERLIN = "Europe/Berlin";

  it("compares at minute resolution: the current minute is not past", () => {
    const within = NOON + 45_000;
    expect(
      startsInPast(draft({ startTime: "12:00" }), TODAY, within, BERLIN),
    ).toBe(false);
    expect(
      startsInPast(draft({ startTime: "11:59" }), TODAY, within, BERLIN),
    ).toBe(true);
  });

  it("never flags what defaultStart proposes, whatever the second", () => {
    for (let offset = 0; offset < 24 * 3600; offset += 37) {
      const now = Date.parse("2026-11-22T00:00:00+01:00") + offset * 1000;
      const start = defaultStart(TODAY, now, BERLIN);
      expect(
        startsInPast(
          draft({ date: start.date, startTime: start.startTime }),
          TODAY,
          now,
          BERLIN,
        ),
      ).toBe(false);
    }
  });

  it("is true for a one-off start before now in the configured zone", () => {
    expect(
      startsInPast(draft({ startTime: "11:00" }), TODAY, NOON, BERLIN),
    ).toBe(true);
    expect(
      startsInPast(draft({ startTime: "12:00" }), TODAY, NOON, BERLIN),
    ).toBe(false);
    expect(
      startsInPast(draft({ startTime: "13:00" }), TODAY, NOON, BERLIN),
    ).toBe(false);
    expect(
      startsInPast(
        draft({ date: "2026-11-21", startTime: "20:00" }),
        TODAY,
        NOON,
        BERLIN,
      ),
    ).toBe(true);
    // 11:00 in New York is 17:00 in Berlin: still ahead.
    expect(
      startsInPast(
        draft({ startTime: "11:00" }),
        TODAY,
        NOON,
        "America/New_York",
      ),
    ).toBe(false);
  });

  it("counts all-day entries by day and never calls a series past", () => {
    expect(startsInPast(draft({ allDay: true }), TODAY, NOON, BERLIN)).toBe(
      false,
    );
    expect(
      startsInPast(
        draft({ allDay: true, date: "2026-11-21" }),
        TODAY,
        NOON,
        BERLIN,
      ),
    ).toBe(true);
    expect(
      startsInPast(
        draft({ startTime: "09:00", repeat: "weekly", weekdays: [7] }),
        TODAY,
        NOON,
        BERLIN,
      ),
    ).toBe(false);
  });
});

describe("draftChanged", () => {
  it("ignores the title-follows-picture flag and the key order", () => {
    const initial = draft();
    expect(draftChanged(initial, { ...initial })).toBe(false);
    expect(draftChanged(initial, { ...initial, titleFromLabel: true })).toBe(
      false,
    );
    const reordered = Object.fromEntries(
      Object.entries(initial).reverse(),
    ) as unknown as EventDraft;
    expect(draftChanged(initial, reordered)).toBe(false);
    // An undefined optional field is no change.
    expect(draftChanged(initial, { ...initial, anchorDate: undefined })).toBe(
      false,
    );
  });

  it("sees every edited field, also inside arrays and the repeat rule", () => {
    const initial = draft({ bring: ["🩱"] });
    expect(draftChanged({ ...initial, title: "Swim" }, initial)).toBe(true);
    expect(draftChanged({ ...initial, bring: ["🩱", "🥽"] }, initial)).toBe(
      true,
    );
    expect(draftChanged({ ...initial, childIds: ["mia"] }, initial)).toBe(true);
    const meal = newMealDraft(TODAY, "dinner");
    const weekly = {
      ...meal,
      repeat: { weekly: { weekdays: [7], interval: 1 as const } },
    };
    expect(draftChanged(weekly, structuredClone(weekly))).toBe(false);
    expect(draftChanged({ ...weekly, slot: "lunch" }, weekly)).toBe(true);
  });
});
