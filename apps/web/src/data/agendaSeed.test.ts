import type { AgendaResponse, CalendarEvent, Meal } from "@kidboard/shared";
import { describe, expect, it } from "vitest";

import {
  type CachedAgenda,
  cachedAgendas,
  eventOverlapsDates,
  pickCoveringAgenda,
  rescopeAgenda,
} from "./agendaSeed";
import { createQueryClient } from "./queryClient";
import { queryKeys } from "./queryKeys";
import { agendaFixture, configFixture } from "./testing.test-utils";

function timed(id: string, start: string, end: string): CalendarEvent {
  return {
    id,
    sourceId: "family",
    title: id,
    icon: "📅",
    iconIsFallback: true,
    childIds: [],
    allDay: false,
    start,
    end,
    countdown: false,
  };
}

function allDay(id: string, start: string, end: string): CalendarEvent {
  return { ...timed(id, start, end), allDay: true };
}

function meal(id: string, date: string): Meal {
  return {
    id,
    sourceId: "food",
    date,
    slot: "lunch",
    title: id,
    icon: "🍝",
    iconIsFallback: false,
  };
}

const ZONE = "Europe/Berlin";

describe("eventOverlapsDates", () => {
  const from = "2026-11-23";
  const to = "2026-11-25";

  it.each([
    // Timed (Berlin is +01:00 in November).
    [
      "ends exactly at the new midnight",
      timed("a", "2026-11-22T22:00:00+01:00", "2026-11-23T00:00:00+01:00"),
      false,
    ],
    [
      "spans the new midnight",
      timed("b", "2026-11-22T23:30:00+01:00", "2026-11-23T00:30:00+01:00"),
      true,
    ],
    [
      "zero-length at the new midnight",
      timed("c", "2026-11-23T00:00:00+01:00", "2026-11-23T00:00:00+01:00"),
      true,
    ],
    [
      "zero-length at the exclusive end",
      timed("d", "2026-11-25T00:00:00+01:00", "2026-11-25T00:00:00+01:00"),
      false,
    ],
    [
      "last minute before the end",
      timed("e", "2026-11-24T23:59:00+01:00", "2026-11-25T00:30:00+01:00"),
      true,
    ],
    [
      "given in another offset",
      timed("f", "2026-11-22T23:30:00Z", "2026-11-22T23:45:00Z"),
      true,
    ],
    // All-day (exclusive end dates).
    [
      "all-day on the previous day",
      allDay("g", "2026-11-22", "2026-11-23"),
      false,
    ],
    [
      "multi-day covering the new day",
      allDay("h", "2026-11-21", "2026-11-24"),
      true,
    ],
    [
      "all-day on the exclusive end",
      allDay("i", "2026-11-25", "2026-11-26"),
      false,
    ],
  ] as const)("%s → %s", (_name, event, expected) => {
    expect(eventOverlapsDates(event, from, to, ZONE)).toBe(expected);
  });

  it("uses the zone's day boundaries on a DST night", () => {
    // Berlin fall back: 2026-10-25 lasts until 2026-10-25T23:00Z.
    const late = timed("late", "2026-10-25T22:30:00Z", "2026-10-25T22:45:00Z");
    expect(eventOverlapsDates(late, "2026-10-26", "2026-10-27", ZONE)).toBe(
      false,
    );
    expect(eventOverlapsDates(late, "2026-10-25", "2026-10-26", ZONE)).toBe(
      true,
    );
  });
});

function cachedAgenda(): AgendaResponse {
  return agendaFixture({
    range: { from: "2026-11-22", to: "2026-11-30" },
    stale: true,
    events: [
      timed(
        "yesterday",
        "2026-11-22T10:00:00+01:00",
        "2026-11-22T11:00:00+01:00",
      ),
      timed(
        "overnight",
        "2026-11-22T23:00:00+01:00",
        "2026-11-23T01:00:00+01:00",
      ),
      timed("today", "2026-11-23T09:00:00+01:00", "2026-11-23T10:00:00+01:00"),
      allDay("trip", "2026-11-21", "2026-11-24"),
      timed("later", "2026-11-29T09:00:00+01:00", "2026-11-29T10:00:00+01:00"),
    ],
    meals: [
      meal("old", "2026-11-22"),
      meal("new", "2026-11-23"),
      meal("last", "2026-11-29"),
    ],
  });
}

