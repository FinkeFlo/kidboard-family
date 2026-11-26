import { expect, type Page, test } from "@playwright/test";

import {
  agenda,
  at,
  config,
  mockBoard,
  type MockEvent,
  QUERY_CACHE_KEY,
} from "./mockApi";

const SHOT_DIR = process.env["E2E_SCREENSHOT_DIR"];

/** Sunday evening in Berlin, inside the default night window 19:30-06:30. */
const NIGHT_NOW = at("21:00");
const LIGHT_BG = "rgb(251, 246, 238)"; // --color-surface (light)
const NIGHT_BG = "rgb(20, 16, 12)"; // --color-surface (night)

const EVENTS: MockEvent[] = Array.from({ length: 7 }, (_, day) => [
  { title: `Swimming ${String(day)}`, icon: "🏊", time: "07:30", day },
  { title: `Music ${String(day)}`, icon: "🎻", time: "10:00", day },
  { title: `Football ${String(day)}`, icon: "⚽", time: "15:00", day },
  { title: `Bath ${String(day)}`, icon: "🛁", time: "18:00", day },
  { title: `Trip ${String(day)}`, icon: "🦁", time: null, day },
]).flat();
EVENTS.push({
  title: "Birthday party",
  icon: "🎂",
  time: "16:00",
  day: 3,
  countdown: true,
});
const MEALS = Array.from({ length: 7 }, (_, day) => [
  { slot: "breakfast", title: "Oatmeal with berries", icon: "🥣", day },
  { slot: "lunch", title: "Spaghetti with tomato sauce", icon: "🍝", day },
  { slot: "dinner", title: "Vegetable soup and bread", icon: "🍲", day },
]).flat();

const theme = (page: Page): Promise<string | null> =>
  page.evaluate(() => document.documentElement.getAttribute("data-theme"));

const bodyBackground = (page: Page): Promise<string> =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

async function expectNoOverflow(page: Page): Promise<void> {
  const report = await page.evaluate(() => {
    const root = document.documentElement;
    const clipped: string[] = [];
    const outside: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(
      "main, header, [data-testid=column-events], [data-testid=week-board], [data-testid=day-column], article",
    )) {
      if (
        el.scrollHeight > el.clientHeight + 1 ||
        el.scrollWidth > el.clientWidth + 1
      ) {
        clipped.push(`${el.tagName} ${el.textContent.slice(0, 30)}`);
      }
      const rect = el.getBoundingClientRect();
      if (
        rect.left < -0.5 ||
        rect.top < -0.5 ||
        rect.right > window.innerWidth + 0.5 ||
        rect.bottom > window.innerHeight + 0.5
      ) {
        outside.push(el.textContent.slice(0, 30));
      }
    }
    return {
      docScroll: [root.scrollWidth, root.scrollHeight],
      viewport: [window.innerWidth, window.innerHeight],
      clipped,
      outside,
    };
  });
  expect(report.docScroll[0]).toBeLessThanOrEqual(report.viewport[0] ?? 0);
  expect(report.docScroll[1]).toBeLessThanOrEqual(report.viewport[1] ?? 0);
  expect(report.clipped).toEqual([]);
  expect(report.outside).toEqual([]);
}

