import { describe, expect, it } from "vitest";

import { eventFixture, mealFixture } from "../components/fixtures.test-utils";
import type { DayEvent } from "../day/buildDayModel";
import {
  buildWeekModel,
  chronological,
  isWeekendDate,
  rankByImportance,
  WEEK_DAYS,
} from "./buildWeekModel";

const CONFIG = {
  timeZone: "Europe/Berlin",
  bands: { morningStart: "06:00", middayStart: "11:00", eveningStart: "17:00" },
} as const;
// Sunday.
const FROM = "2026-11-22";
const NOW = Date.parse("2026-11-22T12:00:00+01:00");

const dayEvent = (
  overrides: Parameters<typeof eventFixture>[0],
  continues = false,
  status: DayEvent["status"] = "upcoming",
): DayEvent => ({
  event: eventFixture(overrides),
  status,
  continues,
  timeOfDay: overrides?.allDay === true ? null : "midday",
});

describe("isWeekendDate", () => {
  it("is true for Saturday and Sunday only, independent of the device zone", () => {
    expect(isWeekendDate("2026-11-21")).toBe(true);
    expect(isWeekendDate("2026-11-22")).toBe(true);
    expect(isWeekendDate("2026-11-23")).toBe(false);
    expect(isWeekendDate("2026-11-27")).toBe(false);
  });
});

describe("rankByImportance", () => {
  it("orders countdown, then all-day, then timed by start", () => {
    const ranked = rankByImportance([
      dayEvent({ id: "late", start: "2026-11-22T18:00:00+01:00" }),
      dayEvent({ id: "early", start: "2026-11-22T08:00:00+01:00" }),
      dayEvent({
        id: "allday",
        allDay: true,
        start: "2026-11-22",
        end: "2026-11-23",
      }),
      dayEvent({
        id: "countdown",
        countdown: true,
        start: "2026-11-22T20:00:00+01:00",
      }),
    ]).map((entry) => entry.event.id);
    expect(ranked).toEqual(["countdown", "allday", "early", "late"]);
  });

  it("puts a countdown all-day event before a plain all-day one", () => {
    const base = { allDay: true, start: "2026-11-22", end: "2026-11-23" };
    const ranked = rankByImportance([
      dayEvent({ id: "plain", ...base }),
      dayEvent({ id: "cd", countdown: true, ...base }),
    ]).map((entry) => entry.event.id);
    expect(ranked).toEqual(["cd", "plain"]);
  });

  it("ranks a continuing event as first of the timed ones and breaks ties by title", () => {
    const ranked = rankByImportance([
      dayEvent({ id: "b", title: "B", start: "2026-11-22T08:00:00+01:00" }),
      dayEvent({ id: "a", title: "A", start: "2026-11-22T08:00:00+01:00" }),
      dayEvent(
        { id: "cont", title: "Z", start: "2026-11-21T20:00:00+01:00" },
        true,
      ),
    ]).map((entry) => entry.event.id);
    expect(ranked).toEqual(["cont", "a", "b"]);
  });

  it("ranks events that are already over last, whatever else they are", () => {
    const ranked = rankByImportance([
      dayEvent(
        {
          id: "past-countdown",
          countdown: true,
          start: "2026-11-22T08:00:00+01:00",
        },
        false,
        "past",
      ),
      dayEvent(
        { id: "past", start: "2026-11-22T07:00:00+01:00" },
        false,
        "past",
      ),
      dayEvent({ id: "late", start: "2026-11-22T18:00:00+01:00" }),
      dayEvent(
        { id: "now", start: "2026-11-22T11:00:00+01:00" },
        false,
        "current",
      ),
      dayEvent({
        id: "allday",
        allDay: true,
        start: "2026-11-22",
        end: "2026-11-23",
      }),
    ]).map((entry) => entry.event.id);
    // Past ones keep the usual order among themselves (countdown first, then by start).
    expect(ranked).toEqual(["allday", "now", "late", "past-countdown", "past"]);
  });

  it("does not modify its input", () => {
    const input = [
      dayEvent({ id: "x", start: "2026-11-22T18:00:00+01:00" }),
      dayEvent({ id: "y", start: "2026-11-22T08:00:00+01:00" }),
    ];
    rankByImportance(input);
    expect(input.map((entry) => entry.event.id)).toEqual(["x", "y"]);
  });
});

describe("chronological", () => {
  it("puts all-day first, then continuing, then by start; keeps past ones in time order", () => {
    const input = [
      dayEvent({ id: "late", start: "2026-11-22T18:00:00+01:00" }),
      dayEvent(
        { id: "over", start: "2026-11-22T08:00:00+01:00" },
        false,
        "past",
      ),
      dayEvent({
        id: "cd",
        countdown: true,
        start: "2026-11-22T20:00:00+01:00",
      }),
      dayEvent({ id: "carry", start: "2026-11-21T22:00:00+01:00" }, true),
      dayEvent({
        id: "allday",
        allDay: true,
        start: "2026-11-22",
        end: "2026-11-23",
      }),
    ];
    expect(chronological(input).map((entry) => entry.event.id)).toEqual([
      "allday",
      "carry",
      "over",
      "late",
      "cd",
    ]);
    expect(input.map((entry) => entry.event.id)[0]).toBe("late");
  });
});

