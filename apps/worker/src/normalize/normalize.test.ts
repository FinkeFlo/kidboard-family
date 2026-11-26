import {
  type AppConfig,
  CalendarEventSchema,
  type CalendarSource,
  MealSchema,
  parseConfig,
} from "@kidboard/shared";
import { describe, expect, it } from "vitest";

import dstIcs from "../../../../fixtures/ics/dst.ics?raw";
import { expandCalendar, type Occurrence } from "../ical/expandCalendar";
import {
  limitTitle,
  MAX_ITEMS_PER_SOURCE,
  MAX_TITLE_GRAPHEMES,
  normalize,
  type NormalizeResult,
} from "./normalize";

function makeConfig(): AppConfig {
  const result = parseConfig({
    timeZone: "Europe/Berlin",
    children: [
      { id: "mia", name: "Mia", color: "#0000cc", avatar: "🦊" },
      { id: "ben", name: "Ben", color: "#008800", avatar: "🐻" },
    ],
    calendars: [
      { id: "kinder", kind: "events" },
      { id: "mia-cal", kind: "events", childId: "mia" },
      { id: "essen", kind: "meals" },
    ],
  });
  if (!result.ok) {
    throw new Error(result.errors.join("; "));
  }
  return result.config;
}

const config = makeConfig();
const family: CalendarSource = { id: "kinder", kind: "events" };
const miaCal: CalendarSource = {
  id: "mia-cal",
  kind: "events",
  childId: "mia",
};
const essen: CalendarSource = { id: "essen", kind: "meals" };

function occ(partial: Partial<Occurrence> & { summary: string }): Occurrence {
  return {
    uid: "u1@fixtures.kidboard.invalid",
    recurrenceId: null,
    description: "",
    start: "2026-03-10T15:00:00+01:00",
    end: "2026-03-10T16:00:00+01:00",
    allDay: false,
    ...partial,
  };
}

function allDay(
  summary: string,
  start: string,
  end: string,
  uid = "d1",
): Occurrence {
  return occ({ summary, start, end, allDay: true, uid });
}

function validate(result: Pick<NormalizeResult, "events" | "meals">): void {
  for (const e of result.events) {
    expect(CalendarEventSchema.safeParse(e).success).toBe(true);
  }
  for (const m of result.meals) {
    expect(MealSchema.safeParse(m).success).toBe(true);
  }
}

