import { expect, type Locator, type Page, test } from "@playwright/test";

import { expectNoOverflow } from "./layout";
import { agenda, mockBoard } from "./mockApi";

/*
 * States per the design hand-off (T-32): loading skeleton, offline pill, friendly error
 * card with "reload now", the calm 401 variant and the empty day. Both tablet projects
 * run every test, so each state is checked at 1280x800 and 2000x1200.
 */

const AGENDA = agenda(
  [
    { title: "Swimming", icon: "🏊", time: "15:00", childIds: ["mia"] },
    { title: "Football", icon: "⚽", time: "10:00", day: 1 },
  ],
  [{ slot: "dinner", title: "Vegetable soup", icon: "🍲" }],
);

/** Rectangles overlap (touching edges do not count). */
function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width - 0.5 &&
    b.x < a.x + a.width - 0.5 &&
    a.y < b.y + b.height - 0.5 &&
    b.y < a.y + a.height - 0.5
  );
}

async function box(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const rect = await locator.boundingBox();
  if (rect === null) throw new Error("element has no box");
  return rect;
}

/** Running CSS animations/transitions on the page (a calm state has none). */
const runningAnimations = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((animation) => animation.playState === "running").length,
  );

test.describe("loading", () => {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`a calm skeleton of four columns and the rail, nothing moving (${reducedMotion})`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion });
      await page.route("**/api/**", () => new Promise(() => undefined));
      await page.goto("/");
      const loading = page.getByTestId("board-loading");
      await expect(loading).toBeVisible();
      await expect(loading).toHaveAttribute("aria-busy", "true");
      await expect(page.getByTestId("skeleton-column")).toHaveCount(4);
      await expect(page.getByRole("status")).toContainText("Getting the day");
      // Today's skeleton column is the widest, as on the board.
      const widths = await page
        .getByTestId("skeleton-column")
        .evaluateAll((columns) =>
          columns.map((column) => column.getBoundingClientRect().width),
        );
      expect(widths[0]).toBeGreaterThan(1.5 * (widths[1] ?? 0));
      // No spinner, no pulse.
      expect(await runningAnimations(page)).toBe(0);
      await expect(page.locator("[class*=animate-]")).toHaveCount(0);
      await expectNoOverflow(page);
    });
  }
});

test.describe("offline pill", () => {
  test("says 'Offline · as of 12:00 PM' in the bottom strip, covering nothing", async ({
    page,
    context,
  }) => {
    await mockBoard(page, { agenda: AGENDA });
    await page.goto("/?burnin=0");
    await expect(
      page.getByRole("article", { name: /^Swimming/ }),
    ).toBeVisible();
    await context.setOffline(true);

    const pill = page.locator("p[data-status]");
    await expect(pill).toHaveAttribute("data-status", "offline");
    await expect(pill).toHaveAttribute("role", "status");
    await expect(pill).toHaveText(/^Offline · as of 12:\d{2}\sPM$/u);
    await expect(pill.getByTestId("cloud-off-icon")).toBeVisible();
    // The board stays fully visible.
    await expect(
      page.getByRole("article", { name: /^Swimming/ }),
    ).toBeVisible();

    // The pill covers no column, header, rail or the fullscreen control.
    const pillBox = await box(pill);
    const viewport = page.viewportSize();
    expect(pillBox.y + pillBox.height).toBeLessThanOrEqual(
      viewport?.height ?? 0,
    );
    const others = [
      page.locator("header"),
      page.getByTestId("nav-rail"),
      page.getByRole("button", { name: /Fullscreen/ }),
      ...(await page.getByTestId("day-column").all()),
    ];
    for (const other of others) {
      expect(overlaps(pillBox, await box(other))).toBe(false);
    }
    await expectNoOverflow(page);

    // Back online: the pill goes away by itself once the refetch has landed.
    await context.setOffline(false);
    await expect(pill).toHaveCount(0);
  });
});

