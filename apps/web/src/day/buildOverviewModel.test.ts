import { describe, expect, it } from "vitest";

import { eventFixture, mealFixture } from "../components/fixtures.test-utils";
import { buildDayModel, type DayModelConfig } from "./buildDayModel";
import { buildOverviewModel, OVERVIEW_DAYS } from "./buildOverviewModel";

const CONFIG: DayModelConfig = {
  timeZone: "Europe/Berlin",
  bands: { morningStart: "06:00", middayStart: "11:00", eveningStart: "17:00" },
};
const TODAY = "2026-11-22";
const at = (time: string, day = TODAY): string => `${day}T${time}:00+01:00`;
const ms = (time: string): number => Date.parse(at(time));

function timed(id: string, start: string, end: string, day = TODAY) {
  return eventFixture({
    id,
    title: id,
    start: at(start, day),
    end: at(end, day),
  });
}

describe("buildDayModel timeOfDay", () => {
  it("derives the time of day from the band; night and carried-over count as morning", () => {
    const model = buildDayModel(
      {
        events: [
          timed("night", "04:00", "05:00"),
          timed("morning", "08:00", "09:00"),
          timed("midday", "12:00", "13:00"),
          timed("evening", "18:00", "19:00"),
          eventFixture({
            id: "carry",
            title: "carry",
            start: "2026-11-21T22:00:00+01:00",
            end: "2026-11-22T07:00:00+01:00",
          }),
          eventFixture({
            id: "trip",
            title: "trip",
            allDay: true,
            start: "2026-11-22",
            end: "2026-11-23",
          }),
        ],
        meals: [],
      },
      CONFIG,
      TODAY,
      ms("12:00"),
    );
    const byId = Object.fromEntries(
      model.bands
        .flatMap((band) => band.events)
        .map((item) => [item.event.id, item.timeOfDay]),
    );
    expect(byId).toEqual({
      night: "morning",
      morning: "morning",
      carry: "morning",
      midday: "midday",
      evening: "evening",
    });
    expect(model.allDay[0]?.timeOfDay).toBeNull();
  });
});