describe("normalize events", () => {
  it("applies the source child of a per-child calendar", () => {
    const result = normalize([occ({ summary: "⚽ Fußball" })], miaCal, config);
    expect(result.meals).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      title: "Fußball",
      icon: "⚽",
      iconIsFallback: false,
      childIds: ["mia"],
      sourceId: "mia-cal",
      allDay: false,
      countdown: false,
    });
    validate(result);
  });

  it("uses no children (everyone) for a shared calendar without prefix", () => {
    const [event] = normalize(
      [occ({ summary: "🏫 Kita" })],
      family,
      config,
    ).events;
    expect(event?.childIds).toEqual([]);
  });

  it("merges a Name: prefix with the source child (union, no duplicates)", () => {
    const merged = normalize(
      [occ({ summary: "Ben, Mia: 🛁 Baden" })],
      miaCal,
      config,
    );
    expect(merged.events[0]?.childIds).toEqual(["mia", "ben"]);
    const shared = normalize(
      [occ({ summary: "Mia: 🩰 Ballett" })],
      family,
      config,
    );
    expect(shared.events[0]?.childIds).toEqual(["mia"]);
    validate(merged);
  });

  it("lets All: override the child of a per-child source", () => {
    const { events } = normalize(
      [occ({ summary: "Alle: 🎉 Fest" })],
      miaCal,
      config,
    );
    expect(events[0]?.childIds).toEqual([]);
  });

  it("keeps a multi-day all-day event as one event spanning the days", () => {
    const result = normalize(
      [allDay("🏖️ Urlaub", "2026-07-01", "2026-07-05")],
      family,
      config,
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      allDay: true,
      start: "2026-07-01",
      end: "2026-07-05",
    });
    expect(result.meals).toEqual([]);
    validate(result);
  });

  it("sets the countdown flag from the icon and from #countdown", () => {
    const { events } = normalize(
      [
        occ({ uid: "a", summary: "🎂 Geburtstag" }),
        occ({
          uid: "b",
          summary: "Zahnarzt",
          description: "Hinweis #countdown",
        }),
        occ({ uid: "c", summary: "Schwimmen" }),
      ],
      family,
      config,
    );
    const byTitle = Object.fromEntries(
      events.map((e) => [e.title, e.countdown]),
    );
    expect(byTitle).toEqual({
      Geburtstag: true,
      Zahnarzt: true,
      Schwimmen: false,
    });
  });

  it("passes HTML-looking titles through as plain text", () => {
    const { events } = normalize(
      [occ({ summary: "<img src=x onerror=alert(1)> & <b>fett</b>" })],
      family,
      config,
    );
    expect(events[0]?.title).toBe("<img src=x onerror=alert(1)> & <b>fett</b>");
    validate({ events, meals: [] });
  });

  it("drops occurrences that are empty and carry no icon, keeps emoji-only ones", () => {
    const { events } = normalize(
      [
        occ({ uid: "a", summary: "" }),
        occ({ uid: "b", summary: "   " }),
        occ({ uid: "c", summary: "Mia:" }),
        occ({ uid: "d", summary: "🦄" }),
      ],
      family,
      config,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      title: "",
      icon: "🦄",
      iconIsFallback: false,
    });
    validate({ events, meals: [] });
  });

  it("uses the fallback icon for unknown titles", () => {
    const { events } = normalize(
      [occ({ summary: "Irgendwas" })],
      family,
      config,
    );
    expect(events[0]).toMatchObject({ icon: "📅", iconIsFallback: true });
  });

  it("sorts all-day first, then by start, then title", () => {
    const { events } = normalize(
      [
        occ({
          uid: "1",
          summary: "B late",
          start: "2026-03-10T15:00:00+01:00",
        }),
        occ({
          uid: "2",
          summary: "Z early",
          start: "2026-03-10T08:00:00+01:00",
        }),
        occ({
          uid: "3",
          summary: "A late",
          start: "2026-03-10T15:00:00+01:00",
        }),
        allDay("Ganztag", "2026-03-11", "2026-03-12", "4"),
      ],
      family,
      config,
    );
    expect(events.map((e) => e.title)).toEqual([
      "Ganztag",
      "Z early",
      "A late",
      "B late",
    ]);
  });

  it("orders timed events by instant across DST offsets", () => {
    const { events } = normalize(
      [
        occ({
          uid: "1",
          summary: "second",
          start: "2026-10-25T02:30:00+01:00",
        }),
        occ({ uid: "2", summary: "first", start: "2026-10-25T02:45:00+02:00" }),
      ],
      family,
      config,
    );
    expect(events.map((e) => e.title)).toEqual(["first", "second"]);
  });
});

describe("normalize bring lists (T-33)", () => {
  it("sets bring on events from the description, omits it when empty", () => {
    const result = normalize(
      [
        occ({
          uid: "a",
          summary: "🤸 Turnen",
          description: "Halle 2\nMitbringen: 👟 Turnschuhe, 🩱 🧴",
        }),
        occ({ uid: "b", summary: "🏫 Kita", description: "Nur Text" }),
        occ({ uid: "c", summary: "Malen", description: "Bring: Kittel" }),
        occ({ uid: "d", summary: "Musik" }),
      ],
      family,
      config,
    );
    const byTitle = new Map(result.events.map((e) => [e.title, e]));
    expect(byTitle.get("Turnen")?.bring).toEqual(["👟", "🩱", "🧴"]);
    for (const title of ["Kita", "Malen", "Musik"]) {
      expect(byTitle.get(title)).not.toHaveProperty("bring");
    }
    validate(result);
    // Nothing else of the description reaches the DTO.
    const json = JSON.stringify(result);
    for (const fragment of ["Halle", "Mitbringen", "Turnschuhe", "Kittel"]) {
      expect(json).not.toContain(fragment);
    }
  });

  it("supports #countdown and a bring line in one description", () => {
    const { events } = normalize(
      [
        occ({
          summary: "Ausflug",
          description: "#countdown\nBring: 🥪 🧢",
        }),
      ],
      family,
      config,
    );
    expect(events[0]).toMatchObject({ countdown: true, bring: ["🥪", "🧢"] });
  });

  it("gives each occurrence of a series its own copy of the list", () => {
    const description = "Bring: 👟";
    const { events } = normalize(
      [
        occ({ recurrenceId: "r1", description, summary: "Sport" }),
        occ({
          recurrenceId: "r2",
          description,
          summary: "Sport",
          start: "2026-03-17T15:00:00+01:00",
          end: "2026-03-17T16:00:00+01:00",
        }),
      ],
      family,
      config,
    );
    expect(events.map((e) => e.bring)).toEqual([["👟"], ["👟"]]);
    expect(events[0]?.bring).not.toBe(events[1]?.bring);
  });

  it("never sets bring on meals", () => {
    const { meals } = normalize(
      [
        occ({ summary: "Mittag: 🍝 Nudeln", description: "Bring: 🥄 🍴" }),
        allDay("🍲 Suppe", "2026-03-11", "2026-03-13"),
      ],
      essen,
      config,
    );
    expect(meals).toHaveLength(3);
    for (const meal of meals) {
      expect(meal).not.toHaveProperty("bring");
    }
    expect(JSON.stringify(meals)).not.toContain("🥄");
  });
});

