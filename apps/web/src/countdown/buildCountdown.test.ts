import type { AgendaResponse, CalendarEvent } from "@kidboard/shared";
import { describe, expect, it } from "vitest";

import { eventFixture } from "../components/fixtures.test-utils";
import { rescopeAgenda } from "../data/agendaSeed";
import { buildCountdown, COUNTDOWN_MAX_NIGHTS } from "./buildCountdown";

const BERLIN = "Europe/Berlin";
const TODAY = "2026-11-22";

function countdownEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
  return eventFixture({ countdown: true, icon: "🎂", ...overrides });
}

function allDay(id: string, date: string, end?: string): CalendarEvent {
  return countdownEvent({
    id,
    title: id,
    allDay: true,
    start: date,
    end: end ?? date,
  });
}

function timed(id: string, start: string, end?: string): CalendarEvent {
  return countdownEvent({ id, title: id, start, end: end ?? start });
}

const ids = (events: readonly CalendarEvent[] | undefined): string[] =>
  (events ?? []).map((e) => e.id);

describe("buildCountdown – selection", () => {
  it("returns undefined without countdown events", () => {
    expect(buildCountdown([], TODAY, BERLIN)).toBeUndefined();
    const plain = eventFixture({ start: "2026-11-24T10:00:00+01:00" });
    expect(buildCountdown([plain], TODAY, BERLIN)).toBeUndefined();
  });

  it("picks the nearest upcoming countdown event, regardless of feed order", () => {
    const result = buildCountdown(
      [
        allDay("christmas", "2026-12-24", "2026-12-25"),
        timed("party", "2026-11-25T15:00:00+01:00"),
        allDay("trip", "2026-12-01", "2026-12-03"),
      ],
      TODAY,
      BERLIN,
    );
    expect(result).toMatchObject({ date: "2026-11-25", nights: 3 });
    expect(ids(result?.events)).toEqual(["party"]);
  });

  it("gives 0 nights for an event today and 1 for tomorrow", () => {
    expect(
      buildCountdown([allDay("today", TODAY, "2026-11-23")], TODAY, BERLIN),
    ).toMatchObject({ date: TODAY, nights: 0 });
    expect(
      buildCountdown(
        [timed("tomorrow", "2026-11-23T00:00:00+01:00")],
        TODAY,
        BERLIN,
      ),
    ).toMatchObject({ date: "2026-11-23", nights: 1 });
  });

  it("keeps the today state all day, also after a timed event has ended", () => {
    // Party 09:00-10:00 today; the clock does not matter, only the calendar day.
    const result = buildCountdown(
      [
        timed(
          "party",
          "2026-11-22T09:00:00+01:00",
          "2026-11-22T10:00:00+01:00",
        ),
        timed("later", "2026-11-30T09:00:00+01:00"),
      ],
      TODAY,
      BERLIN,
    );
    expect(result?.nights).toBe(0);
    expect(ids(result?.events)).toEqual(["party"]);
  });

  it("skips an event in progress (started earlier) for the next upcoming one", () => {
    const holiday = allDay("holiday", "2026-11-20", "2026-12-05");
    const sleepover = timed(
      "sleepover",
      "2026-11-21T18:00:00+01:00",
      "2026-11-22T10:00:00+01:00",
    );
    const next = allDay("nikolaus", "2026-12-06", "2026-12-07");
    expect(buildCountdown([holiday, sleepover], TODAY, BERLIN)).toBeUndefined();
    expect(
      buildCountdown([holiday, sleepover, next], TODAY, BERLIN),
    ).toMatchObject({ date: "2026-12-06", nights: 14 });
  });

  it("looks exactly 30 nights ahead, not further", () => {
    expect(COUNTDOWN_MAX_NIGHTS).toBe(30);
    expect(
      buildCountdown([allDay("in", "2026-12-22")], TODAY, BERLIN)?.nights,
    ).toBe(30);
    expect(
      buildCountdown([allDay("out", "2026-12-23")], TODAY, BERLIN),
    ).toBeUndefined();
    expect(
      buildCountdown(
        [timed("out-timed", "2026-12-23T00:00:00+01:00")],
        TODAY,
        BERLIN,
      ),
    ).toBeUndefined();
  });

  it("joins several countdown events on the nearest day: all-day first, then by time, then title", () => {
    const result = buildCountdown(
      [
        timed("zoo", "2026-11-24T15:00:00+01:00"),
        timed("cake", "2026-11-24T09:00:00+01:00"),
        allDay("birthday", "2026-11-24", "2026-11-25"),
        allDay("advent", "2026-11-24", "2026-11-25"),
        timed("cinema", "2026-11-24T09:00:00+01:00"),
        allDay("later", "2026-11-26", "2026-11-27"),
      ],
      TODAY,
      BERLIN,
    );
    expect(result).toMatchObject({ date: "2026-11-24", nights: 2 });
    expect(ids(result?.events)).toEqual([
      "advent",
      "birthday",
      "cake",
      "cinema",
      "zoo",
    ]);
  });

  it("does not modify the input", () => {
    const events = [
      timed("b", "2026-11-24T15:00:00+01:00"),
      timed("a", "2026-11-24T09:00:00+01:00"),
    ];
    const copy = structuredClone(events);
    buildCountdown(events, TODAY, BERLIN);
    expect(events).toEqual(copy);
  });
});