describe("buildOverviewModel", () => {
  const agenda = {
    events: [
      timed("late", "18:00", "19:00"),
      timed("breakfast-club", "08:00", "09:00"),
      timed("long", "09:00", "13:00"),
      timed("soon", "14:00", "15:00"),
      timed("tomorrow", "10:00", "11:00", "2026-11-23"),
      timed("far", "10:00", "11:00", "2026-11-26"),
      eventFixture({
        id: "holiday",
        title: "holiday",
        allDay: true,
        start: "2026-11-24",
        end: "2026-11-26",
      }),
    ],
    meals: [
      mealFixture({ date: TODAY, slot: "dinner" }),
      mealFixture({ date: TODAY, slot: "breakfast" }),
      mealFixture({ date: "2026-11-25", slot: "lunch" }),
    ],
  };

  it("returns today plus the next three days", () => {
    const model = buildOverviewModel(agenda, CONFIG, TODAY, ms("10:00"));
    expect(OVERVIEW_DAYS).toBe(4);
    expect(model.days.map((d) => d.date)).toEqual([
      "2026-11-22",
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
    ]);
    expect(model.days.map((d) => d.isToday)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    // The event on 26 Nov is out of range.
    expect(
      model.days.flatMap((d) => d.events).map((i) => i.event.id),
    ).not.toContain("far");
  });

  it("matches buildDayModel per day, flattened in time order", () => {
    const now = ms("10:00");
    const model = buildOverviewModel(agenda, CONFIG, TODAY, now);
    for (const day of model.days) {
      const single = buildDayModel(agenda, CONFIG, day.date, now);
      expect(day.events).toEqual(single.bands.flatMap((b) => b.events));
      expect(day.allDay).toEqual(single.allDay);
      expect(day.meals).toEqual(single.meals);
      expect(day.isEmpty).toBe(single.isEmpty);
    }
    expect(model.days[0]?.events.map((i) => i.event.id)).toEqual([
      "breakfast-club",
      "long",
      "soon",
      "late",
    ]);
    expect(model.days[0]?.meals.map((m) => m.slot)).toEqual([
      "breakfast",
      "dinner",
    ]);
    expect(model.days[2]?.allDay.map((i) => i.event.id)).toEqual(["holiday"]);
    expect(model.days[3]?.allDay.map((i) => i.event.id)).toEqual(["holiday"]);
    expect(model.days[3]?.isEmpty).toBe(false);
  });

  it("places the now line, current and next event on today only", () => {
    const model = buildOverviewModel(agenda, CONFIG, TODAY, ms("10:00"));
    const today = model.days[0];
    // breakfast-club (over) and long (under way) have started.
    expect(today?.nowIndex).toBe(2);
    expect(today?.current.map((i) => i.event.id)).toEqual(["long"]);
    expect(today?.next?.event.id).toBe("soon");
    for (const other of model.days.slice(1)) {
      expect(other.nowIndex).toBeNull();
      expect(other.current).toEqual([]);
      expect(other.next).toBeNull();
    }
  });

  it("reports several current events and the line at both ends of the day", () => {
    const overlap = {
      events: [
        timed("a", "10:00", "12:00"),
        timed("b", "10:30", "11:30"),
        timed("c", "15:00", "16:00"),
      ],
      meals: [],
    };
    const mid = buildOverviewModel(overlap, CONFIG, TODAY, ms("11:00")).days[0];
    expect(mid?.current.map((i) => i.event.id)).toEqual(["a", "b"]);
    expect(mid?.next?.event.id).toBe("c");

    const early = buildOverviewModel(overlap, CONFIG, TODAY, ms("05:00"))
      .days[0];
    expect(early?.nowIndex).toBe(0);
    expect(early?.current).toEqual([]);
    expect(early?.next?.event.id).toBe("a");

    const late = buildOverviewModel(overlap, CONFIG, TODAY, ms("20:00"))
      .days[0];
    expect(late?.nowIndex).toBe(3);
    expect(late?.next).toBeNull();
    expect(late?.current).toEqual([]);
  });

  it("counts carried-over events as started and keeps empty days empty", () => {
    const carry = {
      events: [
        eventFixture({
          id: "carry",
          title: "carry",
          start: "2026-11-21T22:00:00+01:00",
          end: "2026-11-22T07:00:00+01:00",
        }),
      ],
      meals: [],
    };
    const day = buildOverviewModel(carry, CONFIG, TODAY, ms("06:30")).days[0];
    expect(day?.nowIndex).toBe(1);
    expect(day?.current[0]?.continues).toBe(true);
    const empty = buildOverviewModel(
      { events: [], meals: [] },
      CONFIG,
      TODAY,
      ms("09:00"),
    );
    expect(empty.days.every((d) => d.isEmpty && d.events.length === 0)).toBe(
      true,
    );
    expect(empty.days[0]?.nowIndex).toBe(0);
  });

  it("uses the configured zone across the month end and DST change", () => {
    // 28 Mar 2026 is the day before the CET -> CEST switch in Europe/Berlin.
    const model = buildOverviewModel(
      {
        events: [
          // 02:30 does not exist on 29 Mar; 10:00 CEST is +02:00.
          eventFixture({
            id: "dst",
            title: "dst",
            start: "2026-03-29T10:00:00+02:00",
            end: "2026-03-29T11:00:00+02:00",
          }),
        ],
        meals: [],
      },
      CONFIG,
      "2026-03-28",
      Date.parse("2026-03-28T12:00:00+01:00"),
    );
    expect(model.days[1]?.events.map((i) => i.event.id)).toEqual(["dst"]);
    expect(model.days[1]?.events[0]?.timeOfDay).toBe("morning");
    expect(model.days.map((d) => d.date)).toEqual([
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
      "2026-03-31",
    ]);
    const nye = buildOverviewModel(
      { events: [], meals: [] },
      CONFIG,
      "2026-12-30",
      ms("09:00"),
    );
    expect(nye.days.map((d) => d.date)).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });
});
