import { expect, type Locator, type Page, test } from "@playwright/test";

import { columnAccount, expectNoOverflow } from "./layout";
import {
  agenda,
  at,
  CHILDREN,
  config,
  dateOf,
  mockBoard,
  type MockChild,
  type MockEvent,
  setNow,
} from "./mockApi";

/*
 * The evening-before 🎒 area (T-36) on a fixed clock (device zone America/Los_Angeles,
 * config zone Europe/Berlin): absent before eveningStart (17:00), "Pack for tomorrow"
 * from it, "Today bring" after midnight without a reload, an event's icons gone once it
 * started; only in today's overview column, never in the week view; a head that says
 * the day (evening: "→ Mon Tomorrow"), then one row of whole chips per child that fits
 * the column without scrolling, light and night.
 */

const SHOT_DIR = process.env["E2E_SCREENSHOT_DIR"];

const MEALS = [0, 1, 2, 3, 4].flatMap((day) => [
  { slot: "breakfast", title: "Oatmeal with berries", icon: "🥣", day },
  { slot: "lunch", title: "Spaghetti with tomato sauce", icon: "🍝", day },
  { slot: "dinner", title: "Vegetable soup and bread", icon: "🍲", day },
]);

/** Today without bring lists (so nothing is packed before eveningStart); tomorrow with. */
const EVENTS: MockEvent[] = [
  { title: "Kindergarten", icon: "🏫", time: "08:30", childIds: ["ben"] },
  { title: "Lunch with Grandma", icon: "👵", time: "12:30" },
  { title: "Piano", icon: "🎹", time: "16:30", childIds: ["mia"] },
  { title: "Bath time", icon: "🛁", time: "18:00" },
  { title: "Story time", icon: "📖", time: "20:15" },
  {
    title: "Swimming",
    icon: "🏊",
    time: "07:30",
    day: 1,
    childIds: ["mia"],
    bring: ["🩱", "🧴", "🥽"],
  },
  {
    title: "Library",
    icon: "📚",
    time: "09:00",
    day: 1,
    childIds: ["mia", "ben"],
    bring: ["📕"],
  },
  {
    title: "Football",
    icon: "⚽",
    time: "15:00",
    day: 1,
    childIds: ["ben"],
    bring: ["👟", "🧦"],
  },
  { title: "Dentist", icon: "🦷", time: "09:00", day: 2 },
];

const EVENING_NAME = "Pack for tomorrow: Mia 🩱 🧴 🥽 📕 and Ben 📕 👟 🧦";

/** The same data as the worker sends it the next day (range from tomorrow). */
function nextDayAgenda(events: MockEvent[]): unknown {
  const base = agenda(
    events.filter((event) => (event.day ?? 0) >= 1),
    MEALS.filter((meal) => meal.day >= 1),
  ) as Record<string, unknown>;
  return { ...base, range: { from: dateOf(1), to: dateOf(32) } };
}

const todayColumn = (page: Page): Locator =>
  page.locator("[data-testid=day-column][data-today=true]");

async function shot(page: Page, name: string, project: string): Promise<void> {
  if (SHOT_DIR !== undefined) {
    await page.screenshot({ path: `${SHOT_DIR}/${name}-${project}.png` });
  }
}

/**
 * The area lies in today's column between its event list and the meals, inside it and
 * never taller than it; every chip is whole and inside its row and the area; each
 * group's "+N" counts exactly the icons it does not draw.
 */