describe("normalize meals", () => {
  it("never produces meals for events sources and no events for meals sources", () => {
    expect(
      normalize([occ({ summary: "Mittag: Pasta" })], family, config).meals,
    ).toEqual([]);
    expect(
      normalize([occ({ summary: "Pasta" })], essen, config).events,
    ).toEqual([]);
  });

  it("creates one all-day meal with unspecified slot", () => {
    const result = normalize(
      [allDay("🥣 Müsli", "2026-03-10", "2026-03-11")],
      essen,
      config,
    );
    expect(result.meals).toHaveLength(1);
    expect(result.meals[0]).toMatchObject({
      date: "2026-03-10",
      slot: "unspecified",
      title: "Müsli",
      icon: "🥣",
      iconIsFallback: false,
      sourceId: "essen",
    });
    validate(result);
  });

  it("creates one meal per covered day for multi-day meal events (end exclusive)", () => {
    const { meals } = normalize(
      [allDay("Dinner: Pizza", "2026-03-27", "2026-03-31")],
      essen,
      config,
    );
    expect(meals.map((m) => m.date)).toEqual([
      "2026-03-27",
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
    ]);
    expect(meals.every((m) => m.slot === "dinner" && m.icon === "🍕")).toBe(
      true,
    );
    expect(new Set(meals.map((m) => m.id)).size).toBe(4);
  });

  it("clips multi-day meals to the requested range", () => {
    const { meals } = normalize(
      [allDay("Suppe", "2026-03-01", "2027-03-01")],
      essen,
      config,
      { from: "2026-03-10", to: "2026-03-12" },
    );
    expect(meals.map((m) => m.date)).toEqual(["2026-03-10", "2026-03-11"]);
  });

  it("bounds unbounded multi-day meal events without a range", () => {
    const { meals } = normalize(
      [allDay("Suppe", "2020-01-01", "2030-01-01")],
      essen,
      config,
    );
    expect(meals).toHaveLength(366);
  });

  it("assigns timed meals to slots by band times", () => {
    const at = (uid: string, time: string): Occurrence =>
      occ({
        uid,
        summary: `Essen ${uid}`,
        start: `2026-03-10T${time}+01:00`,
        end: `2026-03-10T${time}+01:00`,
      });
    const { meals } = normalize(
      [
        at("e", "18:00:00"),
        at("a", "07:30:00"),
        at("b", "10:59:00"),
        at("c", "11:00:00"),
        at("d", "16:59:00"),
      ],
      essen,
      config,
    );
    expect(meals.map((m) => [m.title, m.slot])).toEqual([
      ["Essen a", "breakfast"],
      ["Essen b", "breakfast"],
      ["Essen c", "lunch"],
      ["Essen d", "lunch"],
      ["Essen e", "dinner"],
    ]);
    validate({ events: [], meals });
  });

  it("lets a meal prefix win over the band time", () => {
    const { meals } = normalize(
      [
        occ({
          summary: "Frühstück: 🥐 Croissant",
          start: "2026-03-10T18:00:00+01:00",
        }),
      ],
      essen,
      config,
    );
    expect(meals[0]).toMatchObject({
      slot: "breakfast",
      title: "Croissant",
      icon: "🥐",
    });
  });

  it("takes the meal date from the start in the configured zone around DST", () => {
    // 2026-03-28T23:30Z is 00:30 on 2026-03-29 in Berlin (still +01:00, before the gap).
    const lateUtc = occ({
      uid: "a",
      summary: "Snack",
      start: "2026-03-28T23:30:00Z",
      end: "2026-03-29T00:00:00Z",
    });
    // 23:30 CEST on the spring-forward day.
    const spring = occ({
      uid: "b",
      summary: "Spaetessen",
      start: "2026-03-29T23:30:00+02:00",
      end: "2026-03-30T00:00:00+02:00",
    });
    // 00:30 CEST on the fall-back day = 22:30Z the day before.
    const fall = occ({
      uid: "c",
      summary: "Mitternacht",
      start: "2026-10-24T22:30:00Z",
      end: "2026-10-24T23:00:00Z",
    });
    const { meals } = normalize([lateUtc, spring, fall], essen, config);
    expect(meals.map((m) => [m.title, m.date, m.slot])).toEqual([
      ["Snack", "2026-03-29", "breakfast"],
      ["Spaetessen", "2026-03-29", "dinner"],
      ["Mitternacht", "2026-10-25", "breakfast"],
    ]);
  });

  it("sorts meals by date, slot, title", () => {
    const { meals } = normalize(
      [
        allDay("Zeta", "2026-03-11", "2026-03-12", "1"),
        allDay("Dinner: Abend", "2026-03-10", "2026-03-11", "2"),
        allDay("Lunch: Mittag", "2026-03-10", "2026-03-11", "3"),
        allDay("Alpha", "2026-03-10", "2026-03-11", "4"),
        allDay("Breakfast: Brot", "2026-03-10", "2026-03-11", "5"),
      ],
      essen,
      config,
    );
    expect(meals.map((m) => m.title)).toEqual([
      "Brot",
      "Mittag",
      "Abend",
      "Alpha",
      "Zeta",
    ]);
  });
});