test.describe("error card", () => {
  test("502 without data: 🧸 card with a parent line, short code and a 64px retry that refetches at once", async ({
    page,
  }) => {
    const api = await mockBoard(page, {
      agendaStatus: 502,
      agenda: { error: "upstream_failed" },
    });
    await page.goto("/");
    const card = page.getByRole("alert");
    // After the two automatic retries of a 5xx (1 s + 2 s).
    await expect(card).toHaveAttribute("data-error", "failed", {
      timeout: 15_000,
    });
    await expect(card).toHaveAttribute("data-variant", "error");
    await expect(card).toContainText("🧸");
    await expect(
      card.getByRole("heading", { name: "Back in a moment" }),
    ).toBeVisible();
    await expect(card).toContainText("The calendar can't be reached right now");
    await expect(page.getByTestId("error-code")).toHaveText(
      "Error code for parents: KB-502",
    );
    // No raw technical message and no fixed number of seconds.
    await expect(card).not.toContainText("HTTP");
    await expect(card).not.toContainText("/api/");
    expect(await card.textContent()).not.toMatch(/\d+\s*(s|seconds)\b/u);

    const retry = card.getByRole("button", { name: "Reload now" });
    const retryBox = await box(retry);
    expect(retryBox.height).toBeGreaterThanOrEqual(64);
    expect(retryBox.width).toBeGreaterThanOrEqual(64);
    await expectNoOverflow(page);

    // The calendar is back: one press fetches at once (no waiting for a timer).
    api.agendaStatus = 200;
    api.agenda = AGENDA;
    const before = api.requests.filter((path) => path === "/api/agenda").length;
    await retry.click();
    await expect(page.getByTestId("board-ready")).toBeVisible();
    await expect(
      page.getByRole("article", { name: /^Swimming/ }),
    ).toBeVisible();
    expect(
      api.requests.filter((path) => path === "/api/agenda").length,
    ).toBeGreaterThan(before);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("401: the calm 'new access link' variant, no retry, no red, no jargon", async ({
    page,
  }) => {
    await mockBoard(page, {
      configStatus: 401,
      config: { error: "unauthorized" },
    });
    await page.goto("/");
    const card = page.getByRole("alert");
    await expect(card).toHaveAttribute("data-error", "unauthorized");
    await expect(card).toHaveAttribute("data-variant", "unauthorized");
    await expect(card).toContainText("A grown-up can fix this");
    await expect(card).toContainText("This tablet needs a new access link");
    await expect(card).toContainText("no longer valid");
    await expect(card).not.toContainText("?key=");
    await expect(card).not.toContainText(/expired|token/iu);
    await expect(page.getByTestId("error-code")).toHaveText(
      "Error code for parents: KB-401",
    );
    await expect(card.getByRole("button")).toHaveCount(0);
    // The card is the raised surface, neither the soft error tint nor the danger red.
    const colours = await card.evaluate((main) => {
      const css = getComputedStyle(document.documentElement);
      const probe = (token: string): string => {
        const el = document.createElement("span");
        el.style.backgroundColor = `var(${token})`;
        document.body.append(el);
        const value = getComputedStyle(el).backgroundColor;
        el.remove();
        return value;
      };
      const inner = main.firstElementChild;
      return {
        card: inner === null ? "" : getComputedStyle(inner).backgroundColor,
        raised: probe("--color-surface-raised"),
        softError: probe("--color-soft-error"),
        danger: probe("--color-danger"),
        hasDanger: css.getPropertyValue("--color-danger") !== "",
      };
    });
    expect(colours.hasDanger).toBe(true);
    expect(colours.card).toBe(colours.raised);
    expect(colours.card).not.toBe(colours.softError);
    expect(colours.card).not.toBe(colours.danger);
    await expectNoOverflow(page);
  });
});

test.describe("empty day", () => {
  for (const night of [false, true]) {
    test(`nothing today: the illustration in today's column, meals stay${night ? " (night)" : ""}`, async ({
      page,
    }) => {
      await mockBoard(page, {
        agenda: agenda(
          [{ title: "Football", icon: "⚽", time: "10:00", day: 1 }],
          [
            { slot: "breakfast", title: "Oatmeal", icon: "🥣" },
            { slot: "dinner", title: "Vegetable soup", icon: "🍲" },
          ],
        ),
      });
      await page.goto(`/?burnin=0&night=${night ? "1" : "0"}`);
      const today = page.getByTestId("day-column").first();
      await expect(today).toHaveAttribute("data-today", "true");
      const empty = today.getByTestId("day-empty");
      await expect(empty).toBeVisible();
      await expect(
        empty.getByRole("heading", { name: "Nothing planned today" }),
      ).toBeVisible();
      await expect(empty).toContainText("Time to play");
      const art = empty.getByTestId("day-empty-art");
      await expect(art).toBeVisible();
      await expect(art).toHaveAttribute("aria-hidden", "true");
      await expect(
        today.getByRole("img", { name: "Dinner: Vegetable soup" }),
      ).toBeVisible();
      await expect(
        today.getByRole("img", { name: "Breakfast: Oatmeal" }),
      ).toBeVisible();
      // The illustration stays above the meals.
      const artBox = await box(art);
      const mealsBox = await box(
        today.getByRole("img", { name: "Dinner: Vegetable soup" }),
      );
      expect(artBox.y + artBox.height).toBeLessThanOrEqual(mealsBox.y);
      // Night dims the emoji inside <Emoji> (design hand-off filter).
      const filter = await art
        .locator(".font-emoji")
        .first()
        .evaluate((el) => getComputedStyle(el).filter);
      if (night) {
        expect(filter).toContain("brightness(0.75)");
        expect(filter).toContain("saturate(0.8)");
      } else {
        expect(filter).not.toContain("brightness");
      }
      await expectNoOverflow(page);
    });
  }
});

test("the smallest today tiles (slim): the emoji box stays inside the child edge, the edge is drawn on top", async ({
  page,
}) => {
  // 4 past (folded), 1 current and 9 upcoming at 12:00: more than fit, so slim.
  const events = Array.from({ length: 14 }, (_, i) => ({
    title: `Football ${String(i)}`,
    icon: "⚽",
    time: `${String(8 + i).padStart(2, "0")}:30`,
    childIds: ["mia"],
  }));
  await mockBoard(page, { agenda: agenda(events, []) });
  await page.goto("/?burnin=0");
  const today = page.getByTestId("day-column").first();
  await expect(today).toHaveAttribute("data-size", "slim");
  const report = await today
    .locator("article[data-tint=single]")
    .evaluateAll((tiles) =>
      tiles.map((tile) => {
        // `after:inset-ring-4`: the child edge is 4px wide.
        const edge = 4;
        const margin = 2;
        const outer = tile.getBoundingClientRect();
        const glyph = tile.querySelector(".font-emoji");
        const emoji = glyph?.getBoundingClientRect();
        const after = getComputedStyle(tile, "::after");
        return {
          inside:
            emoji !== undefined &&
            emoji.top >= outer.top + edge - 0.5 &&
            emoji.bottom <= outer.bottom - edge + 0.5 &&
            emoji.left >= outer.left + edge - 0.5,
          // The visible emoji box clears the edge with a margin on every side.
          clear:
            emoji !== undefined &&
            emoji.top >= outer.top + edge + margin &&
            emoji.bottom <= outer.bottom - edge - margin &&
            emoji.left >= outer.left + edge + margin,
          overlay: after.position === "absolute" && after.content !== "none",
          // `leading-none`: the emoji's line box is exactly its font size.
          leadingNone:
            glyph !== null &&
            getComputedStyle(glyph).lineHeight ===
              getComputedStyle(glyph).fontSize,
        };
      }),
    );
  expect(report.length).toBeGreaterThan(0);
  for (const tile of report) {
    expect(tile.inside).toBe(true);
    expect(tile.clear).toBe(true);
    expect(tile.overlay).toBe(true);
    expect(tile.leadingNone).toBe(true);
  }
  await expectNoOverflow(page);
});
