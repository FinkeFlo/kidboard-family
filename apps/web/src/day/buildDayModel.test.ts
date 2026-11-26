import { describe, expect, it } from "vitest";

import { eventFixture, mealFixture } from "../components/fixtures.test-utils";
import { buildDayModel, type DayModelConfig } from "./buildDayModel";

const CONFIG: DayModelConfig = {
  timeZone: "Europe/Berlin",
  bands: {
    morningStart: "06:00",
    middayStart: "11:00",
    eveningStart: "17:00",
  },
};
const TODAY = "2026-11-22";
/** 2026-11-22 at the given Berlin wall time (CET, +01:00). */
const at = (time: string): number => Date.parse(`${TODAY}T${time}:00+01:00`);

function timed(id: string, start: string, end: string) {
  return eventFixture({ id, title: id, start, end });
}

function ids(model: ReturnType<typeof buildDayModel>, band: number): string[] {
  return model.bands[band]?.events.map((e) => e.event.id) ?? [];
}

describe("buildDayModel", () => {
  it("places timed events by start time, sorted, with boundaries in the later band", () => {
    const model = buildDayModel(
      {
        events: [
          timed(
            "lunch",
            "2026-11-22T12:00:00+01:00",
            "2026-11-22T13:00:00+01:00",
          ),
          timed(
            "b-midday",
            "2026-11-22T11:00:00+01:00",
            "2026-11-22T11:30:00+01:00",
          ),
          timed(
            "a-morning",
            "2026-11-22T10:59:00+01:00",
            "2026-11-22T11:30:00+01:00",
          ),
          timed(
            "evening",
            "2026-11-22T17:00:00+01:00",
            "2026-11-22T18:00:00+01:00",
          ),
          timed(
            "late",
            "2026-11-22T23:30:00+01:00",
            "2026-11-22T23:59:00+01:00",
          ),
        ],
        meals: [],
      },
      CONFIG,
      TODAY,
      at("09:00"),
    );
    expect(model.bands.map((b) => b.id)).toEqual([
      "morning",
      "midday",
      "evening",
    ]);
    expect(ids(model, 0)).toEqual(["a-morning"]);
    expect(ids(model, 1)).toEqual(["b-midday", "lunch"]);
    expect(ids(model, 2)).toEqual(["evening", "late"]);
    expect(model.isEmpty).toBe(false);
  });

  it("uses the config band boundaries", () => {
    const model = buildDayModel(
      {
        events: [
          timed("e", "2026-11-22T09:30:00+01:00", "2026-11-22T10:00:00+01:00"),
        ],
        meals: [],
      },
      {
        ...CONFIG,
        bands: {
          morningStart: "05:00",
          middayStart: "09:00",
          eveningStart: "15:00",
        },
      },
      TODAY,
      at("08:00"),
    );
    expect(ids(model, 1)).toEqual(["e"]);
  });

  it("puts events before morningStart (night) into the morning band", () => {
    const model = buildDayModel(
      {
        events: [
          timed(
            "early",
            "2026-11-22T00:15:00+01:00",
            "2026-11-22T01:00:00+01:00",
          ),
        ],
        meals: [],
      },
      CONFIG,
      TODAY,
      at("12:00"),
    );
    expect(ids(model, 0)).toEqual(["early"]);
  });

  it("shows all-day events in the top row, multi-day ones on each day they cover", () => {
    const events = [
      eventFixture({
        id: "trip",
        allDay: true,
        start: "2026-11-20",
        end: "2026-11-23",
      }),
      eventFixture({
        id: "holiday",
        allDay: true,
        start: "2026-11-22",
        end: "2026-11-23",
      }),
      eventFixture({
        id: "tomorrow",
        allDay: true,
        start: "2026-11-23",
        end: "2026-11-24",
      }),
      eventFixture({
        id: "yesterday",
        allDay: true,
        start: "2026-11-21",
        end: "2026-11-22",
      }),
    ];
    const allDayIds = (day: string): string[] =>
      buildDayModel({ events, meals: [] }, CONFIG, day, at("09:00")).allDay.map(
        (e) => e.event.id,
      );
    expect(allDayIds("2026-11-20")).toEqual(["trip"]);
    expect(allDayIds("2026-11-21")).toEqual(["trip", "yesterday"]);
    expect(allDayIds("2026-11-22")).toEqual(["trip", "holiday"]);
    expect(allDayIds("2026-11-23")).toEqual(["tomorrow"]);
    const model = buildDayModel(
      { events, meals: [] },
      CONFIG,
      TODAY,
      at("09:00"),
    );
    expect(model.allDay.every((e) => e.status === "upcoming")).toBe(true);
    expect(model.bands.every((b) => b.events.length === 0)).toBe(true);
  });

  it("shows midnight-crossing events on both days, morning band on the second", () => {
    const events = [
      timed(
        "sleepover",
        "2026-11-21T22:00:00+01:00",
        "2026-11-22T07:00:00+01:00",
      ),
    ];
    const first = buildDayModel(
      { events, meals: [] },
      CONFIG,
      "2026-11-21",
      Date.parse("2026-11-21T20:00:00+01:00"),
    );
    expect(first.bands[2]?.events.map((e) => e.event.id)).toEqual([
      "sleepover",
    ]);
    const second = buildDayModel(
      { events, meals: [] },
      CONFIG,
      TODAY,
      at("06:30"),
    );
    expect(ids(second, 0)).toEqual(["sleepover"]);
    expect(second.bands[0]?.events[0]?.status).toBe("current");
    const third = buildDayModel(
      { events, meals: [] },
      CONFIG,
      "2026-11-23",
      Date.parse("2026-11-23T09:00:00+01:00"),
    );
    expect(third.isEmpty).toBe(true);
  });

  it("does not spill an event ending exactly at midnight into the next day", () => {
    const events = [
      timed("late", "2026-11-22T22:00:00+01:00", "2026-11-23T00:00:00+01:00"),
    ];
    const next = buildDayModel(
      { events, meals: [] },
      CONFIG,
      "2026-11-23",
      Date.parse("2026-11-23T09:00:00+01:00"),
    );
    expect(next.isEmpty).toBe(true);
    const day = buildDayModel(
      { events, meals: [] },
      CONFIG,
      TODAY,
      at("09:00"),
    );
    expect(ids(day, 2)).toEqual(["late"]);
  });

  it("keeps zero-length events on their start day", () => {
    const events = [
      timed("ping", "2026-11-22T23:59:00+01:00", "2026-11-22T23:59:00+01:00"),
    ];
    expect(
      buildDayModel(
        { events, meals: [] },
        CONFIG,
        "2026-11-23",
        Date.parse("2026-11-23T09:00:00+01:00"),
      ).isEmpty,
    ).toBe(true);
    expect(
      ids(buildDayModel({ events, meals: [] }, CONFIG, TODAY, at("09:00")), 2),
    ).toEqual(["ping"]);
  });

  it("handles the spring-forward day by wall-clock time", () => {
    const day = "2026-03-29";
    const events = [
      // 02:00-03:00 does not exist; 03:30+02:00 is 03:30 on the wall clock (night).
      timed("dawn", "2026-03-29T03:30:00+02:00", "2026-03-29T04:00:00+02:00"),
      // 06:00+02:00 = 04:00Z, the morningStart boundary on the wall clock.
      timed("six", "2026-03-29T06:00:00+02:00", "2026-03-29T07:00:00+02:00"),
      timed("noon", "2026-03-29T11:00:00+02:00", "2026-03-29T12:00:00+02:00"),
    ];
    const now = Date.parse("2026-03-29T06:30:00+02:00");
    const model = buildDayModel({ events, meals: [] }, CONFIG, day, now);
    expect(ids(model, 0)).toEqual(["dawn", "six"]);
    expect(ids(model, 1)).toEqual(["noon"]);
    expect(model.bands[0]?.status).toBe("current");
    expect(model.bands[0]?.events[0]?.status).toBe("past");
    expect(model.bands[0]?.events[1]?.status).toBe("current");
  });

  it("handles the fall-back day (02:30 occurs twice)", () => {
    const day = "2026-10-25";
    const events = [
      timed("first", "2026-10-25T02:30:00+02:00", "2026-10-25T02:45:00+02:00"),
      timed("second", "2026-10-25T02:30:00+01:00", "2026-10-25T02:45:00+01:00"),
      timed("midday", "2026-10-25T11:00:00+01:00", "2026-10-25T12:00:00+01:00"),
    ];
    // Between the two 02:30s: the first is over, the second still upcoming.
    const now = Date.parse("2026-10-25T02:10:00+01:00");
    const model = buildDayModel({ events, meals: [] }, CONFIG, day, now);
    expect(ids(model, 0)).toEqual(["first", "second"]);
    expect(ids(model, 1)).toEqual(["midday"]);
    expect(model.bands[0]?.events.map((e) => e.status)).toEqual([
      "past",
      "upcoming",
    ]);
    // No band is current before morningStart.
    expect(model.bands.map((b) => b.status)).toEqual([
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
  });

  it("marks past, current and upcoming events and bands from now", () => {
    const events = [
      timed("over", "2026-11-22T08:00:00+01:00", "2026-11-22T09:00:00+01:00"),
      timed("ending", "2026-11-22T10:00:00+01:00", "2026-11-22T12:00:00+01:00"),
      timed("later", "2026-11-22T13:00:00+01:00", "2026-11-22T14:00:00+01:00"),
    ];
    const model = buildDayModel(
      { events, meals: [] },
      CONFIG,
      TODAY,
      at("12:00"),
    );
    expect(model.bands.map((b) => b.status)).toEqual([
      "past",
      "current",
      "upcoming",
    ]);
    // `end` is exclusive: at exactly 12:00 the 10:00-12:00 event is over.
    expect(model.bands[0]?.events.map((e) => e.status)).toEqual([
      "past",
      "past",
    ]);
    expect(model.bands[1]?.events.map((e) => e.status)).toEqual(["upcoming"]);
    const earlier = buildDayModel(
      { events, meals: [] },
      CONFIG,
      TODAY,
      at("11:59"),
    );
    expect(earlier.bands[0]?.events[1]?.status).toBe("current");
  });

  it("makes the current band switch exactly at the boundary", () => {
    const status = (time: string): string[] =>
      buildDayModel(
        { events: [], meals: [] },
        CONFIG,
        TODAY,
        at(time),
      ).bands.map((b) => b.status);
    expect(status("05:59")).toEqual(["upcoming", "upcoming", "upcoming"]);
    expect(status("06:00")).toEqual(["current", "upcoming", "upcoming"]);
    expect(status("10:59")).toEqual(["current", "upcoming", "upcoming"]);
    expect(status("11:00")).toEqual(["past", "current", "upcoming"]);
    expect(status("17:00")).toEqual(["past", "past", "current"]);
    expect(status("23:59")).toEqual(["past", "past", "current"]);
  });

  it("derives no status for a day that is not today", () => {
    const events = [
      timed("e", "2026-11-23T08:00:00+01:00", "2026-11-23T09:00:00+01:00"),
    ];
    const model = buildDayModel(
      { events, meals: [] },
      CONFIG,
      "2026-11-23",
      at("12:00"),
    );
    expect(model.bands[0]?.events[0]?.status).toBe("upcoming");
    expect(model.bands.map((b) => b.status)).toEqual([
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
  });

  it("uses the config zone, not the device zone, for the day", () => {
    // 2026-11-22T23:30Z is already 08:30 on 2026-11-23 in Tokyo.
    const events = [
      timed("e", "2026-11-22T23:30:00+00:00", "2026-11-23T00:30:00+00:00"),
    ];
    const tokyo = { ...CONFIG, timeZone: "Asia/Tokyo" };
    expect(
      buildDayModel(
        { events, meals: [] },
        tokyo,
        "2026-11-23",
        Date.parse("2026-11-23T00:00:00Z"),
      ).isEmpty,
    ).toBe(false);
    expect(
      buildDayModel(
        { events, meals: [] },
        tokyo,
        "2026-11-22",
        Date.parse("2026-11-22T12:00:00Z"),
      ).isEmpty,
    ).toBe(true);
  });

  it("keeps only today's meals, ordered by slot", () => {
    const model = buildDayModel(
      {
        events: [],
        meals: [
          mealFixture({ id: "d", slot: "dinner" }),
          mealFixture({ id: "other", date: "2026-11-23", slot: "lunch" }),
          mealFixture({ id: "u", slot: "unspecified" }),
          mealFixture({ id: "b", slot: "breakfast" }),
          mealFixture({ id: "l", slot: "lunch" }),
        ],
      },
      CONFIG,
      TODAY,
      at("09:00"),
    );
    expect(model.meals.map((m) => m.id)).toEqual(["b", "l", "d", "u"]);
    expect(model.isEmpty).toBe(false);
  });

  it("is empty only without events and meals", () => {
    expect(
      buildDayModel({ events: [], meals: [] }, CONFIG, TODAY, at("09:00"))
        .isEmpty,
    ).toBe(true);
    expect(
      buildDayModel(
        { events: [], meals: [mealFixture()] },
        CONFIG,
        TODAY,
        at("09:00"),
      ).isEmpty,
    ).toBe(false);
  });

  it("flags timed events that started on an earlier day as continuing", () => {
    const model = buildDayModel(
      {
        events: [
          timed(
            "cont",
            "2026-11-21T20:00:00+01:00",
            "2026-11-22T09:00:00+01:00",
          ),
          timed(
            "own",
            "2026-11-22T10:00:00+01:00",
            "2026-11-22T11:00:00+01:00",
          ),
        ],
        meals: [],
      },
      CONFIG,
      TODAY,
      at("12:00"),
    );
    const flags = model.bands
      .flatMap((band) => band.events)
      .map((e) => [e.event.id, e.continues]);
    expect(flags).toEqual([
      ["cont", true],
      ["own", false],
    ]);
    // On its first day the same event is not "continuing".
    const first = buildDayModel(
      {
        events: [
          timed(
            "cont",
            "2026-11-21T20:00:00+01:00",
            "2026-11-22T09:00:00+01:00",
          ),
        ],
        meals: [],
      },
      CONFIG,
      "2026-11-21",
      at("12:00"),
    );
    expect(first.bands[2]?.events[0]?.continues).toBe(false);
  });
});