describe("rescopeAgenda", () => {
  it("re-scopes to the new day, dropping what lies before it", () => {
    const seeded = rescopeAgenda(cachedAgenda(), {
      from: "2026-11-23",
      days: 8,
    });
    // Requested to 2026-12-01, but the cache only covers up to 2026-11-30.
    expect(seeded?.range).toEqual({ from: "2026-11-23", to: "2026-11-30" });
    expect(seeded?.events.map((e) => e.id)).toEqual([
      "overnight",
      "today",
      "trip",
      "later",
    ]);
    expect(seeded?.meals.map((m) => m.id)).toEqual(["new", "last"]);
    // Health and provenance stay, so the status still reflects the data.
    expect(seeded?.stale).toBe(true);
    expect(seeded?.sources).toEqual(cachedAgenda().sources);
    expect(seeded?.generatedAt).toBe(cachedAgenda().generatedAt);
  });

  it("cuts at the requested end when the cache reaches further", () => {
    const seeded = rescopeAgenda(cachedAgenda(), {
      from: "2026-11-23",
      days: 2,
    });
    expect(seeded?.range).toEqual({ from: "2026-11-23", to: "2026-11-25" });
    expect(seeded?.events.map((e) => e.id)).toEqual([
      "overnight",
      "today",
      "trip",
    ]);
    expect(seeded?.meals.map((m) => m.id)).toEqual(["new"]);
  });

  it("returns undefined when the cache does not cover the new day", () => {
    expect(
      rescopeAgenda(cachedAgenda(), { from: "2026-11-30", days: 8 }),
    ).toBeUndefined();
    expect(
      rescopeAgenda(cachedAgenda(), { from: "2026-11-21", days: 8 }),
    ).toBeUndefined();
  });

  it("re-scopes a 31-day response to the next day as a 30-day seed (T-19)", () => {
    const month = agendaFixture({
      range: { from: "2026-11-22", to: "2026-12-23" },
      events: [
        timed(
          "first",
          "2026-11-22T09:00:00+01:00",
          "2026-11-22T10:00:00+01:00",
        ),
        allDay("party", "2026-12-22", "2026-12-23"),
      ],
      meals: [meal("old", "2026-11-22"), meal("last", "2026-12-22")],
    });
    const seeded = rescopeAgenda(month, { from: "2026-11-23", days: 31 });
    expect(seeded?.range).toEqual({ from: "2026-11-23", to: "2026-12-23" });
    expect(seeded?.events.map((e) => e.id)).toEqual(["party"]);
    expect(seeded?.meals.map((m) => m.id)).toEqual(["last"]);
    // Six days later (offline, within 7 days) it still seeds, now 25 days long.
    expect(
      rescopeAgenda(month, { from: "2026-11-28", days: 31 })?.range,
    ).toEqual({ from: "2026-11-28", to: "2026-12-23" });
  });

  it("does not modify the cached agenda", () => {
    const original = cachedAgenda();
    rescopeAgenda(original, { from: "2026-11-23", days: 8 });
    expect(original).toEqual(cachedAgenda());
  });
});

/** Day 1 at 10:00 Berlin: when the "real" agendas below were fetched. */
const FETCHED_AT = Date.parse("2026-11-22T09:00:00Z");
const DAY_MS = 86_400_000;

describe("pickCoveringAgenda", () => {
  const entry = (
    from: string,
    to: string,
    dataUpdatedAt: number,
  ): CachedAgenda => ({
    data: agendaFixture({ range: { from, to } }),
    dataUpdatedAt,
  });
  const range = { from: "2026-11-23", days: 8 };
  const now = FETCHED_AT + DAY_MS;

  it("picks the most recently fetched agenda that covers the day", () => {
    const older = entry("2026-11-21", "2026-11-29", FETCHED_AT - 1000);
    const newer = entry("2026-11-22", "2026-11-30", FETCHED_AT);
    const notCovering = entry("2026-11-24", "2026-12-02", FETCHED_AT + 1000);
    expect(pickCoveringAgenda([older, notCovering, newer], range, now)).toBe(
      newer,
    );
  });

  it("prefers the one reaching further on equal age", () => {
    const short = entry("2026-11-22", "2026-11-24", FETCHED_AT);
    const long = entry("2026-11-22", "2026-11-30", FETCHED_AT);
    expect(pickCoveringAgenda([short, long], range, now)).toBe(long);
  });

  it("returns undefined when nothing covers the day", () => {
    expect(
      pickCoveringAgenda(
        [entry("2026-11-15", "2026-11-23", FETCHED_AT)],
        range,
        now,
      ),
    ).toBeUndefined();
    expect(pickCoveringAgenda([], range, now)).toBeUndefined();
  });

  it("skips data older than 7 days (the persister's max age)", () => {
    const real = entry("2026-11-22", "2026-11-30", FETCHED_AT);
    const sevenDays = FETCHED_AT + 7 * DAY_MS;
    expect(
      pickCoveringAgenda([real], { from: "2026-11-29", days: 8 }, sevenDays),
    ).toBe(real);
    expect(
      pickCoveringAgenda(
        [real],
        { from: "2026-11-29", days: 8 },
        sevenDays + 1,
      ),
    ).toBeUndefined();
    // An older covering agenda is not a fallback once it is past the limit.
    const ancient = entry("2026-11-14", "2026-11-30", FETCHED_AT - 8 * DAY_MS);
    expect(pickCoveringAgenda([ancient], range, now)).toBeUndefined();
  });

  it("never picks a seed (dataUpdatedAt 0)", () => {
    const seed = entry("2026-11-23", "2026-11-30", 0);
    expect(pickCoveringAgenda([seed], range, now)).toBeUndefined();
  });
});