async function expectAreaLayout(page: Page): Promise<void> {
  const report = await todayColumn(page).evaluate((column) => {
    const problems: string[] = [];
    const area = column.querySelector("[data-testid=bring-area]");
    const list = column.querySelector("[data-testid=column-events]");
    const plates = column.querySelector("[data-testid=meal-plates]");
    const row = column.querySelector("[data-testid=bring-groups]");
    if (area === null || list === null || plates === null || row === null) {
      return ["missing part"];
    }
    const inside = (rect: DOMRect, outer: DOMRect): boolean =>
      rect.left >= outer.left - 0.5 &&
      rect.right <= outer.right + 0.5 &&
      rect.top >= outer.top - 0.5 &&
      rect.bottom <= outer.bottom + 0.5;
    const box = area.getBoundingClientRect();
    if (!inside(box, column.getBoundingClientRect())) problems.push("area out");
    if (box.height > column.getBoundingClientRect().height / 2)
      problems.push("area taller than half the column");
    if (box.top < list.getBoundingClientRect().bottom - 0.5)
      problems.push("area over the list");
    if (box.bottom > plates.getBoundingClientRect().top + 0.5)
      problems.push("area over the meals");
    const rowBox = row.getBoundingClientRect();
    if (!inside(rowBox, box)) problems.push("rows out of the area");
    for (const line of row.querySelectorAll("[data-testid=bring-area-row]")) {
      const lineBox = line.getBoundingClientRect();
      if (!inside(lineBox, box)) problems.push("row out of the area");
      for (const chip of line.querySelectorAll(
        "[data-testid=bring-area-chip]",
      )) {
        if (!inside(chip.getBoundingClientRect(), lineBox)) {
          problems.push(`cut chip ${chip.textContent}`);
        }
      }
    }
    for (const group of row.querySelectorAll<HTMLElement>(
      "[data-testid=bring-group]",
    )) {
      if (!inside(group.getBoundingClientRect(), rowBox)) {
        problems.push(`cut group ${group.dataset["child"] ?? ""}`);
      }
      const count = Number(group.dataset["count"]);
      const drawn = Number(group.dataset["drawn"]);
      const chips = group.querySelectorAll("[data-testid=bring-area-chip]");
      if (chips.length !== drawn) problems.push("drawn count");
      const more = group.querySelector("[data-testid=bring-group-more]");
      const expected = count - drawn;
      if (
        (more?.textContent ?? "") !==
        (expected > 0 ? `+${String(expected)}` : "")
      ) {
        problems.push(`+N ${more?.textContent ?? ""} for ${String(expected)}`);
      }
    }
    if (area.scrollHeight > area.clientHeight + 1) problems.push("area h");
    return problems;
  });
  expect(report).toEqual([]);
}

for (const night of [false, true]) {
  const mode = night ? "night" : "light";
  test(`evening before, next morning, after the start (${mode})`, async ({
    page,
  }, testInfo) => {
    const project = testInfo.project.name;
    const api = await mockBoard(page, {
      agenda: agenda(EVENTS, MEALS),
      now: at("16:59"),
    });
    await page.goto(`/?night=${night ? "1" : "0"}`);
    await expect(page.getByTestId("board-ready")).toBeVisible();
    await expect(page.getByTestId("bring-area")).toHaveCount(0);

    // eveningStart: tomorrow's bring lists, per child in config order.
    await setNow(page, at("17:00"));
    const area = todayColumn(page).getByRole("region", { name: EVENING_NAME });
    await expect(area).toBeVisible();
    await expect(area).toHaveAttribute("data-when", "tomorrow");
    await expect(page.getByTestId("bring-area")).toHaveCount(1);
    await expect(area.locator(".font-emoji").first()).toHaveText("🎒");
    // The day it is for: an arrow, tomorrow's short weekday (Monday) and "Tomorrow".
    await expect(area.getByTestId("bring-arrow")).toBeVisible();
    await expect(area.getByTestId("bring-day")).toHaveText("Mon");
    await expect(area.getByTestId("bring-cue")).toHaveText("Tomorrow");
    await expect(area.getByTestId("bring-group")).toHaveCount(2);
    // One row per child, every icon drawn: no "+N" hides what a child needs.
    await expect(area.getByTestId("bring-area-row")).toHaveCount(2);
    await expect(area.getByTestId("bring-area-chip")).toHaveCount(7);
    await expect(area.getByTestId("bring-group-more")).toHaveCount(0);
    expect(
      await area
        .getByTestId("bring-group")
        .evaluateAll((groups) =>
          groups.map((group) => group.getAttribute("data-child")),
        ),
    ).toEqual(["mia", "ben"]);
    // Not a live region, nothing to touch.
    await expect(area).not.toHaveAttribute("aria-live");
    await expect(area.locator("[aria-live], button, a")).toHaveCount(0);

    await setNow(page, at("19:40"));
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      night ? "night" : "light",
    );
    await expect(area).toBeVisible();
    await expectAreaLayout(page);
    await expectNoOverflow(page);
    await shot(page, `bring-evening-${mode}`, project);

    // The week view has no area.
    await page.getByRole("button", { name: "Week" }).click();
    await expect(page.getByTestId("week-board")).toBeVisible();
    await expect(page.getByTestId("bring-area")).toHaveCount(0);
    await page.getByRole("button", { name: "Today" }).click();
    await expect(area).toBeVisible();

    // Midnight: today's not yet started events, no reload (the worker now sends the
    // agenda from the new day).
    api.agenda = nextDayAgenda(EVENTS);
    await setNow(page, at("00:00", 1));
    const morning = todayColumn(page).getByRole("region", {
      name: "Today bring: Mia 🩱 🧴 🥽 📕 and Ben 📕 👟 🧦",
    });
    await expect(morning).toBeVisible();
    await expect(todayColumn(page)).toHaveAttribute("data-date", dateOf(1));
    // The morning head: "Today", no arrow, no weekday.
    await expect(morning.getByTestId("bring-cue")).toHaveText("Today");
    await expect(morning.getByTestId("bring-arrow")).toHaveCount(0);
    await expect(morning.getByTestId("bring-day")).toHaveCount(0);

    await setNow(page, at("07:00", 1));
    await expect(morning).toBeVisible();
    await expectAreaLayout(page);
    await expectNoOverflow(page);
    await shot(page, `bring-morning-${mode}`, project);

    // Swimming (07:30) started: its icons leave, the library book stays for both.
    await setNow(page, at("07:30", 1));
    await expect(
      todayColumn(page).getByRole("region", {
        name: "Today bring: Mia 📕 and Ben 📕 👟 🧦",
      }),
    ).toBeVisible();
    await expectAreaLayout(page);
    await expectNoOverflow(page);
    await shot(page, `bring-after-start-${mode}`, project);

    // After the last start: no area.
    await setNow(page, at("15:00", 1));
    await expect(page.getByTestId("bring-area")).toHaveCount(0);
  });
}