describe("normalize ids", () => {
  const items = [
    occ({ uid: "x", summary: "Eins" }),
    occ({
      uid: "x",
      recurrenceId: "2026-03-17T15:00:00+01:00",
      summary: "Eins",
    }),
    occ({ uid: "y", summary: "Zwei" }),
  ];

  it("is identical across runs and independent of input order", () => {
    const first = normalize(items, family, config);
    const second = normalize([...items].reverse(), family, config);
    expect(second).toEqual(first);
    const ids = first.events.map((e) => e.id);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{16}$/);
      expect(id).not.toContain("x");
    }
  });

  it("depends on the source, and meal ids on the date", () => {
    const a = normalize(items, family, config).events.map((e) => e.id);
    const b = normalize(items, { ...family, id: "other" }, config).events.map(
      (e) => e.id,
    );
    expect(a.some((id) => b.includes(id))).toBe(false);

    const meals = normalize(
      [allDay("Suppe", "2026-03-10", "2026-03-12", "m")],
      essen,
      config,
    ).meals;
    const again = normalize(
      [allDay("Suppe", "2026-03-10", "2026-03-12", "m")],
      essen,
      config,
    ).meals;
    expect(again.map((m) => m.id)).toEqual(meals.map((m) => m.id));
    expect(meals[0]?.id).not.toBe(meals[1]?.id);
  });

  it("distinguishes uid-less events by time and summary", () => {
    const { events } = normalize(
      [occ({ uid: "", summary: "A" }), occ({ uid: "", summary: "B" })],
      family,
      config,
    );
    expect(new Set(events.map((e) => e.id)).size).toBe(2);
  });
});

