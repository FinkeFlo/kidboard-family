import { describe, expect, it } from "vitest";

import type { EditorGoogleItem, EditorListItem } from "./api";
import { buildTemplates, compareItems } from "./items";

const ZONE = "Europe/Berlin";
/** Monday 2026-03-09, 10:00 in Berlin. */
const NOW = Date.parse("2026-03-09T09:00:00Z");

function google(overrides: Partial<EditorGoogleItem>): EditorGoogleItem {
  return {
    origin: "google",
    id: "g1",
    sourceId: "kinder",
    iconIsFallback: false,
    kind: "event",
    icon: "🩰",
    title: "Ballett",
    childIds: ["mia"],
    allDay: false,
    start: "2026-03-10T15:00:00+01:00",
    end: "2026-03-10T16:00:00+01:00",
    date: "2026-03-10",
    bring: [],
    countdown: false,
    ...overrides,
  };
}

describe("buildTemplates", () => {
  it("skips titles and icons an app entry could not hold", () => {
    const templates = buildTemplates(
      [
        google({ id: "a", title: "" }),
        google({ id: "b", title: "x".repeat(61) }),
        google({ id: "c", icon: "📅", iconIsFallback: true, title: "Ok" }),
        google({ id: "d", icon: "A" }),
      ],
      NOW,
      ZONE,
    );
    expect(templates.map((t) => t.title)).toEqual(["Ok"]);
  });

  it("groups by icon without VS16, title and children (in any order)", () => {
    const templates = buildTemplates(
      [
        google({
          id: "a",
          icon: "⚽\uFE0F",
          title: "Fußball",
          childIds: ["mia", "ben"],
        }),
        google({
          id: "b",
          icon: "⚽",
          title: "Fußball",
          childIds: ["ben", "mia"],
          start: "2026-03-17T15:00:00+01:00",
          end: "2026-03-17T16:00:00+01:00",
        }),
        google({ id: "c", icon: "⚽", title: "Fußball", childIds: ["ben"] }),
      ],
      NOW,
      ZONE,
    );
    expect(templates.map((t) => [t.title, t.childIds, t.count])).toEqual([
      ["Fußball", ["mia", "ben"], 2],
      ["Fußball", ["ben"], 1],
    ]);
  });

  it("takes times from the occurrence nearest to now and drops ends the form cannot hold", () => {
    const [nearest] = buildTemplates(
      [
        google({
          id: "far",
          start: "2026-03-30T09:00:00+02:00",
          end: "2026-03-30T10:00:00+02:00",
        }),
        google({
          id: "near",
          start: "2026-03-09T11:00:00+01:00",
          end: "2026-03-09T11:00:00+01:00",
        }),
      ],
      NOW,
      ZONE,
    );
    expect(nearest).toMatchObject({ startTime: "11:00", count: 2 });
    expect(nearest).not.toHaveProperty("endTime");

    const [overnight] = buildTemplates(
      [
        google({
          start: "2026-03-09T22:00:00+01:00",
          end: "2026-03-10T01:00:00+01:00",
        }),
      ],
      NOW,
      ZONE,
    );
    expect(overnight).toMatchObject({ startTime: "22:00" });
    expect(overnight).not.toHaveProperty("endTime");
  });
});

describe("compareItems", () => {
  it("orders by day, all-day first, time, events before meals, slot, title", () => {
    const items: EditorListItem[] = [
      google({ id: "t2", title: "B", start: "2026-03-10T09:00:00+01:00" }),
      google({
        id: "dinner",
        kind: "meal",
        allDay: true,
        start: "2026-03-10",
        end: "2026-03-11",
        slot: "dinner",
        title: "A",
      }),
      google({ id: "t1", title: "Z", start: "2026-03-10T08:00:00+01:00" }),
      google({
        id: "lunch",
        kind: "meal",
        allDay: true,
        start: "2026-03-10",
        end: "2026-03-11",
        slot: "lunch",
        title: "Z",
      }),
      google({
        id: "allday",
        allDay: true,
        start: "2026-03-10",
        end: "2026-03-11",
        title: "Z",
      }),
      google({
        id: "earlier",
        date: "2026-03-09",
        start: "2026-03-09T23:00:00+01:00",
      }),
    ];
    expect(
      [...items].sort((a, b) => compareItems(a, b, ZONE)).map((i) => i.id),
    ).toEqual(["earlier", "allday", "lunch", "dinner", "t1", "t2"]);
  });
});
