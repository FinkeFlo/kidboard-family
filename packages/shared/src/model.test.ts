import { describe, expect, it } from "vitest";

import {
  AgendaResponseSchema,
  CalendarEventSchema,
  ChildSchema,
  MealSchema,
} from "./model";

const timedEvent = {
  id: "e1",
  sourceId: "kinder",
  title: "Kita",
  icon: "🏫",
  iconIsFallback: false,
  childIds: [],
  allDay: false,
  start: "2026-11-23T08:00:00+01:00",
  end: "2026-11-23T12:00:00+01:00",
  countdown: false,
};

describe("CalendarEventSchema", () => {
  it("accepts timed and all-day events", () => {
    expect(CalendarEventSchema.safeParse(timedEvent).success).toBe(true);
    expect(
      CalendarEventSchema.safeParse({
        ...timedEvent,
        allDay: true,
        start: "2026-11-23",
        end: "2026-11-24",
      }).success,
    ).toBe(true);
  });

  it("rejects start/end that do not match allDay", () => {
    const timedAsAllDay = CalendarEventSchema.safeParse({
      ...timedEvent,
      allDay: true,
    });
    expect(timedAsAllDay.success).toBe(false);
    const allDayAsTimed = CalendarEventSchema.safeParse({
      ...timedEvent,
      start: "2026-11-23",
      end: "2026-11-24",
    });
    expect(allDayAsTimed.success).toBe(false);
  });

  it("rejects timed values without offset or invalid dates", () => {
    expect(
      CalendarEventSchema.safeParse({
        ...timedEvent,
        start: "2026-11-23T08:00:00",
      }).success,
    ).toBe(false);
    expect(
      CalendarEventSchema.safeParse({
        ...timedEvent,
        allDay: true,
        start: "2026-02-30",
        end: "2026-03-01",
      }).success,
    ).toBe(false);
  });
});

describe("CalendarEventSchema – bring (T-33)", () => {
  it("accepts an event without bring (old persisted data, old cache entries)", () => {
    const parsed = CalendarEventSchema.parse(timedEvent);
    expect(parsed).not.toHaveProperty("bring");
  });

  it("accepts up to 8 single emoji, ZWJ/flag/keycap included", () => {
    const bring = ["👟", "🩱", "🧴", "👨‍👩‍👧", "🇩🇪", "1️⃣", "👋🏽", "☀️"];
    expect(CalendarEventSchema.parse({ ...timedEvent, bring }).bring).toEqual(
      bring,
    );
  });

  it.each([
    [
      "more than 8 icons",
      ["👟", "🩱", "🧴", "🎨", "🧦", "🍎", "🥤", "📚", "🧢"],
    ],
    ["text", ["Turnschuhe"]],
    ["two emoji in one item", ["👟🩱"]],
    ["a text-style symbol", ["©"]],
    ["HTML", ["<img src=x>"]],
    ["an empty string", [""]],
    ["a non-array", "👟"],
  ])("rejects %s", (_name, bring) => {
    expect(
      CalendarEventSchema.safeParse({ ...timedEvent, bring }).success,
    ).toBe(false);
  });
});

describe("MealSchema / ChildSchema", () => {
  it("validates a meal", () => {
    const meal = {
      id: "m",
      sourceId: "essen",
      date: "2026-11-23",
      slot: "lunch",
      title: "Spaghetti",
      icon: "🍝",
      iconIsFallback: false,
    };
    expect(MealSchema.safeParse(meal).success).toBe(true);
    expect(MealSchema.safeParse({ ...meal, slot: "snack" }).success).toBe(
      false,
    );
    expect(MealSchema.safeParse({ ...meal, date: "23.11.2026" }).success).toBe(
      false,
    );
  });

  it("validates a child", () => {
    expect(
      ChildSchema.safeParse({
        id: "mia",
        name: "Mia",
        color: "#E4572E",
        avatar: "🦊",
      }).success,
    ).toBe(true);
  });

  it.each(["child-1", "child-6", "#abc", "#E4572E", " child-2 "])(
    "accepts the child colour %j",
    (color) => {
      const child = { id: "mia", name: "Mia", color, avatar: "🦊" };
      expect(ChildSchema.safeParse(child).success).toBe(true);
    },
  );

  it.each([
    "red",
    "child-0",
    "child-7",
    "#12",
    "#abcd",
    "#12345678",
    "#ggg",
    "rgb(1, 2, 3)",
    "",
  ])("rejects the child colour %j with a path", (color) => {
    const result = ChildSchema.safeParse({
      id: "mia",
      name: "Mia",
      color,
      avatar: "🦊",
    });
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.path).toEqual(["color"]);
  });
});

describe("AgendaResponseSchema", () => {
  it("validates a response", () => {
    const response = {
      generatedAt: "2026-11-22T10:00:00Z",
      timeZone: "Europe/Berlin",
      range: { from: "2026-11-22", to: "2026-11-29" },
      stale: false,
      sources: [
        { id: "kinder", status: "ok", fetchedAt: "2026-11-22T10:00:00Z" },
        { id: "essen", status: "error" },
      ],
      events: [timedEvent],
      meals: [],
    };
    expect(AgendaResponseSchema.safeParse(response).success).toBe(true);
    // Mixed old (no `bring`) and new events in one agenda.
    expect(
      AgendaResponseSchema.safeParse({
        ...response,
        events: [timedEvent, { ...timedEvent, id: "e2", bring: ["👟"] }],
      }).success,
    ).toBe(true);
    expect(
      AgendaResponseSchema.safeParse({
        ...response,
        sources: [{ id: "x", status: "weird" }],
      }).success,
    ).toBe(false);
  });

  it("accepts an optional boolean truncated flag per source", () => {
    const base = {
      generatedAt: "2026-11-22T10:00:00Z",
      timeZone: "Europe/Berlin",
      range: { from: "2026-11-22", to: "2026-11-29" },
      stale: false,
      events: [],
      meals: [],
    };
    expect(
      AgendaResponseSchema.safeParse({
        ...base,
        sources: [{ id: "kinder", status: "ok", truncated: true }],
      }).success,
    ).toBe(true);
    expect(
      AgendaResponseSchema.safeParse({
        ...base,
        sources: [{ id: "kinder", status: "ok", truncated: "yes" }],
      }).success,
    ).toBe(false);
  });
});