const LEO: MockChild = {
  id: "leo",
  name: "Leo",
  color: "child-3",
  avatar: "🦁",
};

test("a crowded evening: three children with long lists, 12 events, nothing lost or cut", async ({
  page,
}, testInfo) => {
  const today: MockEvent[] = Array.from({ length: 12 }, (_, i) => ({
    title: `Event ${String(i + 1)}`,
    icon: "🎨",
    time: `${String(8 + i).padStart(2, "0")}:00`,
    childIds: [["mia"], ["ben"], ["leo"], []][i % 4] ?? [],
  }));
  const tomorrow: MockEvent[] = [
    {
      title: "Forest day",
      icon: "🌲",
      time: null,
      day: 1,
      bring: ["🥾", "🧥"],
    },
    {
      title: "School",
      icon: "🏫",
      time: "08:00",
      day: 1,
      childIds: ["mia"],
      bring: ["🎨", "👕", "🥤", "🍎", "🧢", "🧤", "🧣", "🧦"],
    },
    {
      title: "Swimming",
      icon: "🏊",
      time: "10:00",
      day: 1,
      childIds: ["ben", "leo"],
      bring: ["🩱", "🧴", "🥽", "👟", "🧢", "🥪"],
    },
  ];
  await mockBoard(page, {
    config: config({ children: [...CHILDREN, LEO] }),
    agenda: agenda(
      [
        { title: "Zoo trip", icon: "🦁", time: null, childIds: ["mia", "ben"] },
        { title: "Museum", icon: "🏛️", time: null },
        ...today,
        ...tomorrow,
      ],
      MEALS,
    ),
    now: at("19:40"),
  });
  await page.goto("/?night=0");
  const column = todayColumn(page);
  const area = column.getByTestId("bring-area");
  await expect(area).toBeVisible();
  // Every child and every icon is named, whatever is drawn.
  const name = (await area.getAttribute("aria-label")) ?? "";
  for (const part of [
    "Everyone 🥾 🧥",
    "Mia 🎨 👕 🥤 🍎 🧢 🧤 🧣 🧦",
    "Ben 🩱 🧴 🥽 👟 🧢 🥪",
    "Leo 🩱 🧴 🥽 👟 🧢 🥪",
  ]) {
    expect(name).toContain(part);
  }
  // Drawn plus counted covers every icon (2 + 8 + 6 + 6).
  const counted = await area.evaluate((element) => {
    let total = 0;
    for (const group of element.querySelectorAll<HTMLElement>(
      "[data-testid=bring-group]",
    )) {
      total += Number(group.dataset["count"]);
    }
    const trailing = element.querySelector("[data-testid=bring-area-more]");
    return total + Number((trailing?.textContent ?? "+0").slice(1));
  });
  expect(counted).toBe(22);
  await expectAreaLayout(page);
  // The list above still fits around it: nothing lost, nothing scrolls.
  const account = await columnAccount(column);
  expect(account.shown.length + account.folded + account.hidden).toBe(12);
  await expectNoOverflow(page);
  await shot(page, "bring-crowded", testInfo.project.name);
});