describe("seedAgenda over several offline days", () => {
  it("seeds every day from the last real response until it is 7 days old", () => {
    const client = createQueryClient({ retry: false });
    client.setQueryData(
      queryKeys.agenda({ from: "2026-11-22", days: 8 }),
      agendaFixture({
        range: { from: "2026-11-22", to: "2026-11-30" },
        events: [
          timed(
            "d23",
            "2026-11-23T09:00:00+01:00",
            "2026-11-23T10:00:00+01:00",
          ),
          timed(
            "d26",
            "2026-11-26T09:00:00+01:00",
            "2026-11-26T10:00:00+01:00",
          ),
          timed(
            "d29",
            "2026-11-29T09:00:00+01:00",
            "2026-11-29T10:00:00+01:00",
          ),
        ],
      }),
      { updatedAt: FETCHED_AT },
    );

    // Day by day, each seed is stored like useAgenda does (dataUpdatedAt 0).
    const days = [
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ];
    days.forEach((from, i) => {
      // Day N, 07:00 Berlin: N days after the fetch, still within 7 days.
      const nowMs = FETCHED_AT + (i + 1) * DAY_MS - 3 * 3_600_000;
      const covering = pickCoveringAgenda(
        cachedAgendas(client),
        { from, days: 8 },
        nowMs,
      );
      expect(covering?.dataUpdatedAt).toBe(FETCHED_AT);
      const seeded =
        covering === undefined
          ? undefined
          : rescopeAgenda(covering.data, { from, days: 8 });
      expect(seeded?.range).toEqual({ from, to: "2026-11-30" });
      expect(seeded?.events.map((e) => e.id)).toEqual(
        ["d23", "d26", "d29"].filter((id) => `2026-11-${id.slice(1)}` >= from),
      );
      client.setQueryData(queryKeys.agenda({ from, days: 8 }), seeded, {
        updatedAt: 0,
      });
    });

    // Day 8 (2026-11-30): outside the real range; the seeds (which reach no further
    // and are not real data) are not used either.
    expect(
      pickCoveringAgenda(
        cachedAgendas(client),
        { from: "2026-11-30", days: 8 },
        FETCHED_AT + 7 * DAY_MS,
      ),
    ).toBeUndefined();
    // A covered day past the 7-day limit gets no seed either.
    expect(
      pickCoveringAgenda(
        cachedAgendas(client),
        { from: "2026-11-29", days: 8 },
        FETCHED_AT + 7 * DAY_MS + 1,
      ),
    ).toBeUndefined();
    client.clear();
  });
});

describe("cachedAgendas", () => {
  it("returns only agenda queries with schema-valid data", () => {
    const client = createQueryClient({ retry: false });
    client.setQueryData(queryKeys.config(), configFixture());
    client.setQueryData(
      queryKeys.agenda({ from: "2026-11-22", days: 8 }),
      agendaFixture(),
    );
    client.setQueryData(queryKeys.agenda({ from: "2026-11-21", days: 8 }), {
      broken: true,
    });
    client.setQueryData(queryKeys.agendaPending(), agendaFixture());
    client.setQueryData(["other", "agenda"], agendaFixture());

    const found = cachedAgendas(client);
    expect(found).toHaveLength(1);
    expect(found[0]?.data.range.from).toBe("2026-11-22");
    expect(found[0]?.dataUpdatedAt).toBeGreaterThan(0);
    client.clear();
  });
});
