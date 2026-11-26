import { expect, type Page, test } from "@playwright/test";

import { demoWeather } from "../demo/demoData";
import {
  clothingPlacement,
  columnAccount,
  expectNoOverflow,
  MEALS,
  minEmojiRem,
} from "./layout";
import {
  agenda,
  at,
  CHILDREN,
  config,
  dateOf,
  mockBoard,
  type MockChild,
  type MockEvent,
  NOW,
} from "./mockApi";

/*
 * Overview density matrix: 1 to 12 timed events in today's column (at the fixed 12:00,
 * the early ones are over, one is current, the rest upcoming), three children (tiles for
 * one, two and three children and for everyone), a long German title, the 📅 fallback,
 * an all-day banner and four meals per day, bring lists (chips) on most events and the
 * all-day banner, the countdown in the header, the weather (T-49: a chip in every column
 * header and today's clothing row with the most items, five); English and German
 * alternate. Both tablet sizes run it as their own project, each count at a
 * pinned burn-in position (the four corners rotate through the counts). Nothing
 * scrolls, overflows or is cut; every event is a tile, in the named "vorbei" strip or
 * in a named "+N": shown + folded + hidden = n.
 */

const LEO: MockChild = {
  id: "leo",
  name: "Leo",
  color: "child-3",
  avatar: "🦁",
};
const KIDS = [...CHILDREN, LEO];
const CHILD_SETS: string[][] = [
  ["mia"],
  ["mia", "ben"],
  ["mia", "ben", "leo"],
  [],
];
const ICONS = [
  "🏊",
  "🦷",
  "📅",
  "🎻",
  "⚽",
  "🎨",
  "🎠",
  "📚",
  "🧸",
  "🚲",
  "🎹",
];
const LONG_TITLE =
  "Kinderturnen in der Sporthalle am Marktplatz mit Elternabend";
/** Bring lists of one to eight icons (ADR-0010 allows up to eight). */
const BRING_LISTS: (string[] | undefined)[] = [
  ["🩱", "🧴", "🥽"],
  ["👟"],
  undefined,
  ["🎨", "👕", "🥤", "🍎", "🧢", "🧤", "🧣", "🧦"],
];
/**
 * The demo forecast with a freezing, wet and snowy today: the clothing row has its most
 * items (🌂 🥾 🧥, the knitted hat, 🧤), so the header is as full as it gets.
 */
function densityWeather(): unknown {
  const weather = demoWeather(dateOf(0), NOW);
  const [today, ...rest] = weather.days;
  if (today === undefined) throw new Error("no forecast day");
  return {
    ...weather,
    days: [
      { ...today, code: 67, feelsMin: -4, rain: true, snow: true },
      ...rest,
    ],
  };
}

/**
 * Today's chip and its clothing pill are on screen: five whole icons on the heading row
 * beside the chip (never wrapped), nothing overlaps.
 */
async function expectWeather(page: Page): Promise<void> {
  const placement = await clothingPlacement(page);
  expect(placement.problems).toEqual([]);
  expect(placement.sameLine).toBe(true);
  const today = page.locator("[data-testid=day-column][data-today=true]");
  await expect(page.getByTestId("weather-chip")).toHaveCount(4);
  await expect(today.getByTestId("weather-chip")).toBeInViewport({ ratio: 1 });
  const items = today.getByTestId("clothing-item");
  await expect(items).toHaveCount(5);
  for (const item of await items.all()) {
    await expect(item).toBeInViewport({ ratio: 1 });
  }
}

/** Burn-in corners (maximum shift on both axes), see burnin.spec.ts. */
const CORNERS = [1, 3, 5, 7] as const;

/**
 * Every bring chip area on the board: whole chips only, inside its tile, and a "+N" that
 * counts exactly the chips not drawn.
 */
