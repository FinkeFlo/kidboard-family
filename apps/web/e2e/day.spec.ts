import { expect, type Page, test } from "@playwright/test";

import { columnAccount, expectNoOverflow, minEmojiRem } from "./layout";
import { agenda, fixClock, mockBoard, type MockEvent } from "./mockApi";

/** 8 timed events (3 morning, 3 midday, 2 evening) plus an all-day one, and 3 meals. */
const EVENTS: MockEvent[] = [
  { title: "School trip to the zoo", icon: "🦁", time: null },
  { title: "Swimming", icon: "🏊", time: "07:30", childIds: ["mia"] },
  {
    title: "Dentist with a very long appointment title",
    icon: "🦷",
    time: "08:30",
  },
  { title: "Music class", icon: "🎻", time: "10:00", childIds: ["ben", "mia"] },
  { title: "Lunch with Grandma", icon: "👵", time: "11:30" },
  { title: "Football", icon: "⚽", time: "12:00", childIds: ["ben"] },
  { title: "Playground", icon: "🎠", time: "15:00" },
  { title: "Bath time", icon: "🛁", time: "18:00" },
  { title: "Story time", icon: "📖", time: "19:00" },
  { title: "Library", icon: "📚", time: "15:30", day: 1, childIds: ["mia"] },
];
const MEALS = [
  { slot: "breakfast", title: "Oatmeal with berries", icon: "🥣" },
  { slot: "lunch", title: "Spaghetti with tomato sauce", icon: "🍝" },
  { slot: "dinner", title: "Vegetable soup and bread", icon: "🍲" },
];

const SHOT_DIR = process.env["E2E_SCREENSHOT_DIR"];

/** px value of a CSS length (e.g. a token) in the page. */
async function px(page: Page, value: string): Promise<number> {
  return page.evaluate((length: string) => {
    const probe = document.createElement("div");
    probe.style.width = length;
    document.body.append(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width;
  }, value);
}

/** Computed colour of a token in the page (for comparing surfaces). */
async function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((name: string) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  }, token);
}

