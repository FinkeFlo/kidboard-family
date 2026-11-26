import { expect, type Page, test } from "@playwright/test";

import { expectNoOverflow, moons, withCountdown } from "./layout";
import { mockBoard } from "./mockApi";

const SHOT_DIR = process.env["E2E_SCREENSHOT_DIR"];

/**
 * The pill reads from start to goal: the number, the moons, the goal's icon and its short
 * name, all visible inside the pill; and it is as high as the name chips beside it.
 */
async function expectPillReadsToGoal(
  page: Page,
  count: string,
  name: string,
): Promise<void> {
  const pill = page.getByTestId("countdown");
  await expect(pill.getByTestId("countdown-count")).toHaveText(count);
  const nameEl = pill.getByTestId("countdown-name");
  await expect(nameEl).toBeVisible();
  await expect(nameEl).toHaveText(name);
  const layout = await pill.evaluate((el) => {
    const box = (node: Element | null): DOMRect | undefined =>
      node?.getBoundingClientRect();
    const pillBox = el.getBoundingClientRect();
    const moon = [...el.querySelectorAll(".font-emoji")].find(
      (node) => node.textContent === "🌙",
    );
    const target = box(el.querySelector("[data-testid=countdown-target]"));
    const label = box(el.querySelector("[data-testid=countdown-name]"));
    const chips = [...document.querySelectorAll("header li")].map(
      (chip) => chip.getBoundingClientRect().height,
    );
    return {
      pill: {
        left: pillBox.left,
        right: pillBox.right,
        height: pillBox.height,
      },
      count: box(el.querySelector("[data-testid=countdown-count]"))?.left ?? 0,
      moon: box(moon ?? null)?.left ?? 0,
      target: target?.left ?? 0,
      label: {
        left: label?.left ?? 0,
        right: label?.right ?? 0,
        width: label?.width ?? 0,
      },
      chips,
    };
  });
  // Number, moons, goal, name from start to end.
  expect(layout.count).toBeLessThan(layout.moon);
  expect(layout.moon).toBeLessThan(layout.target);
  expect(layout.target).toBeLessThan(layout.label.left);
  // The name shows at least a few letters and stays inside the pill.
  expect(layout.label.width).toBeGreaterThan(40);
  expect(layout.label.right).toBeLessThanOrEqual(layout.pill.right);
  for (const chip of layout.chips) {
    expect(Math.abs(chip - layout.pill.height)).toBeLessThanOrEqual(1);
  }
}

/** Size of the pill and its name, to compare the two views (one size in both). */
async function pillLook(page: Page): Promise<{
  height: number;
  nameFont: string;
  nameWidth: number;
  nameCut: boolean;
}> {
  return page.getByTestId("countdown").evaluate((el) => {
    const name = el.querySelector("[data-testid=countdown-name]");
    return {
      height: Math.round(el.getBoundingClientRect().height),
      nameFont: name === null ? "" : getComputedStyle(name).fontSize,
      nameWidth: Math.round(name?.getBoundingClientRect().width ?? 0),
      nameCut: name !== null && name.scrollWidth > name.clientWidth,
    };
  });
}