/** Fourteen distinct icons (Emoji <= 13.0) a school child could pack over several days. */
const MANY = [
  "🩱",
  "🧴",
  "🥽",
  "👟",
  "🧢",
  "🥪",
  "🎨",
  "👕",
  "🥤",
  "🍎",
  "🧤",
  "🧣",
  "🧦",
  "📕",
  "✏️",
  "📏",
  "🩳",
  "🥾",
  "🧥",
  "🍌",
];

test("a two-digit +N keeps its reserved width: no clipped group, no clipped digits", async ({
  page,
}, testInfo) => {
  // Mia packs 20 distinct icons for tomorrow (three events), Ben two.
  await mockBoard(page, {
    agenda: agenda(
      [
        {
          title: "Swimming",
          icon: "🏊",
          time: "07:30",
          day: 1,
          childIds: ["mia"],
          bring: MANY.slice(0, 8),
        },
        {
          title: "School",
          icon: "🏫",
          time: "09:00",
          day: 1,
          childIds: ["mia"],
          bring: MANY.slice(8, 16),
        },
        {
          title: "Forest",
          icon: "🌲",
          time: "13:00",
          day: 1,
          childIds: ["mia"],
          bring: MANY.slice(16),
        },
        {
          title: "Library",
          icon: "📚",
          time: "15:00",
          day: 1,
          childIds: ["ben"],
          bring: ["📕", "🧦"],
        },
      ],
      MEALS,
    ),
    now: at("19:40"),
  });
  await page.goto("/?night=0");
  const area = todayColumn(page).getByTestId("bring-area");
  await expect(area).toBeVisible();
  const mia = area.locator("[data-testid=bring-group][data-child=mia]");
  expect(Number(await mia.getAttribute("data-count"))).toBe(20);
  const undrawn = 20 - Number(await mia.getAttribute("data-drawn"));
  // The case is real: at least ten icons are counted, so the "+N" has two digits.
  expect(undrawn).toBeGreaterThanOrEqual(10);
  const more = mia.getByTestId("bring-group-more");
  await expect(more).toHaveText(`+${String(undrawn)}`);
  const report = await more.evaluate((element) => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const box = element.getBoundingClientRect();
    const group = element.parentElement?.getBoundingClientRect();
    return {
      // Wider than the reserved room (`moreRem`, 2rem) would push the row out of fit.
      widthRem: box.width / rem,
      textFits: element.scrollWidth <= element.clientWidth + 1,
      insideGroup:
        group !== undefined &&
        box.left >= group.left - 0.5 &&
        box.right <= group.right + 0.5,
    };
  });
  expect(report.textFits).toBe(true);
  expect(report.insideGroup).toBe(true);
  expect(report.widthRem).toBeLessThanOrEqual(2 + 0.01);
  await expectAreaLayout(page);
  await expectNoOverflow(page);
  await shot(page, "bring-two-digit-more", testInfo.project.name);
});

/*
 * Density with the area present: three children with bring lists for tomorrow, 1 to 12
 * events in today's column (with chips of their own), at the evening clock; the burn-in
 * corners rotate through the counts. Nothing scrolls, nothing is cut, every event is a
 * tile, in the "vorbei" strip or in a "+N" (shown + folded + hidden = n).
 */
const CORNERS = [1, 3, 5, 7] as const;
const DENSE_ICONS = [
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
];
const DENSE_TOMORROW: MockEvent[] = [
  {
    title: "Forest day",
    icon: "🌲",
    time: null,
    day: 1,
    bring: ["🥾", "🧥"],
  },
  {
    title: "School",
    icon: "🏫",
    time: "08:00",
    day: 1,
    childIds: ["mia"],
    bring: ["🎨", "👕", "🥤", "🍎", "🧢", "🧤", "🧣", "🧦"],
  },
  {
    title: "Swimming",
    icon: "🏊",
    time: "10:00",
    day: 1,
    childIds: ["ben"],
    bring: ["🩱", "🧴", "🥽"],
  },
  {
    title: "Football",
    icon: "⚽",
    time: "15:00",
    day: 1,
    childIds: ["leo"],
    bring: ["👟", "🧦"],
  },
];