test.describe("overview (main screen)", () => {
  test("today plus three days, today twice as wide, nothing lost, no overflow", async ({
    page,
  }, testInfo) => {
    await mockBoard(page, { agenda: agenda(EVENTS, MEALS) });
    await page.goto("/");

    await expect(
      page.getByRole("heading", { level: 1, name: "Sunday" }),
    ).toBeVisible();
    await expect(page.locator("header")).toContainText("November 22");
    const columns = page.getByTestId("day-column");
    await expect(columns).toHaveCount(4);
    await expect(
      columns.evaluateAll((list) =>
        list.map((c) => c.getAttribute("data-date")),
      ),
    ).resolves.toEqual([
      "2026-11-22",
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
    ]);
    const today = columns.first();
    await expect(today).toHaveAttribute("aria-current", "date");
    await expect(
      today.getByRole("heading", { level: 2, name: "Today" }),
    ).toBeVisible();

    // Today is about twice as wide as each other day.
    const widths = await columns.evaluateAll((list) =>
      list.map((c) => c.getBoundingClientRect().width),
    );
    for (const other of widths.slice(1)) {
      expect((widths[0] ?? 0) / other).toBeGreaterThan(1.8);
      expect((widths[0] ?? 0) / other).toBeLessThan(2.2);
    }
    // Today: raised surface, ring and shadow; the other days: sunken.
    const surfaces = await columns.evaluateAll((list) =>
      list.map((c) => {
        const style = getComputedStyle(c);
        return { bg: style.backgroundColor, shadow: style.boxShadow };
      }),
    );
    expect(surfaces[0]?.bg).toBe(
      await tokenColor(page, "--color-surface-raised"),
    );
    expect(surfaces[0]?.shadow).toContain(
      await tokenColor(page, "--color-today-ring"),
    );
    for (const other of surfaces.slice(1)) {
      expect(other.bg).toBe(await tokenColor(page, "--color-surface-sunken"));
    }

    // Today's emoji: large tiles at least 3.5rem, medium 3rem, dense 2.75rem, slim 2rem.
    const emojiSizes = await today
      .getByTestId("column-events")
      .getByTestId("event-tile")
      .evaluateAll((tiles) =>
        tiles.map((tile) => ({
          size: tile.getAttribute("data-size") ?? "",
          px: parseFloat(
            getComputedStyle(tile.querySelector(".font-emoji") as Element)
              .fontSize,
          ),
        })),
      );
    const rem = await px(page, "1rem");
    expect(emojiSizes.length).toBeGreaterThan(0);
    for (const size of emojiSizes) {
      expect(size.px).toBeGreaterThanOrEqual(
        minEmojiRem(size.size) * rem - 0.5,
      );
    }

    // Every timed event is shown, folded into the named strip or summed up: none lost.
    const account = await columnAccount(today);
    expect(account.shown.length + account.folded + account.hidden).toBe(8);
    for (const event of EVENTS.filter((e) => e.time !== null && !e.day)) {
      const named =
        account.shown.some((name) => name.startsWith(event.title)) ||
        account.stripName.includes(event.title) ||
        account.hiddenText.includes(event.title);
      expect(named, event.title).toBe(true);
    }
    // Times are shown in the config zone (Berlin), not the device zone.
    const football = today.getByRole("article", { name: /^Football/ });
    await expect(football).toContainText("12:00 PM");
    await expect(football).toHaveAttribute("data-status", "current");
    await expect(football).toHaveAccessibleName(
      "Football, 12:00 PM, For Ben, Happening now",
    );
    // The now line is named with the time; the next tile is emphasised.
    await expect(
      today.getByRole("separator", { name: "now, 12:00 PM" }),
    ).toBeVisible();
    await expect(
      today.getByRole("article", { name: /^Playground/ }),
    ).toHaveAttribute("data-next", "true");
    // All-day banner with its own icon, not a tile with the midday sun.
    const trip = today
      .getByTestId("all-day")
      .getByRole("article", { name: /^School trip to the zoo, All day/ });
    await expect(trip).toBeInViewport({ ratio: 1 });
    await expect(trip.getByTestId("all-day-icon")).toBeVisible();
    // Meals as named plates at the bottom of today's column.
    for (const meal of MEALS) {
      await expect(
        today.getByRole("img", { name: new RegExp(`: ${meal.title}$`) }),
      ).toBeInViewport({ ratio: 1 });
    }
    // Another day: tinted tile with a badge.
    const library = columns.nth(1).getByRole("article", { name: /^Library/ });
    await expect(library).toHaveAttribute("data-tint", "single");
    await expectNoOverflow(page);

    if (SHOT_DIR !== undefined) {
      await page.screenshot({
        path: `${SHOT_DIR}/day-${testInfo.project.name}.png`,
      });
    }
  });

  test("the rail: two big buttons, 'Stand' time (no live region), fullscreen below", async ({
    page,
  }) => {
    await mockBoard(page, { agenda: agenda(EVENTS, MEALS) });
    await page.goto("/");
    const rail = page.getByTestId("nav-rail");
    for (const name of ["Today", "Week"]) {
      const box = await rail.getByRole("button", { name }).boundingBox();
      expect(box).not.toBeNull();
      // 104x120 at the 16px root (6.5rem x 7.5rem), never below 64px.
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(
        Math.max(64, await px(page, "6.5rem")) - 0.5,
      );
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(
        Math.max(64, await px(page, "7.5rem")) - 0.5,
      );
    }
    await expect(rail.getByRole("button", { name: "Today" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const updated = rail.getByTestId("updated-at");
    await expect(updated).toHaveText(/^Updated \d{1,2}:\d{2}\s(AM|PM)$/u);
    expect(
      await updated.evaluate(
        (el) => el.closest("[aria-live], [role=status], [role=alert]") === null,
      ),
    ).toBe(true);
  });

  test("shows the discreet offline banner with the last data", async ({
    page,
    context,
  }) => {
    await mockBoard(page, { agenda: agenda(EVENTS, MEALS) });
    await page.goto("/");
    await expect(
      page.getByRole("article", { name: /^Football/ }),
    ).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByRole("status")).toContainText("Offline · as of");
    await expect(
      page.getByRole("article", { name: /^Football/ }),
    ).toBeVisible();
    await expectNoOverflow(page);
  });

  test("shows a calm, parent-readable state for an access link that is no longer valid", async ({
    page,
  }) => {
    await fixClock(page);
    await page.route("**/api/**", (route) =>
      route.fulfill({ status: 401, json: { error: "unauthorized" } }),
    );
    await page.goto("/");
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("A grown-up can fix this");
    await expect(alert).toContainText("This tablet needs a new access link");
    // No URL syntax on the card (the docs explain it); the code is for parents.
    await expect(alert).not.toContainText("?key=");
    await expect(page.getByTestId("error-code")).toContainText("KB-401");
    await expectNoOverflow(page);
  });

  test("shows the loading skeleton while the config is pending", async ({
    page,
  }) => {
    await page.route("**/api/**", () => new Promise(() => undefined));
    await page.goto("/");
    await expect(page.getByRole("status")).toContainText("Getting the day");
    await expectNoOverflow(page);
  });

  for (const night of [false, true]) {
    test(`each symbol has one meaning${night ? " (night)" : ""}: 🌅 🌞 🌆 on tiles, 🌙 only counts sleeps, ☀️ stays on 'Today'`, async ({
      page,
    }) => {
      await mockBoard(page, {
        agenda: agenda(
          [
            ...EVENTS,
            { title: "Kindergarten", icon: "🏫", time: "08:00", day: 2 },
            { title: "Bath", icon: "🛁", time: "18:30", day: 2 },
            {
              title: "Party",
              icon: "🎂",
              time: "16:00",
              day: 3,
              countdown: true,
            },
          ],
          MEALS,
        ),
      });
      await page.goto(night ? "/?night=1" : "/");
      await expect(page.getByTestId("board-ready")).toBeVisible();
      // Time-of-day symbols on the tiles: the emoji outside the disc and the badges.
      const symbols = await page
        .getByTestId("column-events")
        .getByTestId("event-tile")
        .evaluateAll((tiles) =>
          tiles.map(
            (tile) =>
              [...tile.querySelectorAll(".font-emoji")].filter(
                (el) =>
                  el.closest(
                    "[data-testid=child-badges], [data-testid=emoji-disc]",
                  ) === null,
              )[0]?.textContent ?? "",
          ),
        );
      expect(symbols.length).toBeGreaterThan(0);
      for (const symbol of symbols) {
        expect(["🌅", "🌞", "🌆"]).toContain(symbol);
      }
      expect(new Set(symbols)).toEqual(new Set(["🌅", "🌞", "🌆"]));
      // The only moons on the board are the countdown's three sleeps.
      const moonsOnBoard = await page.evaluate(
        () =>
          [...document.querySelectorAll(".font-emoji")].filter(
            (el) => el.textContent === "🌙",
          ).length,
      );
      expect(moonsOnBoard).toBe(3);
      await expect(
        page.getByTestId("countdown").locator(".font-emoji", { hasText: "🌙" }),
      ).toHaveCount(3);
      // The day button keeps its ☀️ (also at night), which no tile repeats.
      await expect(page.getByRole("button", { name: "Today" })).toContainText(
        "☀️",
      );
      expect(symbols).not.toContain("☀️");
    });
  }
});