async function expectWholeChips(page: Page): Promise<void> {
  const problems = await page.getByTestId("bring-chips").evaluateAll((areas) =>
    areas.flatMap((area) => {
      const tile = area.closest("article");
      if (tile === null) return ["chips outside a tile"];
      const count = Number(area.getAttribute("data-count"));
      const drawn = Number(area.getAttribute("data-drawn"));
      const box = area.getBoundingClientRect();
      const tileBox = tile.getBoundingClientRect();
      const inside = (rect: DOMRect, outer: DOMRect): boolean =>
        rect.left >= outer.left - 0.5 &&
        rect.right <= outer.right + 0.5 &&
        rect.top >= outer.top - 0.5 &&
        rect.bottom <= outer.bottom + 0.5;
      const issues: string[] = [];
      const chips = area.querySelectorAll("[data-testid=bring-chip]");
      if (chips.length !== drawn) issues.push("drawn count");
      for (const chip of chips) {
        const rect = chip.getBoundingClientRect();
        if (!inside(rect, box) || !inside(rect, tileBox)) {
          issues.push(`cut chip ${chip.textContent}`);
        }
      }
      const more = area.querySelector("[data-testid=bring-chips-more]");
      const expected = count - drawn;
      if (
        (more?.textContent ?? "") !==
        (expected > 0 ? `+${String(expected)}` : "")
      ) {
        issues.push(`+N ${more?.textContent ?? ""} for ${String(expected)}`);
      }
      if (more !== null && !inside(more.getBoundingClientRect(), tileBox)) {
        issues.push("+N outside its tile");
      }
      return issues;
    }),
  );
  expect(problems).toEqual([]);
}

/** `count` one-hour events today from 07:00 on, every hour. */
function todayEvents(count: number): MockEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    title: i % 4 === 1 ? LONG_TITLE : `Termin ${String(i + 1)}`,
    icon: ICONS[i % ICONS.length] ?? "📅",
    time: `${String(7 + i).padStart(2, "0")}:00`,
    childIds: CHILD_SETS[i % CHILD_SETS.length] ?? [],
    ...withBring(i),
  }));
}

function withBring(i: number): { bring?: string[] } {
  const bring = BRING_LISTS[i % BRING_LISTS.length];
  return bring === undefined ? {} : { bring };
}

/** A few events on the other overview days, so every column has tiles and plates. */
const OTHER_DAYS: MockEvent[] = [1, 2, 3].flatMap((day) => [
  {
    title: "Kita",
    icon: "🏫",
    time: "08:00",
    day,
    childIds: ["mia", "ben"],
    bring: ["🎨", "👟"],
  },
  {
    title: LONG_TITLE,
    icon: "📅",
    time: "15:00",
    day,
    childIds: ["leo"],
    bring: ["🩱", "🧴", "🥽", "🧢"],
  },
  { title: "Baden", icon: "🛁", time: "18:30", day },
]);
const ALL_DAY: MockEvent = {
  title: "Ausflug in den Zoo",
  icon: "🦁",
  time: null,
  childIds: ["mia", "ben", "leo"],
  bring: ["🧢", "🥪"],
};
const COUNTDOWN: MockEvent = {
  title: "Geburtstag",
  icon: "🎂",
  time: null,
  day: 9,
  countdown: true,
  childIds: ["mia"],
};

