import { describe, expect, it } from "vitest";

import { EditorEntryInputSchema } from "./entry";
import { editorTestConfig } from "./testConfig.test-utils";
import { parseEditorEntryInput } from "./validate";

const config = editorTestConfig();

const event = {
  kind: "event",
  icon: "🏊",
  title: "Schwimmen",
  allDay: false,
  date: "2026-11-23",
  startTime: "17:00",
};

function issuesOf(value: Record<string, unknown>): string[] {
  const result = EditorEntryInputSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
}

describe("EditorEntryInputSchema", () => {
  it("applies defaults", () => {
    expect(EditorEntryInputSchema.parse(event)).toEqual({
      ...event,
      childIds: [],
      repeat: "none",
      bring: [],
      countdown: false,
    });
  });

  it("normalises the title like parseTitle and limits it to 60 characters", () => {
    expect(
      EditorEntryInputSchema.parse({ ...event, title: "  a   b " }).title,
    ).toBe("a b");
    expect(
      EditorEntryInputSchema.parse({ ...event, title: "x".repeat(60) }).title,
    ).toHaveLength(60);
    expect(issuesOf({ ...event, title: "x".repeat(61) })).toEqual(["title"]);
    expect(issuesOf({ ...event, title: "   " })).toEqual(["title"]);
    expect(issuesOf({ ...event, title: "a\nb" })).toEqual(["title"]);
    expect(issuesOf({ ...event, title: "a b" })).toEqual(["title"]);
    expect(issuesOf({ ...event, title: "a\tb" })).toEqual(["title"]);
  });

  it.each<[string, Record<string, unknown>, string[]]>([
    ["unknown field", { ...event, extra: 1 }, [""]],
    ["icon must be one emoji", { ...event, icon: "🏊🏊" }, ["icon"]],
    ["text icon", { ...event, icon: "A" }, ["icon"]],
    ["bad time", { ...event, startTime: "24:00" }, ["startTime"]],
    ["timed needs a start", { ...event, startTime: undefined }, ["startTime"]],
    ["end after start", { ...event, endTime: "17:00" }, ["endTime"]],
    ["end before start", { ...event, endTime: "16:00" }, ["endTime"]],
    ["endDate needs endTime", { ...event, endDate: "2026-11-24" }, ["endTime"]],
    [
      "timed endDate before date",
      { ...event, endDate: "2026-11-22", endTime: "18:00" },
      ["endDate"],
    ],
    ["all-day has no times", { ...event, allDay: true }, ["startTime"]],
    [
      "all-day end exclusive",
      { ...event, allDay: true, startTime: undefined, endDate: "2026-11-23" },
      ["endDate"],
    ],
    ["bad date", { ...event, date: "2026-02-30" }, ["date"]],
    [
      "too many bring icons",
      {
        ...event,
        bring: ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"],
      },
      ["bring"],
    ],
    [
      "duplicate bring icons (VS16-insensitive)",
      { ...event, bring: ["☀️", "☀️"] },
      ["bring"],
    ],
    [
      "duplicate children",
      { ...event, childIds: ["mia", "mia"] },
      ["childIds"],
    ],
    ["slot on an event", { ...event, slot: "lunch" }, ["slot"]],
    ["meal without slot", { ...event, kind: "meal" }, ["slot"]],
    [
      "meal with children/bring/countdown",
      {
        ...event,
        kind: "meal",
        slot: "lunch",
        childIds: ["mia"],
        bring: ["👟"],
        countdown: true,
      },
      ["childIds", "bring", "countdown"],
    ],
    [
      "weekdays 1-7",
      { ...event, repeat: { weekly: { weekdays: [0] } } },
      ["repeat.weekly.weekdays.0", "repeat"],
    ],
    [
      "weekdays unique",
      { ...event, repeat: { weekly: { weekdays: [1, 1] } } },
      ["repeat.weekly.weekdays"],
    ],
    [
      "interval 1 or 2",
      { ...event, repeat: { weekly: { weekdays: [1], interval: 3 } } },
      ["repeat"],
    ],
    [
      "first date on a weekday of the rule",
      { ...event, repeat: { weekly: { weekdays: [2] } } },
      ["repeat"],
    ],
    [
      "until not before date",
      { ...event, repeat: { weekly: { weekdays: [1], until: "2026-11-22" } } },
      ["repeat"],
    ],
    ["other repeat", { ...event, repeat: "daily" }, ["repeat"]],
  ])("%s", (_label, value, paths) => {
    expect(issuesOf(value)).toEqual(paths);
  });

  it("accepts valid shapes", () => {
    for (const value of [
      {
        ...event,
        endTime: "18:30",
        childIds: ["mia", "ben"],
        bring: ["👟", "🩱"],
        countdown: true,
      },
      { ...event, endDate: "2026-11-24", endTime: "07:00" },
      { ...event, allDay: true, startTime: undefined, endDate: "2026-11-26" },
      {
        ...event,
        repeat: {
          weekly: { weekdays: [1, 7], interval: 2, until: "2026-11-23" },
        },
      },
      {
        ...event,
        kind: "meal",
        slot: "unspecified",
        allDay: true,
        startTime: undefined,
      },
    ]) {
      expect(issuesOf(value), JSON.stringify(value)).toEqual([]);
    }
  });
});

describe("parseEditorEntryInput", () => {
  it("DST gap: rejects an explicit end before the moved start in Los Angeles, accepts the default end", () => {
    const la = editorTestConfig({ timeZone: "America/Los_Angeles" });
    const gap = { ...event, date: "2026-03-08", startTime: "02:15" };
    const bad = parseEditorEntryInput({ ...gap, endTime: "03:00" }, la);
    expect(bad.ok ? [] : bad.issues).toEqual([
      {
        code: "time_range_invalid",
        path: "endTime",
        message: "End must be after start in the configured time zone",
      },
    ]);
    expect(parseEditorEntryInput(gap, la).ok).toBe(true);
    expect(parseEditorEntryInput({ ...gap, endTime: "03:00" }, config).ok).toBe(
      true,
    );
  });

  it("accepts a valid entry", () => {
    expect(
      parseEditorEntryInput({ ...event, childIds: ["mia"] }, config, {
        sourceId: "kinder",
      }),
    ).toMatchObject({ ok: true });
  });

  it.each<[string, Record<string, unknown>, string | undefined, string]>([
    ["shape", { ...event, title: "" }, undefined, "invalid"],
    [
      "unknown child",
      { ...event, childIds: ["nobody"] },
      undefined,
      "unknown_child",
    ],
    [
      "countdown icon needs countdown",
      { ...event, icon: "🎂" },
      undefined,
      "countdown_icon",
    ],
    [
      "unexpressible meal title",
      { ...event, kind: "meal", slot: "unspecified", title: "Mittag: Reste" },
      "essen",
      "title_not_expressible",
    ],
    [
      "children vs calendar",
      { ...event, childIds: ["ben"] },
      "mia-cal",
      "children_not_expressible",
    ],
    ["unknown calendar", event, "nope", "invalid"],
    [
      "DST gap: end before the moved start (Berlin)",
      { ...event, date: "2026-03-29", startTime: "02:30", endTime: "03:00" },
      undefined,
      "time_range_invalid",
    ],
  ])("%s", (_label, value, sourceId, code) => {
    const result = parseEditorEntryInput(value, config, { sourceId });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues.map((i) => i.code)).toContain(code);
  });
});
