import { type AppEntryDto, EditorEntryInputSchema } from "@kidboard/shared";
import { describe, expect, it } from "vitest";

import { entriesOfBackup, planMealCopy } from "./mealCopy";

const TODAY = "2026-11-22";
let counter = 0;

function entry(data: Record<string, unknown>): AppEntryDto {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    revision: 1,
    kind: data["kind"] as "event" | "meal",
    data: EditorEntryInputSchema.parse({ allDay: true, ...data }),
    exdates: [],
    overrides: {},
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
  };
}

function meal(
  date: string,
  slot: string,
  icon: string,
  title: string,
): AppEntryDto {
  return entry({ kind: "meal", date, slot, icon, title });
}

describe("planMealCopy (repeat last week's meals)", () => {
  it("copies the single meals of the last 7 days one week ahead, in day and slot order", () => {
    const plan = planMealCopy(
      [
        meal("2026-11-20", "dinner", "🍕", "Pizza"),
        meal("2026-11-15", "lunch", "🍝", "Spaghetti"),
        meal("2026-11-20", "breakfast", "🥣", "Muesli"),
      ],
      TODAY,
    );
    expect(plan.map((p) => [p.date, p.slot, p.title])).toEqual([
      ["2026-11-22", "lunch", "Spaghetti"],
      ["2026-11-27", "breakfast", "Muesli"],
      ["2026-11-27", "dinner", "Pizza"],
    ]);
    expect(plan[0]).toEqual({
      kind: "meal",
      childIds: [],
      icon: "🍝",
      title: "Spaghetti",
      allDay: true,
      date: "2026-11-22",
      slot: "lunch",
      repeat: "none",
    });
  });

  it("leaves out days outside the window, events and weekly meals", () => {
    const plan = planMealCopy(
      [
        meal("2026-11-14", "lunch", "🍝", "Too early"),
        meal(TODAY, "lunch", "🍝", "Today itself"),
        entry({
          kind: "event",
          date: "2026-11-18",
          icon: "⚽",
          title: "Football",
          allDay: true,
        }),
        entry({
          kind: "meal",
          date: "2026-11-18",
          slot: "dinner",
          icon: "🍲",
          title: "Soup",
          repeat: { weekly: { weekdays: [3], interval: 1 } },
        }),
      ],
      TODAY,
    );
    expect(plan).toEqual([]);
  });

  it("never doubles a planned meal of the day: taken slots are skipped", () => {
    const plan = planMealCopy(
      [
        meal("2026-11-16", "dinner", "🍽️", "Leftovers"),
        // This week's Monday dinner is planned already, with another dish.
        meal("2026-11-23", "dinner", "🍲", "Soup"),
        meal("2026-11-17", "lunch", "🍕", "Pizza"),
        meal("2026-11-18", "breakfast", "🥣", "Muesli"),
      ],
      TODAY,
      // Weekly or Google meals of the editor list.
      [{ date: "2026-11-25", slot: "breakfast" }],
    );
    expect(plan.map((p) => [p.date, p.title])).toEqual([
      ["2026-11-24", "Pizza"],
    ]);
  });

  it("copies every meal of a slot that was free, and only what is missing on a rerun", () => {
    const lastWeek = [
      meal("2026-11-17", "lunch", "🍕", "Pizza"),
      meal("2026-11-17", "lunch", "🥗", "Salad"),
      meal("2026-11-19", "dinner", "🍝", "Spaghetti"),
    ];
    expect(planMealCopy(lastWeek, TODAY).map((p) => p.title)).toEqual([
      "Pizza",
      "Salad",
      "Spaghetti",
    ]);
    // A partial first run copied the lunches only.
    const rerun = planMealCopy(
      [
        ...lastWeek,
        meal("2026-11-24", "lunch", "🍕", "Pizza"),
        meal("2026-11-24", "lunch", "🥗", "Salad"),
      ],
      TODAY,
    );
    expect(rerun.map((p) => [p.date, p.title])).toEqual([
      ["2026-11-26", "Spaghetti"],
    ]);
  });
});

describe("entriesOfBackup", () => {
  it("reads the valid entries of an export and skips broken ones", () => {
    const good = meal("2026-11-20", "dinner", "🍕", "Pizza");
    const text = JSON.stringify({
      format: "kidboard-entries",
      version: 1,
      entries: [good, { id: "broken" }],
    });
    expect(entriesOfBackup(text)).toEqual([good]);
  });

  it("is empty for text that is no backup", () => {
    expect(entriesOfBackup("not json")).toEqual([]);
    expect(entriesOfBackup('{"entries": 3}')).toEqual([]);
  });
});