for (let count = 1; count <= 12; count += 1) {
  const locale = count % 2 === 0 ? "de" : "en";
  const corner = CORNERS[count % CORNERS.length] ?? 1;
  test(`${String(count)} events today (${locale}, burn-in corner ${String(corner)}) fit without loss`, async ({
    page,
  }) => {
    const events = todayEvents(count);
    await mockBoard(page, {
      config: config({ locale, children: KIDS, weather: true }),
      agenda: agenda(
        [ALL_DAY, COUNTDOWN, ...events, ...OTHER_DAYS],
        MEALS.filter((meal) => meal.day < 4),
      ),
      weather: densityWeather(),
    });
    await page.goto(`/?burnin=${String(corner)}`);
    await expect(page.getByTestId("board-ready")).toBeVisible();
    const today = page.locator("[data-testid=day-column][data-today=true]");
    await expect(today.getByTestId("event-tile").first()).toBeVisible();
    // The weather loads after the agenda and makes the header taller: count after it.
    await expect(today.getByTestId("clothing-item")).toHaveCount(5);

    const account = await columnAccount(today);
    // No loss: every event is a tile, folded into the strip or summed up in "+N".
    expect(account.shown.length + account.folded + account.hidden).toBe(count);
    for (const event of events) {
      const named =
        account.shown.some((name) => name.startsWith(event.title)) ||
        account.stripName.includes(event.title) ||
        account.hiddenText.includes(event.title);
      expect(named, event.title).toBe(true);
    }
    // Up to four events: nothing upcoming is summed up at either size.
    if (count <= 4) expect(account.hidden).toBe(0);
    // "+N" only when the free space below could not take one more (slim) tile: with
    // one event summed up its tile would replace the "+N" row, else come on top.
    if (account.hidden > 0) {
      const free = await today.getByTestId("column-events").evaluate((list) => {
        const rem = parseFloat(
          getComputedStyle(document.documentElement).fontSize,
        );
        const bottom =
          list.getBoundingClientRect().bottom -
          parseFloat(getComputedStyle(list).paddingBottom);
        const last = list.lastElementChild?.getBoundingClientRect().bottom;
        return (bottom - (last ?? bottom)) / rem;
      });
      // Slim tile 2.75rem, list gap 0.5rem, "+N" row 2.25rem.
      const needed = account.hidden === 1 ? 2.75 - 2.25 : 2.75 + 0.5;
      expect(free).toBeLessThan(needed);
    }
    // The current event (12:00) is never folded or summed up.
    if (count >= 6) {
      await expect(
        today.locator("article[data-status=current]"),
      ).toBeInViewport({ ratio: 1 });
    }
    for (const tile of await today.getByRole("article").all()) {
      await expect(tile).toBeInViewport({ ratio: 1 });
    }
    // Today's emoji: large tiles at least 3.5rem, medium 3rem, dense 2.75rem, slim 2rem.
    const sizes = await today
      .getByTestId("column-events")
      .getByTestId("event-tile")
      .evaluateAll((tiles) => {
        const rem = parseFloat(
          getComputedStyle(document.documentElement).fontSize,
        );
        return tiles.map((tile) => ({
          size: tile.getAttribute("data-size") ?? "",
          rem:
            parseFloat(
              getComputedStyle(tile.querySelector(".font-emoji") as Element)
                .fontSize,
            ) / rem,
        }));
      });
    for (const size of sizes) {
      expect(size.rem).toBeGreaterThanOrEqual(minEmojiRem(size.size) - 0.01);
    }
    // One rule for the past: either every past event is a tile or none is.
    const pastTiles = await today.locator("article[data-status=past]").count();
    if (account.folded > 0) expect(pastTiles).toBe(0);
    // Every plate of every column is on screen.
    for (const plate of await page
      .getByTestId("meal-plates")
      .getByRole("img")
      .all()) {
      await expect(plate).toBeInViewport({ ratio: 1 });
    }
    await expect(
      page.getByTestId("all-day").first().getByRole("article"),
    ).toBeInViewport({ ratio: 1 });
    // Upcoming tiles carry their bring chips, past ones none (chips are never cut).
    await expect(
      today.locator("article[data-status=past] [data-testid=bring-chips]"),
    ).toHaveCount(0);
    await expectWholeChips(page);
    await expectWeather(page);
    await expectNoOverflow(page);
  });
}

/**
 * The evening density case (M9 click test): at eveningStart, 12 events today, the 🎒 area
 * for both children and five clothing items for tomorrow, led by tomorrow's weather. The
 * heading row stays one line, so the 🎒 area keeps the rows it has without weather.
 */
test("evening: 🎒 for both children and five clothing items keep the bring rows", async ({
  page,
}) => {
  const evening = at("17:00");
  const weather = demoWeather(dateOf(0), evening);
  const [first, tomorrow, ...rest] = weather.days;
  if (first === undefined || tomorrow === undefined) throw new Error("days");
  const frosty = {
    ...weather,
    days: [
      first,
      { ...tomorrow, code: 73, feelsMin: -4, feelsMax: 0, snow: true },
      ...rest,
    ],
  };
  const events: MockEvent[] = [
    ...todayEvents(12),
    {
      title: "Schwimmen",
      icon: "🏊",
      time: "07:30",
      day: 1,
      childIds: ["mia"],
      bring: ["🩱", "🧴", "🥽", "🧢"],
    },
    {
      title: "Turnen",
      icon: "🤸",
      time: "09:30",
      day: 1,
      childIds: ["ben"],
      bring: ["👟", "👕", "🩳"],
    },
  ];
  const bringRows = async (withWeather: boolean): Promise<string | null> => {
    await mockBoard(page, {
      config: config({ locale: "de", weather: withWeather }),
      agenda: agenda(
        events,
        MEALS.filter((meal) => meal.day < 4),
      ),
      ...(withWeather ? { weather: frosty } : {}),
      now: evening,
    });
    await page.goto("/");
    await expect(page.getByTestId("board-ready")).toBeVisible();
    const column = page.locator("[data-testid=day-column][data-today=true]");
    await expect(column.getByTestId("bring-area")).toBeVisible();
    await expect(column.getByTestId("bring-group")).toHaveCount(2);
    if (withWeather) {
      await expect(column.getByTestId("clothing-item")).toHaveCount(5);
      await expect(column.getByTestId("clothing-forecast")).toBeVisible();
    }
    return column.getByTestId("bring-area").getAttribute("data-rows");
  };

  const without = await bringRows(false);
  await page.unrouteAll();
  const rows = await bringRows(true);
  expect(without).toBe("2");
  expect(rows).toBe(without);
  const placement = await clothingPlacement(page);
  expect(placement.problems).toEqual([]);
  expect(placement.sameLine).toBe(true);
  expect(placement.iconRem).toBeGreaterThanOrEqual(1.5);
  const today = page.locator("[data-testid=day-column][data-today=true]");
  const account = await columnAccount(today);
  expect(account.shown.length + account.folded + account.hidden).toBe(12);
  await expectWholeChips(page);
  await expectNoOverflow(page);
});