describe("buildCountdown – time zones and DST", () => {
  it("takes the start date in the config zone, not UTC or the device zone", () => {
    // 2026-11-23 23:30 UTC is already the 24th in Berlin, still the 23rd in New York.
    const event = timed("late", "2026-11-23T23:30:00Z");
    expect(buildCountdown([event], TODAY, BERLIN)).toMatchObject({
      date: "2026-11-24",
      nights: 2,
    });
    expect(buildCountdown([event], TODAY, "America/New_York")).toMatchObject({
      date: "2026-11-23",
      nights: 1,
    });
  });

  it("counts calendar days across spring-forward (23 h day)", () => {
    // Berlin skips 02:00-03:00 on Sunday 2026-03-29. 47.5 elapsed hours, but 2 nights.
    const today = "2026-03-28";
    expect(
      buildCountdown(
        [timed("monday", "2026-03-30T00:30:00+02:00")],
        today,
        BERLIN,
      ),
    ).toMatchObject({ date: "2026-03-30", nights: 2 });
    expect(
      buildCountdown(
        [timed("sunday-late", "2026-03-29T23:30:00+02:00")],
        today,
        BERLIN,
      ),
    ).toMatchObject({ date: "2026-03-29", nights: 1 });
    // From the DST day itself, 30 nights ahead is still in, 31 is out.
    expect(
      buildCountdown([allDay("in", "2026-04-28")], "2026-03-29", BERLIN)
        ?.nights,
    ).toBe(30);
    expect(
      buildCountdown([allDay("out", "2026-04-29")], "2026-03-29", BERLIN),
    ).toBeUndefined();
  });

  it("counts calendar days across fall-back (25 h day)", () => {
    // Berlin repeats 02:00-03:00 on Sunday 2026-10-25. 48.5 elapsed hours, but 1 night.
    const today = "2026-10-24";
    expect(
      buildCountdown(
        [timed("sunday-late", "2026-10-25T23:30:00+01:00")],
        today,
        BERLIN,
      ),
    ).toMatchObject({ date: "2026-10-25", nights: 1 });
    // The repeated hour itself (02:30 in summer and in winter time) is still Sunday.
    expect(
      buildCountdown(
        [
          timed("first-0230", "2026-10-25T02:30:00+02:00"),
          timed("second-0230", "2026-10-25T02:30:00+01:00"),
        ],
        today,
        BERLIN,
      ),
    ).toMatchObject({ date: "2026-10-25", nights: 1 });
    expect(
      buildCountdown([allDay("halloween", "2026-10-31")], today, BERLIN)
        ?.nights,
    ).toBe(7);
  });
});

describe("buildCountdown – from a midnight seed", () => {
  it("still counts down from the 30-day seed after midnight, one night less", () => {
    const agenda: AgendaResponse = {
      generatedAt: "2026-11-22T08:00:00+01:00",
      timeZone: BERLIN,
      range: { from: TODAY, to: "2026-12-23" },
      stale: false,
      sources: [{ id: "family", status: "ok" }],
      // On the last day the 31-day response covers: 30 nights ahead.
      events: [allDay("christmas-party", "2026-12-22", "2026-12-23")],
      meals: [],
    };
    expect(buildCountdown(agenda.events, TODAY, BERLIN)).toMatchObject({
      date: "2026-12-22",
      nights: 30,
    });
    // After midnight (offline) the new day is seeded from the old response: the range
    // shrinks to 30 days (stale until the real response lands, see connectionStatus).
    const seed = rescopeAgenda(agenda, { from: "2026-11-23", days: 31 });
    expect(seed?.range).toEqual({ from: "2026-11-23", to: "2026-12-23" });
    expect(buildCountdown(seed?.events ?? [], "2026-11-23", BERLIN)).toEqual({
      date: "2026-12-22",
      nights: 29,
      events: agenda.events,
    });
  });
});