test.describe("night mode", () => {
  test("is on at night by the config clock; day and week view fit without overflow", async ({
    page,
  }, testInfo) => {
    await mockBoard(page, {
      agenda: agenda(EVENTS, MEALS),
      now: NIGHT_NOW,
    });
    await page.goto("/");
    await expect(page.getByTestId("board-ready")).toBeVisible();
    expect(await theme(page)).toBe("night");
    expect(await bodyBackground(page)).toBe(NIGHT_BG);
    await expectNoOverflow(page);
    if (SHOT_DIR !== undefined) {
      await page.screenshot({
        path: `${SHOT_DIR}/night-day-${testInfo.project.name}.png`,
      });
    }

    await page.getByRole("button", { name: "Week" }).click();
    await expect(page.getByTestId("day-column")).toHaveCount(7);
    expect(await theme(page)).toBe("night");
    await expectNoOverflow(page);
    if (SHOT_DIR !== undefined) {
      await page.screenshot({
        path: `${SHOT_DIR}/night-week-${testInfo.project.name}.png`,
      });
    }
  });

  test("is off at midday", async ({ page }) => {
    await mockBoard(page, { agenda: agenda(EVENTS, MEALS) });
    await page.goto("/");
    await expect(page.getByTestId("board-ready")).toBeVisible();
    expect(await theme(page)).toBe("light");
    expect(await bodyBackground(page)).toBe(LIGHT_BG);
  });

  test("?night=1 forces night at midday and ?night=0 forces day at night", async ({
    page,
  }) => {
    await mockBoard(page, { agenda: agenda(EVENTS, MEALS) });
    await page.goto("/?night=1");
    await expect(page.getByTestId("board-ready")).toBeVisible();
    expect(await theme(page)).toBe("night");
    await expectNoOverflow(page);

    await page.goto("/");
    await expect(page.getByTestId("board-ready")).toBeVisible();
    expect(await theme(page)).toBe("light");
  });

  test("?night=0 forces day inside the night window", async ({ page }) => {
    await mockBoard(page, { agenda: agenda(EVENTS, MEALS), now: NIGHT_NOW });
    await page.goto("/?night=0");
    await expect(page.getByTestId("board-ready")).toBeVisible();
    expect(await theme(page)).toBe("light");
  });

  test("respects a disabled night mode", async ({ page }) => {
    await mockBoard(page, {
      agenda: agenda(EVENTS, MEALS),
      now: NIGHT_NOW,
      config: config({ nightMode: { enabled: false } }),
    });
    await page.goto("/");
    await expect(page.getByTestId("board-ready")).toBeVisible();
    expect(await theme(page)).toBe("light");
  });

  test("updates <meta name=theme-color> with the theme", async ({ page }) => {
    await mockBoard(page, { agenda: agenda(EVENTS, MEALS) });
    await page.goto("/");
    await expect(page.getByTestId("board-ready")).toBeVisible();
    const meta = page.locator('meta[name="theme-color"]');
    const lightValue = await meta.getAttribute("content");
    expect(lightValue).toBe("#a63a08");

    await mockBoard(page, { agenda: agenda(EVENTS, MEALS), now: NIGHT_NOW });
    await page.goto("/");
    await expect(page.getByTestId("board-ready")).toBeVisible();
    await expect(meta).toHaveAttribute("content", "#14100c");
  });

  test("switches by itself at 19:30 and fades the colours", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    // 5 s before 19:30 Berlin; the clock keeps ticking.
    await mockBoard(page, {
      agenda: agenda(EVENTS, MEALS),
      now: at("19:29:55"),
    });
    await page.goto("/");
    await expect(page.getByTestId("board-ready")).toBeVisible();
    expect(await theme(page)).toBe("light");
    expect(await bodyBackground(page)).toBe(LIGHT_BG);

    await expect.poll(() => theme(page), { timeout: 20_000 }).toBe("night");
    // During the switch the transition is on (0.6 s), afterwards the colour has settled.
    await expect.poll(() => bodyBackground(page)).toBe(NIGHT_BG);
    await expect(page.locator("html")).not.toHaveAttribute(
      "data-theme-switching",
      "",
    );
  });

  test("the transition duration is the slow token during a switch", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await mockBoard(page, {
      agenda: agenda(EVENTS, MEALS),
      now: at("19:29:55"),
    });
    await page.goto("/");
    await expect(page.getByTestId("board-ready")).toBeVisible();
    const seconds = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const root = document.documentElement;
          new MutationObserver((_records, observer) => {
            if (root.hasAttribute("data-theme-switching")) {
              observer.disconnect();
              resolve(
                parseFloat(getComputedStyle(document.body).transitionDuration),
              );
            }
          }).observe(root, { attributes: true });
        }),
    );
    expect(seconds).toBeCloseTo(0.6, 2);
  });

  test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("switches without any transition", async ({ page }) => {
      test.setTimeout(60_000);
      await mockBoard(page, {
        agenda: agenda(EVENTS, MEALS),
        now: at("19:29:55"),
      });
      await page.goto("/");
      await expect(page.getByTestId("board-ready")).toBeVisible();
      const seconds = await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const root = document.documentElement;
            new MutationObserver((_records, observer) => {
              if (root.getAttribute("data-theme") === "night") {
                observer.disconnect();
                resolve(
                  parseFloat(
                    getComputedStyle(document.body).transitionDuration,
                  ),
                );
              }
            }).observe(root, { attributes: true });
          }),
      );
      // 0.01 ms at most: effectively instant.
      expect(seconds).toBeLessThan(0.001);
      await expect.poll(() => bodyBackground(page)).toBe(NIGHT_BG);
    });
  });
});