/**
 * All-day event of the week matrix, for two children: a three-child all-day `week-slim`
 * tile overflows its row by a few pixels without any bring list (known, not part of this
 * check).
 */
const WEEK_ALL_DAY: MockEvent = { ...ALL_DAY, childIds: ["mia", "ben"] };

for (let count = 1; count <= 12; count += 1) {
  const locale = count % 2 === 0 ? "de" : "en";
  test(`week: ${String(count)} events today with bring lists (${locale}) fit without loss`, async ({
    page,
  }) => {
    await mockBoard(page, {
      config: config({ locale, children: KIDS, weather: true }),
      agenda: agenda(
        [WEEK_ALL_DAY, COUNTDOWN, ...todayEvents(count), ...OTHER_DAYS],
        MEALS,
      ),
      weather: densityWeather(),
    });
    await page.goto("/");
    await page
      .getByRole("button", { name: locale === "de" ? "Woche" : "Week" })
      .click();
    await expect(page.getByTestId("day-column")).toHaveCount(7);
    const today = page.locator("[data-testid=day-column][data-today=true]");
    await expect(today.getByTestId("event-tile").first()).toBeVisible();
    // Every header carries its weather line; count after it arrived.
    await expect(page.getByTestId("week-weather")).toHaveCount(7);
    // Week tiles with a bring list get a chip row (taller); still nothing is lost.
    const account = await columnAccount(today);
    expect(account.shown.length + account.folded + account.hidden).toBe(
      count + 1,
    );
    await expect(
      page.locator("article[data-bring=row] [data-testid=bring-chips]").first(),
    ).toBeVisible();
    // Every header's weather chip (seven forecast days) is on screen.
    for (const chip of await page.getByTestId("weather-chip").all()) {
      await expect(chip).toBeInViewport({ ratio: 1 });
    }
    await expect(
      today.locator("article[data-status=past] [data-testid=bring-chips]"),
    ).toHaveCount(0);
    await expectWholeChips(page);
    await expectNoOverflow(page);
  });
}

test("a crowded day folds the past into the strip first, then sums up the latest", async ({
  page,
}) => {
  const events = todayEvents(12);
  await mockBoard(page, {
    config: config({ children: KIDS }),
    agenda: agenda([ALL_DAY, ...events, ...OTHER_DAYS], MEALS),
  });
  await page.goto("/");
  const today = page.locator("[data-testid=day-column][data-today=true]");
  await expect(today.getByTestId("past-strip")).toBeVisible();
  const account = await columnAccount(today);
  // 07:00-11:00 are over at 12:00: the strip names all of them.
  expect(account.folded).toBe(5);
  expect(account.stripName).toMatch(/^Already over: /);
  for (const event of events.slice(0, 5)) {
    expect(account.stripName).toContain(event.title);
  }
  // Nothing past takes a tile while the strip holds them; what comes next stays.
  await expect(today.locator("article[data-status=past]")).toHaveCount(0);
  await expect(today.locator("article[data-status=current]")).toHaveCount(1);
  await expect(today.locator("article[data-next=true]")).toBeInViewport({
    ratio: 1,
  });
  if (account.hidden > 0) {
    const more = today.getByTestId("column-more");
    await expect(more.getByTestId("column-more-count")).toHaveText(
      `+${String(account.hidden)}`,
    );
    // The summed-up events show as small icons; "+N" is no button.
    await expect(more.locator(".font-emoji")).toHaveCount(
      Math.min(account.hidden, 4),
    );
    await expect(today.getByRole("button")).toHaveCount(0);
    expect(account.hiddenText).toMatch(
      new RegExp(`^${String(account.hidden)} more later: `),
    );
    // The summed-up ones are the latest.
    for (const event of events.slice(12 - account.hidden)) {
      expect(account.hiddenText).toContain(event.title);
    }
  }
  expect(account.shown.length + account.folded + account.hidden).toBe(12);
  await expectNoOverflow(page);
});