test.describe("countdown", () => {
  test("30 nights: the same pill on the day and the week view, no overflow", async ({
    page,
  }, testInfo) => {
    await mockBoard(page, { agenda: withCountdown(30) });
    await page.goto("/");

    const countdown = page.getByRole("region", { name: "How many sleeps?" });
    await expect(countdown).toHaveAttribute("data-nights", "30");
    await expect(countdown).toContainText(
      "30 more sleeps until Christmas party",
    );
    // Beyond 14 nights: the number, then a single moon.
    await expect(page.getByTestId("countdown-count")).toHaveText("30 ×");
    await expect(page.getByTestId("countdown-grouped")).toHaveText("🌙");
    await expect(page.getByTestId("board-ready")).toBeVisible();
    await expectNoOverflow(page);
    const dayLook = await pillLook(page);
    // The goal's name fits in full ("Christmas party", not "Christmas p…").
    expect(dayLook.nameCut).toBe(false);
    if (SHOT_DIR !== undefined) {
      await page.screenshot({
        path: `${SHOT_DIR}/countdown-day-30-${testInfo.project.name}.png`,
      });
    }

    await page.getByRole("button", { name: "Week" }).click();
    await expect(page.getByTestId("day-column")).toHaveCount(7);
    // One pill: same height, same name font and the name as wide as on the day view.
    expect(await pillLook(page)).toEqual(dayLook);
    await expect(countdown).toContainText(
      "30 more sleeps until Christmas party",
    );
    await expectNoOverflow(page);
    if (SHOT_DIR !== undefined) {
      await page.screenshot({
        path: `${SHOT_DIR}/countdown-week-30-${testInfo.project.name}.png`,
      });
    }
  });

  test("14 nights: every night a moon, in both views, also with the offline banner", async ({
    page,
    context,
  }, testInfo) => {
    await mockBoard(page, {
      agenda: withCountdown(14, [
        // Same day, several countdowns: one shared countdown, up to 3 icons.
        { title: "Gift", icon: "🎁", time: "10:00", day: 14, countdown: true },
        { title: "Cake", icon: "🎂", time: "15:00", day: 14, countdown: true },
        { title: "Fun", icon: "🎉", time: "16:00", day: 14, countdown: true },
      ]),
    });
    await page.goto("/");
    const countdown = page.getByRole("region", { name: "How many sleeps?" });
    await expect(countdown).toContainText(
      "14 more sleeps until Christmas party, Gift, Cake, and Fun",
    );
    expect(await moons(page)).toBe(14);
    await expectNoOverflow(page);
    await expectPillReadsToGoal(page, "14 ×", "Christmas party");

    await page.getByRole("button", { name: "Week" }).click();
    await expect(page.getByTestId("day-column")).toHaveCount(7);
    expect(await moons(page)).toBe(14);
    // The target is beyond the week: each of the seven headers shows its night's moon,
    // and the pill's moons are the only ones counted in it.
    await expect(
      page.getByTestId("day-column").getByTestId("column-moon"),
    ).toHaveCount(7);
    await expectNoOverflow(page);
    await expectPillReadsToGoal(page, "14 ×", "Christmas party");
    if (SHOT_DIR !== undefined) {
      await page.screenshot({
        path: `${SHOT_DIR}/countdown-week-14-${testInfo.project.name}.png`,
      });
    }

    await context.setOffline(true);
    await expect(page.getByRole("status")).toContainText("Offline");
    await expectNoOverflow(page);
    await page.getByRole("button", { name: "Today" }).click();
    await expect(page.getByTestId("day-column")).toHaveCount(4);
    await expectNoOverflow(page);
    if (SHOT_DIR !== undefined) {
      await page.screenshot({
        path: `${SHOT_DIR}/countdown-day-14-offline-${testInfo.project.name}.png`,
      });
    }
  });

  test("moons on the day view are large, and no 🎉 cue while nights are left", async ({
    page,
  }) => {
    await mockBoard(page, { agenda: withCountdown(6) });
    await page.goto("/");
    await expect(page.getByTestId("countdown")).toBeVisible();
    expect(await moons(page)).toBe(6);
    await expect(page.getByTestId("countdown-today")).toHaveCount(0);
    const sizes = await page.evaluate(() => {
      const px = (el: Element | null): number =>
        el === null ? 0 : Number.parseFloat(getComputedStyle(el).fontSize);
      const moon = [
        ...document.querySelectorAll("[data-testid=countdown] .font-emoji"),
      ].find((el) => el.textContent === "🌙");
      const heading = document.querySelector("h1");
      return { moon: px(moon ?? null), title: px(heading) };
    });
    // The day-view heading is display-sized; the moon is at least 2 x the body text size
    // (--text-body is 1.125rem; the root size is 16 px at 1280 wide and grows with the screen).
    const root = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    );
    expect(sizes.moon).toBeGreaterThanOrEqual(root * 2);
    expect(sizes.moon).toBeLessThan(sizes.title);
    await expectNoOverflow(page);
  });

  test("today: the today state in both views", async ({ page }) => {
    await mockBoard(page, { agenda: withCountdown(0) });
    await page.goto("/");
    const countdown = page.getByRole("region", { name: "How many sleeps?" });
    await expect(countdown).toHaveAttribute("data-nights", "0");
    await expect(countdown).toContainText("Today!");
    // A picture for children who cannot read "Today!": the party popper.
    await expect(page.getByTestId("countdown-today")).toContainText("🎉");
    expect(await moons(page)).toBe(0);
    await expectNoOverflow(page);
    await page.getByRole("button", { name: "Week" }).click();
    await expect(page.getByTestId("day-column")).toHaveCount(7);
    await expect(page.getByTestId("countdown-today")).toContainText("🎉");
    await expect(countdown).toContainText("Today is the day: Christmas party!");
    await expectNoOverflow(page);
  });

  test("German labels with plural rules", async ({ page }) => {
    await mockBoard(page, {
      config: {
        locale: "de",
        timeZone: "Europe/Berlin",
        calendars: [{ id: "family", kind: "events" }],
      },
      agenda: withCountdown(1),
    });
    await page.goto("/");
    const countdown = page.getByRole("region", {
      name: "Wie oft noch schlafen?",
    });
    await expect(countdown).toContainText(
      "Noch einmal schlafen bis Christmas party",
    );
    expect(await moons(page)).toBe(1);
    await expectNoOverflow(page);
  });

  test("German: 'Noch 6 Mal schlafen' (no hyphen) and the week marks the goal day", async ({
    page,
  }) => {
    await mockBoard(page, {
      config: {
        locale: "de",
        timeZone: "Europe/Berlin",
        calendars: [{ id: "family", kind: "events" }],
      },
      agenda: withCountdown(6),
    });
    await page.goto("/");
    const countdown = page.getByRole("region", {
      name: "Wie oft noch schlafen?",
    });
    await expect(countdown).toContainText(
      "Noch 6 Mal schlafen bis Christmas party",
    );
    await expectPillReadsToGoal(page, "6 ×", "Christmas party");
    await page.getByRole("button", { name: "Woche" }).click();
    const columns = page.getByTestId("day-column");
    // Six moons, then the goal's icon on its day; every header keeps the same slot.
    await expect(columns.getByTestId("column-moon")).toHaveCount(6);
    const target = columns.nth(6);
    await expect(target).toHaveAttribute("data-countdown-day", "true");
    await expect(target.getByTestId("column-target")).toBeVisible();
    const dateTops = await columns.evaluateAll((all) =>
      all.map((column) =>
        Math.round(
          (column.querySelector("p") as HTMLElement).getBoundingClientRect()
            .top,
        ),
      ),
    );
    expect(new Set(dateTops).size).toBe(1);
    await expectNoOverflow(page);
  });
});
