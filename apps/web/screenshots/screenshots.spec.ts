import { expect, type Locator, type Page, test } from "@playwright/test";

import { demoEditorConfig } from "../demo/demoApi";
import { demoAgenda, demoConfig, demoWeather } from "../demo/demoData";
import { clothingPlacement } from "../e2e/layout";
import { at, dateOf, MOCK_PARENT_PIN, mockBoard, NOW } from "../e2e/mockApi";
import { SCREENSHOT_DIR } from "./paths";

/*
 * README screenshots: day and week view, light and night, with the synthetic demo data
 * (Mia 🦊 / Ben 🐻). Deterministic: the clock is fixed (Sunday 12:00, the plain night
 * overview 16:45 with the night look forced, the bring area at 18:30 / 20:00 Berlin), the
 * burn-in shift is pinned to its centre (`?burnin=0`), animations are off (reduced motion).
 * Run with `pnpm screenshots` after `pnpm build`.
 */

const NIGHT_NOW = at("20:00");

type Theme = "light" | "night";

/** Evening before a school day, still light (night mode starts at 19:30). */
const EVENING_NOW = at("18:30");

/**
 * The plain night overview (no 🎒 area, which is in its own shots): every night hour of
 * the demo has something to pack (tomorrow's swimming, this morning's zoo trip), so the
 * night look is forced (`?night=1`) at a late afternoon clock where nothing is left to
 * pack: the all-day trip is past midday, football has started, eveningStart (17:00) is
 * still ahead.
 */
const PLAIN_NIGHT_NOW = at("16:45");

async function openBoard(
  page: Page,
  theme: Theme,
  options: { countdownDays?: number; now?: string; weather?: boolean } = {},
): Promise<void> {
  const now = options.now ?? (theme === "light" ? NOW : NIGHT_NOW);
  await mockBoard(page, {
    // Without `weather` the API answers 404 `weather_off`: no weather on the board.
    ...(options.weather === true
      ? { weather: demoWeather(dateOf(0), now) }
      : {}),
    config: demoConfig(),
    agenda: demoAgenda(
      dateOf(0),
      now,
      options.countdownDays === undefined
        ? {}
        : { countdownDays: options.countdownDays },
    ),
    now,
  });
  await page.goto(`/?burnin=0&night=${theme === "night" ? "1" : "0"}`);
  await expect(page.getByTestId("board-ready")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function shoot(page: Page, name: string, size: string): Promise<void> {
  // Webfont and emoji glyphs must be in before the picture is taken.
  await page.evaluate(() => document.fonts.ready);
  // A button that was just pressed may still be finishing its press transition.
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations().map((animation) => animation.finished),
    ),
  );
  await page.screenshot({
    path: `${SCREENSHOT_DIR}/${name}-${size}.png`,
    animations: "disabled",
    caret: "hide",
  });
}