test.describe("theme before the config is known", () => {
  const THEME_KEY = "kidboard.theme";
  const rememberedTheme = (page: Page): Promise<string | null> =>
    page.evaluate((key: string) => window.localStorage.getItem(key), THEME_KEY);

  /**
   * From the next navigation on: no persisted query cache (a cold start without a known
   * config), and `window.__firstPaintTheme` = the theme on <html> when <body> is created,
   * i.e. before anything can be painted.
   */
  async function coldStart(page: Page): Promise<void> {
    await page.addInitScript((cacheKey: string) => {
      window.localStorage.removeItem(cacheKey);
      const record = window as unknown as { __firstPaintTheme?: string | null };
      new MutationObserver((_records, observer) => {
        if (document.querySelector("body") !== null) {
          record.__firstPaintTheme =
            document.documentElement.getAttribute("data-theme");
          observer.disconnect();
        }
      }).observe(document, { childList: true, subtree: true });
    }, QUERY_CACHE_KEY);
  }
  const firstPaintTheme = (page: Page): Promise<string | null | undefined> =>
    page.evaluate(
      () =>
        (window as unknown as { __firstPaintTheme?: string | null })
          .__firstPaintTheme,
    );

  for (const configFails of [true, false]) {
    test(`a cold start at night paints the ${configFails ? "error screen" : "skeleton"} in night tokens`, async ({
      page,
    }) => {
      const api = await mockBoard(page, {
        agenda: agenda(EVENTS, MEALS),
        now: NIGHT_NOW,
      });
      await page.goto("/");
      await expect(page.getByTestId("board-ready")).toBeVisible();
      await expect.poll(() => rememberedTheme(page)).toBe("night");

      await coldStart(page);
      if (configFails) {
        api.configStatus = 500;
        api.config = { error: "server_misconfigured" };
      } else {
        await page.route("**/api/config", () => new Promise(() => undefined));
      }
      await page.goto("/");
      if (configFails) {
        // After the two retries of a 5xx.
        await expect(page.getByRole("alert")).toHaveAttribute(
          "data-error",
          "failed",
          { timeout: 15_000 },
        );
      } else {
        await expect(page.getByRole("status")).toContainText("Getting the day");
      }
      expect(await firstPaintTheme(page)).toBe("night");
      expect(await theme(page)).toBe("night");
      expect(await bodyBackground(page)).toBe(NIGHT_BG);
    });
  }

  test("the ?night override is never remembered", async ({ page }) => {
    await mockBoard(page, { agenda: agenda(EVENTS, MEALS) });
    await page.goto("/");
    await expect(page.getByTestId("board-ready")).toBeVisible();
    await expect.poll(() => rememberedTheme(page)).toBe("light");

    await page.goto("/?night=1");
    await expect(page.getByTestId("board-ready")).toBeVisible();
    expect(await theme(page)).toBe("night");
    expect(await rememberedTheme(page)).toBe("light");

    // A later cold start from a clean URL is light again, from the first paint on.
    await coldStart(page);
    await page.route("**/api/config", () => new Promise(() => undefined));
    await page.goto("/");
    await expect(page.getByRole("status")).toContainText("Getting the day");
    expect(await firstPaintTheme(page)).toBe("light");
    expect(await bodyBackground(page)).toBe(LIGHT_BG);
  });

  test("without usable localStorage the board still loads and follows the clock", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get(): Storage {
          throw new DOMException("blocked", "SecurityError");
        },
      });
    });
    await mockBoard(page, { agenda: agenda(EVENTS, MEALS), now: NIGHT_NOW });
    await page.goto("/");
    await expect(page.getByTestId("board-ready")).toBeVisible();
    expect(
      await page.evaluate(() => {
        try {
          return typeof window.localStorage;
        } catch {
          return "blocked";
        }
      }),
    ).toBe("blocked");
    expect(await theme(page)).toBe("night");
    expect(await bodyBackground(page)).toBe(NIGHT_BG);
    expect(errors).toEqual([]);
  });
});