describe("normalize with expandCalendar output", () => {
  it("normalizes the DST fixture end to end", () => {
    const { occurrences } = expandCalendar(dstIcs, {
      from: "2026-03-16",
      to: "2026-04-01",
      timeZone: "Europe/Berlin",
    });
    const first = normalize(occurrences, family, config);
    const second = normalize(occurrences, family, config);
    expect(first.events.length).toBeGreaterThan(3);
    expect(first).toEqual(second);
    expect(first.events.find((e) => e.title === "Early flight")).toMatchObject({
      start: "2026-03-29T03:30:00+02:00",
      icon: "✈️",
      countdown: true,
    });
    validate(first);

    const asMeals = normalize(occurrences, essen, config);
    expect(asMeals.events).toEqual([]);
    expect(asMeals.meals.find((m) => m.title === "Early flight")).toMatchObject(
      {
        date: "2026-03-29",
        slot: "breakfast",
      },
    );
    validate(asMeals);
  });
});

describe("normalize limits", () => {
  it("keeps titles up to the limit and cuts longer ones by graphemes", () => {
    const exact = "a".repeat(MAX_TITLE_GRAPHEMES);
    expect(limitTitle(exact)).toBe(exact);
    const long = "b".repeat(5000);
    const cut = limitTitle(long);
    expect(Array.from(cut)).toHaveLength(MAX_TITLE_GRAPHEMES);
    expect(cut.endsWith("…")).toBe(true);
    // Emoji sequences count as one grapheme and are never split.
    const family = "👨‍👩‍👧‍👦";
    const emojis = family.repeat(MAX_TITLE_GRAPHEMES + 5);
    expect(limitTitle(emojis)).toBe(
      `${family.repeat(MAX_TITLE_GRAPHEMES - 1)}…`,
    );
    // Short in graphemes although long in UTF-16 units: untouched.
    const few = family.repeat(20);
    expect(limitTitle(few)).toBe(few);
  });

  it("limits the title of events and meals", () => {
    const summary = `⚽ ${"x".repeat(1000)}`;
    const events = normalize([occ({ summary })], family, config);
    expect(Array.from(events.events[0]?.title ?? "")).toHaveLength(
      MAX_TITLE_GRAPHEMES,
    );
    const meals = normalize([occ({ summary })], essen, config);
    expect(Array.from(meals.meals[0]?.title ?? "")).toHaveLength(
      MAX_TITLE_GRAPHEMES,
    );
  });

  it("keeps at most MAX_ITEMS_PER_SOURCE items, earliest first, and says so", () => {
    const many = (n: number): Occurrence[] =>
      Array.from({ length: n }, (_, i) =>
        occ({
          summary: `⚽ T${String(i)}`,
          uid: `u${String(i)}`,
          start: new Date(
            Date.UTC(2026, 2, 10, 12, 0, 0) + i * 60_000,
          ).toISOString(),
          end: new Date(
            Date.UTC(2026, 2, 10, 12, 0, 30) + i * 60_000,
          ).toISOString(),
        }),
      );
    const within = normalize(many(MAX_ITEMS_PER_SOURCE), family, config);
    expect(within.events).toHaveLength(MAX_ITEMS_PER_SOURCE);
    expect(within.truncated).toBe(false);

    const over = normalize(many(MAX_ITEMS_PER_SOURCE + 50), family, config);
    expect(over.events).toHaveLength(MAX_ITEMS_PER_SOURCE);
    expect(over.truncated).toBe(true);
    expect(over.events[0]?.title).toBe("T0");
    expect(over.events.at(-1)?.title).toBe(
      `T${String(MAX_ITEMS_PER_SOURCE - 1)}`,
    );
  });

  it("cuts chronologically: far-ahead all-day events do not push out today's timed one", () => {
    const future = Array.from({ length: MAX_ITEMS_PER_SOURCE }, (_, i) =>
      allDay(`🎈 F${String(i)}`, "2026-04-01", "2026-04-02", `f${String(i)}`),
    );
    const today = occ({
      summary: "⚽ Heute",
      uid: "today",
      start: "2026-03-10T15:00:00+01:00",
      end: "2026-03-10T16:00:00+01:00",
    });
    const result = normalize([...future, today], family, config);
    expect(result.truncated).toBe(true);
    expect(result.events).toHaveLength(MAX_ITEMS_PER_SOURCE);
    expect(result.events.some((e) => e.title === "Heute")).toBe(true);
    // Output order stays all-day first.
    expect(result.events[0]?.allDay).toBe(true);
  });
});