for (const theme of ["light", "night"] as const) {
  test(`day and week view, ${theme}`, async ({ page }, testInfo) => {
    const size = testInfo.project.name.replace("tablet-", "");
    await openBoard(page, theme, {
      now: theme === "light" ? NOW : PLAIN_NIGHT_NOW,
    });
    await expect(page.getByTestId("countdown")).toHaveAttribute(
      "data-nights",
      "6",
    );
    // The plain night overview: the 🎒 area at night has a shot of its own.
    if (theme === "night") {
      await expect(page.getByTestId("bring-area")).toHaveCount(0);
    }
    await shoot(page, `day-${theme}`, size);

    await page.getByRole("button", { name: "Week" }).click();
    await expect(page.getByTestId("day-column")).toHaveCount(7);
    // The click leaves the pointer on the button (hover/press look): move it away so the
    // picture does not depend on the button's transition.
    await page.mouse.move(0, 0);
    await expect(page.getByRole("button", { name: "Week" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await shoot(page, `week-${theme}`, size);
  });
}

/*
 * School (T-37): the evening 🎒 area for tomorrow's bring lists (Mia 🦊 and Ben 🐻), light
 * at 18:30 and night at 20:00, and the week view with bring chips on the tiles.
 */
for (const theme of ["light", "night"] as const) {
  test(`day with the bring area, ${theme}`, async ({ page }, testInfo) => {
    const size = testInfo.project.name.replace("tablet-", "");
    await openBoard(page, theme, {
      now: theme === "light" ? EVENING_NOW : NIGHT_NOW,
    });
    const area = page.getByTestId("bring-area");
    await expect(area).toBeVisible();
    await expect(area.getByTestId("bring-group")).toHaveCount(2);
    await shoot(page, `day-bring-evening-${theme}`, size);
  });
}

/*
 * Weather (T-49): the evening overview with the weather chips, tomorrow's clothing row
 * (cold and rainy, led by tomorrow's weather), today's "now" chip and the 🎒 area, light
 * at 18:30 and night at 20:00.
 */
for (const theme of ["light", "night"] as const) {
  test(`day with weather, ${theme}`, async ({ page }, testInfo) => {
    const size = testInfo.project.name.replace("tablet-", "");
    await openBoard(page, theme, {
      now: theme === "light" ? EVENING_NOW : NIGHT_NOW,
      weather: true,
    });
    // The other days always carry a chip; today's evening "now" chip may give way to
    // the clothing row when the heading row is short (fonts differ per machine).
    await expect(
      page
        .locator('[data-testid="day-column"][data-today="false"]')
        .getByTestId("weather-chip"),
    ).toHaveCount(3);
    await expect(page.getByTestId("clothing-row")).toHaveAttribute(
      "data-when",
      "tomorrow",
    );
    await expect(page.getByTestId("bring-area")).toBeVisible();
    await expect(page.getByTestId("weather-attribution")).toBeVisible();
    // "Today" is never covered by the weather (one line beside it).
    expect((await clothingPlacement(page)).problems).toEqual([]);
    await shoot(page, `day-weather-${theme}`, size);
  });
}

/*
 * Weather in the morning (today's chip leads today's clothes) and in the week view
 * (weather above the weekday, the countdown moons below it).
 */
test("day with weather in the morning, light", async ({ page }, testInfo) => {
  const size = testInfo.project.name.replace("tablet-", "");
  await openBoard(page, "light", { now: at("09:00"), weather: true });
  await expect(page.getByTestId("clothing-row")).toHaveAttribute(
    "data-when",
    "today",
  );
  expect((await clothingPlacement(page)).problems).toEqual([]);
  await shoot(page, "day-weather-morning-light", size);
});

test("week with weather, light", async ({ page }, testInfo) => {
  const size = testInfo.project.name.replace("tablet-", "");
  await openBoard(page, "light", { weather: true });
  await page.getByRole("button", { name: "Week" }).click();
  await expect(page.getByTestId("week-weather")).toHaveCount(7);
  await shoot(page, "week-weather-light", size);
});

test("week with bring chips, light", async ({ page }, testInfo) => {
  const size = testInfo.project.name.replace("tablet-", "");
  await openBoard(page, "light", { now: EVENING_NOW });
  await page.getByRole("button", { name: "Week" }).click();
  await expect(page.getByTestId("day-column")).toHaveCount(7);
  await page.mouse.move(0, 0);
  await expect(page.getByTestId("bring-chip").first()).toBeVisible();
  await shoot(page, "week-bring-light", size);
});

test("countdown reaching today, light", async ({ page }, testInfo) => {
  const size = testInfo.project.name.replace("tablet-", "");
  await openBoard(page, "light", { countdownDays: 0 });
  await expect(page.getByTestId("countdown-today")).toContainText("🎉");
  await shoot(page, "day-countdown-today", size);
});

/*
 * States (T-32): loading skeleton, offline pill over the board, the friendly error card
 * and the empty day. Light theme, same pinned clock and burn-in offset; each on a fresh
 * page, so no cached state leaks from one into the next.
 */
test("state: loading", async ({ page }, testInfo) => {
  const size = testInfo.project.name.replace("tablet-", "");
  await mockBoard(page, {
    config: demoConfig(),
    agenda: demoAgenda(dateOf(0), NOW),
  });
  // Registered after the mock, so it wins: the config never answers.
  await page.route("**/api/config", () => new Promise(() => undefined));
  await page.goto("/?burnin=0&night=0");
  await expect(page.getByTestId("board-loading")).toBeVisible();
  await shoot(page, "state-loading", size);
});

test("state: offline", async ({ page, context }, testInfo) => {
  const size = testInfo.project.name.replace("tablet-", "");
  await openBoard(page, "light");
  await context.setOffline(true);
  await expect(page.locator("p[data-status=offline]")).toBeVisible();
  await shoot(page, "state-offline", size);
});

test("state: error", async ({ page }, testInfo) => {
  const size = testInfo.project.name.replace("tablet-", "");
  await mockBoard(page, {
    config: demoConfig(),
    agendaStatus: 502,
    agenda: { error: "upstream_failed" },
  });
  await page.goto("/?burnin=0&night=0");
  // After the two automatic retries of a 5xx.
  await expect(page.getByRole("alert")).toHaveAttribute(
    "data-error",
    "failed",
    {
      timeout: 15_000,
    },
  );
  await shoot(page, "state-error", size);
});

test("empty day, light", async ({ page }, testInfo) => {
  const size = testInfo.project.name.replace("tablet-", "");
  const full = demoAgenda(dateOf(0), NOW);
  await mockBoard(page, {
    config: demoConfig(),
    // Nothing timed or all-day today; the other days and every meal stay.
    agenda: {
      ...full,
      events: full.events.filter((event) => !event.start.startsWith(dateOf(0))),
    },
  });
  await page.goto("/?burnin=0&night=0");
  await expect(page.getByTestId("day-empty")).toBeVisible();
  await shoot(page, "day-empty", size);
});

/*
 * Parent editor (T-46): the PIN pad, the list with the "Again" row and the Data section,
 * and the new-entry form (weekly swimming for Mia), light and night. Same pinned clock
 * (Sunday 12:00 Berlin, night look forced with `?night=1`), the synthetic demo data plus
 * three entries made "in the app", the mock parent lock with its synthetic PIN.
 */
const HOLD_MS = 2000;

async function openPinPad(page: Page, theme: Theme): Promise<Locator> {
  const api = await mockBoard(page, {
    config: demoEditorConfig(),
    agenda: demoAgenda(dateOf(0), NOW),
  });
  api.editor.seed({
    kind: "event",
    childIds: ["mia"],
    icon: "🏊",
    title: "Swimming",
    allDay: false,
    date: dateOf(0),
    startTime: "15:00",
    endTime: "16:00",
    repeat: { weekly: { weekdays: [7], interval: 1 } },
  });
  api.editor.seed({
    kind: "event",
    childIds: ["ben"],
    icon: "🦷",
    title: "Dentist",
    allDay: false,
    date: dateOf(1),
    startTime: "09:30",
    endTime: "10:00",
  });
  api.editor.seed({
    kind: "meal",
    icon: "🍝",
    title: "Spaghetti",
    allDay: true,
    date: dateOf(1),
    slot: "dinner",
  });
  await page.goto(`/?burnin=0&night=${theme === "night" ? "1" : "0"}`);
  await expect(page.getByTestId("board-ready")).toBeVisible();
  const entry = page.getByRole("button", { name: /parent area/i });
  const box = await entry.boundingBox();
  if (box === null) throw new Error("entry has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const pad = page.getByRole("dialog", { name: "Parent area" });
  await expect(pad).toBeVisible({ timeout: HOLD_MS + 2000 });
  await page.mouse.up();
  return pad;
}

for (const theme of ["light", "night"] as const) {
  test(`editor: PIN pad, ${theme}`, async ({ page }, testInfo) => {
    const size = testInfo.project.name.replace("tablet-", "");
    const pad = await openPinPad(page, theme);
    // Three digits typed: the dots show the progress, never the digits.
    for (const digit of MOCK_PARENT_PIN.slice(0, 3)) {
      await pad.getByRole("button", { name: digit, exact: true }).click();
    }
    await page.mouse.move(0, 0);
    await shoot(page, `editor-pin-${theme}`, size);
  });

  test(`editor: list and new entry, ${theme}`, async ({ page }, testInfo) => {
    const size = testInfo.project.name.replace("tablet-", "");
    const pad = await openPinPad(page, theme);
    for (const digit of MOCK_PARENT_PIN) {
      await pad.getByRole("button", { name: digit, exact: true }).click();
    }
    await pad.getByRole("button", { name: "OK" }).click();
    await expect(page.getByTestId("entry-list")).toBeVisible();
    await expect(page.getByTestId("template").first()).toBeVisible();
    // Scroll to the app's own entries (series mark, change controls) below the Google rows.
    const own = page.locator('[data-testid="editor-item"][data-origin="app"]');
    await expect(own.first()).toBeVisible();
    await own.first().evaluate((element) => {
      element.scrollIntoView({ block: "center" });
    });
    await expect(own.first().getByTestId("series-mark")).toContainText(
      "Every week",
    );
    await page.mouse.move(0, 0);
    await shoot(page, `editor-list-${theme}`, size);

    // The Data section with the phone feed block.
    await expect(page.getByTestId("phone-feed")).toBeVisible();
    await page.getByTestId("data-section").evaluate((element) => {
      element.scrollIntoView({ block: "end" });
    });
    await page.mouse.move(0, 0);
    await shoot(page, `editor-data-${theme}`, size);

    await page.getByTestId("quick-swimmingWeekly").click();
    const form = page.getByTestId("event-form");
    await expect(form).toBeVisible();
    await form.getByRole("checkbox", { name: "Mia" }).check({ force: true });
    await expect(page.getByTestId("entry-preview")).toContainText("Swimming");
    await page.mouse.move(0, 0);
    await shoot(page, `editor-new-${theme}`, size);
  });
}
