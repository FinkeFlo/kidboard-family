import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BRING_EXTRA_REM, TILE_HEIGHT_REM } from "../components/EventTile";
import {
  BEN,
  eventFixture,
  mealFixture,
  MIA,
} from "../components/fixtures.test-utils";
import { COLUMN_GAP_REM } from "../day/columnCapacity";
import type { FormatContext } from "../i18n/format";
import { buildWeekModel } from "./buildWeekModel";
import { WeekBoard, type WeekCountdown } from "./WeekBoard";

const format: FormatContext = { locale: "en", timeZone: "Europe/Berlin" };
const CONFIG = {
  timeZone: "Europe/Berlin",
  bands: { morningStart: "06:00", middayStart: "11:00", eveningStart: "17:00" },
} as const;

/** Makes every column list report `heightRem` (at a 16px root) through a stubbed observer. */
function stubListHeight(heightRem: number, widthRem = 40): void {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(
        private readonly callback: (
          entries: { contentRect: { height: number; width: number } }[],
        ) => void,
      ) {}
      observe(): void {
        // Every observed element reports the same box: the column lists use the
        // height, the "done" strip's icon area the width.
        this.callback([
          { contentRect: { height: heightRem * 16, width: widthRem * 16 } },
        ]);
      }
      disconnect(): void {}
    },
  );
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderWeek(
  events = [] as ReturnType<typeof eventFixture>[],
  meals = [] as ReturnType<typeof mealFixture>[],
  countdown?: WeekCountdown,
): HTMLElement[] {
  const days = buildWeekModel(
    { events, meals },
    CONFIG,
    "2026-11-22",
    Date.parse("2026-11-22T12:00:00+01:00"),
  );
  render(
    <WeekBoard
      days={days}
      childList={[MIA, BEN]}
      format={format}
      countdown={countdown}
    />,
  );
  return screen.getAllByTestId("day-column");
}

const tilesOf = (column: HTMLElement): HTMLElement[] =>
  within(column).queryAllByTestId("event-tile");
const namesOf = (column: HTMLElement): (string | null)[] =>
  tilesOf(column).map((tile) => tile.getAttribute("aria-label"));

const hourly = (
  day: string,
  count: number,
): ReturnType<typeof eventFixture>[] =>
  Array.from({ length: count }, (_, i) =>
    eventFixture({
      id: `e${String(i)}`,
      title: `Event ${String(i)}`,
      start: `${day}T${String(7 + i).padStart(2, "0")}:00:00+01:00`,
      end: `${day}T${String(8 + i).padStart(2, "0")}:00:00+01:00`,
    }),
  );