for (let count = 1; count <= 12; count += 1) {
  const locale = count % 2 === 0 ? "de" : "en";
  const corner = CORNERS[count % CORNERS.length] ?? 1;
  test(`area present: ${String(count)} events today (${locale}, burn-in corner ${String(corner)}) fit without loss`, async ({
    page,
  }) => {
    const today: MockEvent[] = Array.from({ length: count }, (_, i) => ({
      title: `Termin ${String(i + 1)}`,
      icon: DENSE_ICONS[i % DENSE_ICONS.length] ?? "📅",
      time: `${String(7 + i).padStart(2, "0")}:00`,
      childIds: [["mia"], ["ben", "leo"], ["leo"], []][i % 4] ?? [],
      ...(i % 3 === 0 ? { bring: ["🧢", "🥪"] } : {}),
    }));
    await mockBoard(page, {
      config: config({ locale, children: [...CHILDREN, LEO] }),
      agenda: agenda([...today, ...DENSE_TOMORROW], MEALS),
      now: at("17:30"),
    });
    await page.goto(`/?night=0&burnin=${String(corner)}`);
    await expect(page.getByTestId("board-ready")).toBeVisible();
    const column = todayColumn(page);
    const area = column.getByTestId("bring-area");
    await expect(area).toBeVisible();
    await expect(area.getByTestId("bring-group")).toHaveCount(4);
    await expectAreaLayout(page);
    const account = await columnAccount(column);
    expect(account.shown.length + account.folded + account.hidden).toBe(count);
    for (const tile of await column.getByRole("article").all()) {
      await expect(tile).toBeInViewport({ ratio: 1 });
    }
    for (const plate of await page
      .getByTestId("meal-plates")
      .getByRole("img")
      .all()) {
      await expect(plate).toBeInViewport({ ratio: 1 });
    }
    await expectNoOverflow(page);
  });
}

/*
 * Chips on the overview and the week tiles, light and night; the description marker
 * (`Mitbringen:` / `Bring:`) and any description text never reach the DOM, even when an
 * unexpected `description` field sneaks into the response.
 */
for (const night of [false, true]) {
  const mode = night ? "night" : "light";
  test(`chips on overview and week tiles, no description in the DOM (${mode})`, async ({
    page,
  }, testInfo) => {
    const project = testInfo.project.name;
    const body = agenda(EVENTS, MEALS) as {
      events: Record<string, unknown>[];
    };
    for (const event of body.events) {
      event["description"] = "Mitbringen: 🩱 secret-note-TESTONLY";
    }
    await mockBoard(page, { agenda: body, now: at("12:00") });
    await page.goto(`/?night=${night ? "1" : "0"}`);
    await expect(page.getByTestId("board-ready")).toBeVisible();
    // Overview: tomorrow's column shows the chips of its events.
    const tomorrow = page.locator(
      `[data-testid=day-column][data-date="${dateOf(1)}"]`,
    );
    await expect(tomorrow).toBeVisible();
    // The area is not there at midday.
    await expect(page.getByTestId("bring-area")).toHaveCount(0);
    await expect(page.getByTestId("bring-chip").first()).toBeVisible();
    await expect(
      tomorrow.getByTestId("event-tile").first().getByTestId("bring-chips"),
    ).toBeVisible();

    await page.getByRole("button", { name: "Week" }).click();
    await expect(page.getByTestId("week-board")).toBeVisible();
    await expect(
      page.locator("article[data-bring=row] [data-testid=bring-chips]").first(),
    ).toBeVisible();
    await expect(page.getByTestId("bring-chip").first()).toBeVisible();
    await page.mouse.move(0, 0);
    await shot(page, `bring-week-chips-${mode}`, project);

    const html = await page.content();
    expect(html).not.toMatch(/Mitbringen|Bring:|secret-note/);
    expect(await page.locator("body").innerText()).not.toMatch(
      /Mitbringen|Bring:|secret-note/,
    );
    await expectNoOverflow(page);
  });
}