describe("buildWeekModel", () => {
  it("returns seven consecutive days from today with weekend flags", () => {
    const week = buildWeekModel({ events: [], meals: [] }, CONFIG, FROM, NOW);
    expect(week).toHaveLength(WEEK_DAYS);
    expect(week.map((day) => day.date)).toEqual([
      "2026-11-22",
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
    ]);
    expect(week.map((day) => day.isWeekend)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(week.map((day) => day.isToday)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("ranks all events of a day, most important first, without a fixed cut-off", () => {
    const events = [
      eventFixture({
        id: "e1",
        start: "2026-11-23T07:00:00+01:00",
        end: "2026-11-23T08:00:00+01:00",
      }),
      eventFixture({
        id: "e2",
        start: "2026-11-23T08:00:00+01:00",
        end: "2026-11-23T09:00:00+01:00",
      }),
      eventFixture({
        id: "e3",
        start: "2026-11-23T09:00:00+01:00",
        end: "2026-11-23T10:00:00+01:00",
      }),
      eventFixture({
        id: "e4",
        start: "2026-11-23T10:00:00+01:00",
        end: "2026-11-23T11:00:00+01:00",
      }),
      eventFixture({
        id: "cd",
        countdown: true,
        start: "2026-11-23T19:00:00+01:00",
        end: "2026-11-23T20:00:00+01:00",
      }),
    ];
    const monday = buildWeekModel({ events, meals: [] }, CONFIG, FROM, NOW)[1];
    expect(monday?.events.map((e) => e.event.id)).toEqual([
      "cd",
      "e1",
      "e2",
      "e3",
      "e4",
    ]);
  });

  it("ranks what is still to come before finished events today", () => {
    const at = (id: string, hour: number): ReturnType<typeof eventFixture> =>
      eventFixture({
        id,
        start: `2026-11-22T${String(hour).padStart(2, "0")}:00:00+01:00`,
        end: `2026-11-22T${String(hour + 1).padStart(2, "0")}:00:00+01:00`,
      });
    // NOW is 12:00: "early" and "mid" are over.
    const events = [at("early", 7), at("mid", 9), at("a", 13), at("b", 16)];
    const [today, tomorrow] = buildWeekModel(
      { events, meals: [] },
      CONFIG,
      FROM,
      NOW,
    );
    expect(today?.events.map((e) => e.event.id)).toEqual([
      "a",
      "b",
      "early",
      "mid",
    ]);
    // The same events a day later are not over: plain start-time order.
    const next = buildWeekModel(
      {
        events: events.map((e) =>
          eventFixture({
            ...e,
            start: e.start.replace("2026-11-22", "2026-11-23"),
            end: e.end.replace("2026-11-22", "2026-11-23"),
          }),
        ),
        meals: [],
      },
      CONFIG,
      FROM,
      NOW,
    )[1];
    expect(next?.events.map((e) => e.event.id)).toEqual([
      "early",
      "mid",
      "a",
      "b",
    ]);
    expect(tomorrow?.events).toEqual([]);
  });

  it("keeps every event of a day in the model (the column decides what fits)", () => {
    const events = ["a", "b", "c"].map((id, i) =>
      eventFixture({
        id,
        start: `2026-11-24T${String(7 + i).padStart(2, "0")}:00:00+01:00`,
        end: `2026-11-24T${String(8 + i).padStart(2, "0")}:00:00+01:00`,
      }),
    );
    const tuesday = buildWeekModel({ events, meals: [] }, CONFIG, FROM, NOW)[2];
    expect(tuesday?.events).toHaveLength(3);
  });

  it("places multi-day all-day events on each covered day and filters meals per day", () => {
    const events = [
      eventFixture({
        id: "trip",
        allDay: true,
        start: "2026-11-23",
        end: "2026-11-25",
      }),
    ];
    const meals = [
      mealFixture({ id: "d", date: "2026-11-23", slot: "dinner" }),
      mealFixture({ id: "b", date: "2026-11-23", slot: "breakfast" }),
      mealFixture({ id: "other", date: "2026-11-24" }),
      mealFixture({ id: "outside", date: "2026-12-30" }),
    ];
    const week = buildWeekModel({ events, meals }, CONFIG, FROM, NOW);
    expect(week.map((day) => day.events.length)).toEqual([0, 1, 1, 0, 0, 0, 0]);
    expect(week[1]?.meals.map((m) => m.id)).toEqual(["b", "d"]);
    expect(week[2]?.meals.map((m) => m.id)).toEqual(["other"]);
  });

  it("assigns events to days in the config zone, not UTC", () => {
    // 23:30 in Berlin on the 23rd is still the 23rd in UTC; 00:30 on the 24th in Berlin is
    // 23:30 UTC on the 23rd.
    const events = [
      eventFixture({
        id: "late",
        start: "2026-11-24T00:30:00+01:00",
        end: "2026-11-24T01:00:00+01:00",
      }),
    ];
    const week = buildWeekModel({ events, meals: [] }, CONFIG, FROM, NOW);
    expect(week[1]?.events).toEqual([]);
    expect(week[2]?.events.map((e) => e.event.id)).toEqual(["late"]);
  });

  it("builds across a DST change (Berlin 2026-10-25) without skipping or repeating a day", () => {
    const week = buildWeekModel(
      { events: [], meals: [] },
      CONFIG,
      "2026-10-22",
      Date.parse("2026-10-22T12:00:00+02:00"),
    );
    expect(week.map((day) => day.date)).toEqual([
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
    ]);
  });
});