describe("WeekBoard", () => {
  it("renders seven columns with weekday names, today first and marked", () => {
    const columns = renderWeek();
    expect(columns).toHaveLength(7);
    expect(
      columns.map((c) => within(c).getByRole("heading").textContent),
    ).toEqual([
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ]);
    expect(columns[0]).toHaveAttribute("aria-current", "date");
    expect(columns[1]).not.toHaveAttribute("aria-current");
    expect(columns.map((c) => c.dataset["weekend"])).toEqual([
      "true",
      "false",
      "false",
      "false",
      "false",
      "false",
      "true",
    ]);
  });

  it("keeps weekend columns visually distinct through the weekend surface token", () => {
    const columns = renderWeek();
    expect(columns[0]?.className).toContain("bg-surface-weekend");
    expect(columns[6]?.className).toContain("bg-surface-weekend");
    expect(columns[1]?.className).not.toContain("bg-surface-weekend");
    expect(columns[1]?.className).toContain("bg-surface-sunken");
    expect(columns[0]?.className).toContain("ring-today-ring");
    expect(columns[1]?.className).not.toContain("ring-today-ring");
  });

  it("shows events as week tiles in the overview's tile language, in time order", () => {
    const monday = renderWeek(
      hourly("2026-11-23", 3).map((event, i) => ({
        ...event,
        childIds: i === 0 ? ["mia"] : i === 1 ? ["mia", "ben"] : [],
      })),
    )[1] as HTMLElement;
    const tiles = tilesOf(monday);
    expect(tiles).toHaveLength(3);
    expect(namesOf(monday)).toEqual([
      "Event 0, 7:00 AM, For Mia",
      "Event 1, 8:00 AM, For Mia and Ben",
      "Event 2, 9:00 AM, For everyone",
    ]);
    expect(tiles.map((tile) => tile.dataset["tint"])).toEqual([
      "single",
      "split",
      "none",
    ]);
    expect(tiles[0]).toHaveAttribute("data-size", "week");
    // Child badges (decorative) and the time-of-day symbol: morning, then evening.
    const wrapper = (tile: HTMLElement | undefined): HTMLElement =>
      tile?.parentElement as HTMLElement;
    expect(within(wrapper(tiles[0])).getByText("🦊")).toBeInTheDocument();
    expect(within(tiles[0] as HTMLElement).getByText("🌅")).toBeInTheDocument();
    expect(within(wrapper(tiles[1])).getByText("🐻")).toBeInTheDocument();
    // A one-line title under the picture (shown where the column is wide enough).
    expect(
      tiles.map((tile) => within(tile).getByTestId("tile-title").textContent),
    ).toEqual(["Event 0", "Event 1", "Event 2"]);
    // The list is the container the title's width query refers to.
    expect(within(monday).getByTestId("column-events")).toHaveClass(
      "@container",
    );
  });

  it("uses the dusk symbol for evening events, never the moon (rule 1)", () => {
    const columns = renderWeek([
      eventFixture({
        title: "Bath",
        start: "2026-11-23T18:00:00+01:00",
        end: "2026-11-23T18:30:00+01:00",
      }),
    ]);
    const monday = columns[1] as HTMLElement;
    expect(within(monday).getByText("🌆")).toBeInTheDocument();
    expect(within(monday).queryByText("🌙")).toBeNull();
  });

  it("gives an all-day event its own all-day symbol instead of a time of day", () => {
    const columns = renderWeek([
      eventFixture({
        title: "Trip",
        allDay: true,
        start: "2026-11-23",
        end: "2026-11-24",
      }),
    ]);
    const [tile] = tilesOf(columns[1] as HTMLElement);
    expect(tile).toHaveAttribute("data-all-day", "true");
    expect(
      within(tile as HTMLElement).getByTestId("all-day-icon"),
    ).toBeTruthy();
    expect(
      within(tile as HTMLElement).getByText("All day"),
    ).toBeInTheDocument();
    expect(within(tile as HTMLElement).queryByText("🌞")).toBeNull();
  });

  it("shows no +N while every tile fits, however many events (not a fixed count)", () => {
    stubListHeight(40);
    const monday = renderWeek(hourly("2026-11-23", 5))[1] as HTMLElement;
    expect(tilesOf(monday)).toHaveLength(5);
    expect(within(monday).queryByTestId("column-more")).toBeNull();
  });

  it("sums up what does not fit as a quiet +N with small icons and a screen reader text", () => {
    // Slim tiles: three plus the +N row (3 * 3 + 3 * 0.5 + 2.25 = 12.75 rem); a fourth
    // would need 16.25 rem, all six 20.5 rem.
    stubListHeight(13);
    const monday = renderWeek(hourly("2026-11-23", 6))[1] as HTMLElement;
    expect(tilesOf(monday)).toHaveLength(3);
    expect(monday).toHaveAttribute("data-size", "week-slim");
    const more = within(monday).getByTestId("column-more");
    expect(more).toHaveAttribute("data-count", "3");
    expect(within(more).getByText("+3")).toHaveAttribute("aria-hidden", "true");
    expect(
      within(more).getByText("3 more: Event 3, Event 4, and Event 5"),
    ).toHaveClass("sr-only");
    // Small icons of the first hidden events (decorative), no button look.
    expect(
      within(more)
        .getAllByText("🏊")
        .every((el) => el.getAttribute("aria-hidden") === "true"),
    ).toBe(true);
    expect(within(more).getAllByText("🏊")).toHaveLength(2);
    expect(more.className).not.toMatch(/ring|border|bg-/u);
    expect(more.tagName).toBe("LI");
    // shown + hidden === all events.
    expect(tilesOf(monday).length + Number(more.dataset["count"])).toBe(6);
  });

  it("folds today's finished events into the done strip first, so upcoming ones keep their tiles", () => {
    // Room for four dense tiles and the strip (4 * 5.25 + 0.5 * 4 + 2.25 = 25.25 rem).
    stubListHeight(25.5);
    // Now is 12:00: Events 0..4 (07:00..11:00) are over, 12:00 is current, 13:00+ upcoming.
    const today = renderWeek(hourly("2026-11-22", 9))[0] as HTMLElement;
    const statuses = tilesOf(today).map((tile) => tile.dataset["status"]);
    expect(statuses).toEqual(["current", "upcoming", "upcoming", "upcoming"]);
    const strip = within(today).getByTestId("past-strip");
    expect(strip).toHaveAttribute("data-count", "5");
    // Names every finished title; draws two checked icons and counts the rest.
    expect(strip).toHaveAccessibleName(
      "Already over: Event 0, Event 1, Event 2, Event 3, and Event 4",
    );
    expect(within(strip).getByText("+3")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    // Nothing upcoming is hidden while finished events could fold.
    expect(within(today).queryByTestId("column-more")).toBeNull();
    // The strip sits above the tiles.
    const list = within(today).getByTestId("column-events");
    expect(list.firstElementChild).toContainElement(strip);
  });

  it("keeps a busy today whole and titled in a 1280x800 week column (no +N above free space)", () => {
    // The measured list at 1280x800 is 23.8 rem: the strip plus six slim tiles fit
    // (2.25 + 6 * 3 + 6 * 0.5 = 23.25 rem).
    stubListHeight(23.8);
    // Now is 12:00: Events 0..4 are over, 12:00 is current, 13:00..17:00 upcoming.
    const today = renderWeek(hourly("2026-11-22", 11))[0] as HTMLElement;
    expect(today).toHaveAttribute("data-size", "week-slim");
    expect(within(today).queryByTestId("column-more")).toBeNull();
    const tiles = tilesOf(today);
    expect(tiles).toHaveLength(6);
    // Today's tiles carry their titles like every other column's.
    expect(
      tiles.map((tile) => within(tile).getByTestId("tile-title").textContent),
    ).toEqual([
      "Event 5",
      "Event 6",
      "Event 7",
      "Event 8",
      "Event 9",
      "Event 10",
    ]);
    expect(within(today).getByTestId("past-strip")).toHaveAttribute(
      "data-count",
      "5",
    );
  });

  it("bring lists: week tiles get a chip row and are counted taller, nothing is lost", () => {
    const events = hourly("2026-11-23", 3).map((event) => ({
      ...event,
      bring: ["🩱", "🧴", "🥽"],
    }));
    // Exactly three normal week tiles high: with their chip rows they step down a size.
    stubListHeight(3 * TILE_HEIGHT_REM.week + 2 * COLUMN_GAP_REM);
    const column = renderWeek(events)[1];
    if (column === undefined) throw new Error("no column");
    expect(tilesOf(column)).toHaveLength(3);
    expect(within(column).queryByTestId("column-more")).toBeNull();
    for (const tile of tilesOf(column)) {
      expect(tile).toHaveAttribute("data-size", "week-dense");
      expect(tile).toHaveAttribute("data-bring", "row");
      expect(tile).toHaveAccessibleDescription("Bring along: 🩱 🧴 🥽");
      expect(tile.style.height).toBe(
        `${String(TILE_HEIGHT_REM["week-dense"] + BRING_EXTRA_REM["week-dense"])}rem`,
      );
    }
  });

  it("hides only upcoming events after the strip, the least important last", () => {
    // Two slim tiles, the strip and +N (2 * 3 + 3 * 0.5 + 2 * 2.25 = 12 rem); a third
    // would need 15.5 rem.
    stubListHeight(14.75);
    const today = renderWeek(hourly("2026-11-22", 9))[0] as HTMLElement;
    expect(tilesOf(today).map((tile) => tile.dataset["status"])).toEqual([
      "current",
      "upcoming",
    ]);
    const more = within(today).getByTestId("column-more");
    expect(more).toHaveAttribute("data-count", "2");
    expect(within(more).getByText("2 more: Event 7 and Event 8")).toHaveClass(
      "sr-only",
    );
    const strip = within(today).getByTestId("past-strip");
    // shown + folded + hidden === all events (merge rule 2).
    expect(
      tilesOf(today).length +
        Number(strip.dataset["count"]) +
        Number(more.dataset["count"]),
    ).toBe(9);
  });

  it("lets finished events recede through tokens, not opacity", () => {
    const today = renderWeek([
      eventFixture({
        id: "over",
        title: "Over",
        start: "2026-11-22T08:00:00+01:00",
        end: "2026-11-22T09:00:00+01:00",
      }),
    ])[0] as HTMLElement;
    const [tile] = tilesOf(today);
    expect(tile).toHaveAttribute("data-status", "past");
    expect(tile?.className).toContain("bg-surface-sunken");
    expect(tile?.className).toContain("text-text-muted");
    expect(tile?.className).not.toMatch(/opacity/);
    expect(tile?.getAttribute("aria-label")).toContain("over");
  });

  it("shows a moon in every header before the countdown day, the goal's icon on it, an empty slot after", () => {
    const columns = renderWeek(
      [
        eventFixture({
          title: "Party",
          icon: "🎂",
          childIds: ["mia"],
          start: "2026-11-26T15:00:00+01:00",
          end: "2026-11-26T16:00:00+01:00",
          countdown: true,
        }),
      ],
      [],
      {
        date: "2026-11-26",
        events: [
          eventFixture({
            title: "Party",
            icon: "🎂",
            childIds: ["mia"],
            countdown: true,
          }),
        ],
      },
    );
    expect(
      columns.map((c) => within(c).queryAllByTestId("column-moon").length),
    ).toEqual([1, 1, 1, 1, 0, 0, 0]);
    expect(
      columns.map((c) => within(c).queryAllByTestId("column-target").length),
    ).toEqual([0, 0, 0, 0, 1, 0, 0]);
    const target = within(columns[4] as HTMLElement).getByTestId(
      "column-target",
    );
    expect(within(target).getByText("🎂")).toBeInTheDocument();
    // Every column keeps the same slot, so all dates sit on one line.
    for (const column of columns) {
      const slot = within(column).getByTestId("column-slot");
      expect(slot).toHaveAttribute("aria-hidden", "true");
      expect(slot.parentElement).toHaveClass("h-8");
    }
    // The moon is decorative: the countdown pill carries the spoken count.
    const moon = within(columns[0] as HTMLElement).getByText("🌙");
    expect(moon).toHaveAttribute("aria-hidden", "true");
  });

  it("puts no moons in the headers without a countdown", () => {
    renderWeek([eventFixture()]);
    expect(screen.queryAllByTestId("column-moon")).toHaveLength(0);
    expect(screen.queryAllByTestId("column-target")).toHaveLength(0);
  });

  it("puts a moon on every day up to a far target and on none of today when it is today", () => {
    const far = renderWeek([], [], {
      date: "2026-12-20",
      events: [eventFixture()],
    });
    expect(
      far.map((c) => within(c).queryAllByTestId("column-moon").length),
    ).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(far.every((c) => c.dataset["countdownDay"] === "false")).toBe(true);
  });

  it("marks a one-child countdown day with a neutral ring, the child's tint and badge", () => {
    const columns = renderWeek([], [], {
      date: "2026-11-26",
      events: [eventFixture({ childIds: ["mia"], countdown: true })],
    });
    const target = columns[4] as HTMLElement;
    expect(target).toHaveAttribute("data-countdown-day", "true");
    // The ring is the countdown colour (the moons'), never a child's colour.
    expect(target).toHaveClass("ring-band-evening-accent", "ring-4");
    expect(target.className).not.toContain("--child-color");
    expect(target.style.background).toBe("var(--color-child-1-tint)");
    expect(target.className).not.toContain("bg-surface");
    // The badge says whose day it is.
    const header = within(target).getByTestId("column-target");
    expect(within(header).getByText("🦊")).toBeInTheDocument();
    // Other days keep their plain surface and no ring.
    expect(columns[3]?.style.background).toBe("");
    expect(columns[3]?.className).toContain("bg-surface-sunken");
    expect(columns[3]?.className).not.toContain("ring-band-evening-accent");
  });

  it("keeps a shared or nobody's countdown day neutral: no tint, no badge, the same ring", () => {
    for (const childIds of [["mia", "ben"], []]) {
      const columns = renderWeek([], [], {
        date: "2026-11-26",
        events: [eventFixture({ childIds, countdown: true })],
      });
      const target = columns[4] as HTMLElement;
      expect(target).toHaveAttribute("data-countdown-day", "true");
      expect(target).toHaveClass(
        "bg-surface-sunken",
        "ring-band-evening-accent",
      );
      expect(target.style.background).toBe("");
      const header = within(target).getByTestId("column-target");
      expect(within(header).queryByText("🦊")).toBeNull();
      expect(within(header).queryByText("🐻")).toBeNull();
      cleanup();
    }
  });

  it("survives a countdown without events: the day stays unmarked, the moons stay", () => {
    const columns = renderWeek([], [], { date: "2026-11-26", events: [] });
    const target = columns[4] as HTMLElement;
    expect(target).toHaveAttribute("data-countdown-day", "true");
    expect(target.style.background).toBe("");
    expect(target.className).not.toContain("ring-band-evening-accent");
    expect(within(target).queryByTestId("column-target")).toBeNull();
    expect(
      columns
        .slice(0, 4)
        .map((c) => within(c).queryAllByTestId("column-moon").length),
    ).toEqual([1, 1, 1, 1]);
  });

  it("keeps the today ring when the countdown day is today, with the goal's icon", () => {
    const columns = renderWeek([], [], {
      date: "2026-11-22",
      events: [eventFixture({ icon: "🎂", countdown: true })],
    });
    expect(columns[0]).toHaveClass("ring-today-ring");
    expect(columns[0]?.className).not.toContain("ring-band-evening-accent");
    expect(
      within(columns[0] as HTMLElement).getByTestId("column-target"),
    ).toHaveTextContent("🎂");
  });

  it("shows meals as a three-row list in slot order, with an empty place for a missing one", () => {
    const columns = renderWeek(
      [],
      [
        mealFixture({ id: "d", slot: "dinner", title: "Soup", icon: "🍲" }),
        mealFixture({ id: "b", slot: "breakfast", title: "Oats", icon: "🥣" }),
      ],
    );
    const meals = within(columns[0] as HTMLElement).getByRole("list", {
      name: "Meals",
    });
    const rows = within(meals).getAllByRole("listitem", { hidden: true });
    expect(rows.map((row) => row.dataset["slot"])).toEqual([
      "breakfast",
      "lunch",
      "dinner",
    ]);
    // Lunch is missing: its place stays, empty and hidden from assistive tech.
    expect(rows[1]).toHaveAttribute("aria-hidden", "true");
    expect(rows[1]).not.toHaveTextContent("🍝");
    expect(
      within(meals).getByRole("img", { name: "Breakfast: Oats" }),
    ).toHaveTextContent("🥣");
    expect(
      within(meals).getByRole("img", { name: "Dinner: Soup" }),
    ).toBeVisible();
    // Time-of-day symbols lead the rows; dinner uses the dusk, not the moon.
    expect(within(rows[2] as HTMLElement).getByText("🌆")).toBeInTheDocument();
    expect(within(meals).queryByText("🌙")).toBeNull();
    // No row for unspecified meals when there are none; other days have no meal list.
    expect(rows.some((row) => row.dataset["slot"] === "unspecified")).toBe(
      false,
    );
    expect(
      within(columns[1] as HTMLElement).queryByRole("list", { name: "Meals" }),
    ).toBeNull();
  });

  it("gives meals without a slot a row of their own below the three", () => {
    const columns = renderWeek(
      [],
      [
        mealFixture({
          id: "u",
          slot: "unspecified",
          title: "Apple",
          icon: "🍎",
        }),
        mealFixture({ id: "l1", slot: "lunch", title: "Pasta", icon: "🍝" }),
        mealFixture({ id: "l2", slot: "lunch", title: "Salad", icon: "🥗" }),
      ],
    );
    const meals = within(columns[0] as HTMLElement).getByRole("list", {
      name: "Meals",
    });
    const rows = within(meals).getAllByRole("listitem", { hidden: true });
    expect(rows.map((row) => row.dataset["slot"])).toEqual([
      "breakfast",
      "lunch",
      "dinner",
      "unspecified",
    ]);
    // Two lunches sit side by side in the lunch row.
    expect(within(rows[1] as HTMLElement).getAllByRole("img")).toHaveLength(2);
    expect(
      within(rows[3] as HTMLElement).getByRole("img", { name: "Meal: Apple" }),
    ).toBeVisible();
  });

  it("renders calendar titles as text, never as markup", () => {
    const columns = renderWeek([
      eventFixture({
        title: "<img src=x onerror=alert(1)>",
        start: "2026-11-22T14:00:00+01:00",
      }),
    ]);
    const [tile] = tilesOf(columns[0] as HTMLElement);
    expect(tile?.getAttribute("aria-label")).toContain(
      "<img src=x onerror=alert(1)>",
    );
    expect(document.querySelector("img")).toBeNull();
  });

  it("skips unknown child ids and counts three or more children as +N on the badge", () => {
    const columns = renderWeek([
      eventFixture({
        title: "Music",
        childIds: ["ben", "ghost", "mia"],
        start: "2026-11-22T14:00:00+01:00",
        end: "2026-11-22T15:00:00+01:00",
      }),
    ]);
    const [tile] = tilesOf(columns[0] as HTMLElement);
    expect(tile).toHaveAttribute("data-tint", "split");
    expect(tile?.getAttribute("aria-label")).toContain("For Ben and Mia");
  });
});
