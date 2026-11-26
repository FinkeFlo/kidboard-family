import { expect, test } from "@playwright/test";

import { agenda, mockBoard, type MockEvent } from "./mockApi";

const EVENTS: MockEvent[] = [
  { title: "Swimming", icon: "🏊", time: "07:30", childIds: ["mia"] },
  { title: "Lunch with Grandma", icon: "👵", time: "11:30" },
  { title: "Bath time", icon: "🛁", time: "18:00" },
];

/** Busy week as in week.spec.ts: 6 events and 4 meals on every day. */
const BUSY_EVENTS: MockEvent[] = Array.from({ length: 7 }, (_, day) => [
  { title: `Swimming ${String(day)}`, icon: "🏊", time: "07:30", day },
  { title: `Dentist ${String(day)}`, icon: "🦷", time: "08:30", day },
  { title: `Music ${String(day)}`, icon: "🎻", time: "10:00", day },
  { title: `Football ${String(day)}`, icon: "⚽", time: "15:00", day },
  { title: `Bath ${String(day)}`, icon: "🛁", time: "18:00", day },
  { title: `Trip ${String(day)}`, icon: "🦁", time: null, day },
]).flat();
const BUSY_MEALS = Array.from({ length: 7 }, (_, day) => [
  { slot: "breakfast", title: "Oatmeal with berries", icon: "🥣", day },
  { slot: "lunch", title: "Spaghetti with tomato sauce", icon: "🍝", day },
  { slot: "dinner", title: "Vegetable soup and bread", icon: "🍲", day },
  { slot: "unspecified", title: "Apple slices", icon: "🍎", day },
]).flat();

test.describe("fullscreen control", () => {
  test("is a quiet 64px target in the rail's bottom slot that causes no overflow", async ({
    page,
  }) => {
    await mockBoard(page, {
      agenda: agenda(EVENTS, [
        { slot: "lunch", title: "Spaghetti with tomato sauce", icon: "🍝" },
      ]),
    });
    await page.goto("/");
    const control = page.getByRole("button", { name: /fullscreen on/i });
    await expect(control).toBeVisible();

    const box = await control.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (box === null || viewport === null) return;
    expect(box.width).toBeGreaterThanOrEqual(64);
    expect(box.height).toBeGreaterThanOrEqual(64);
    // Fully inside the viewport, at the bottom, in the rail's column (merge rule 6):
    // centred under the rail and below its last element, so the rail never covers it.
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
    expect(box.y + box.height).toBeGreaterThan(viewport.height - 1);
    const rail = await page.getByTestId("nav-rail").boundingBox();
    expect(rail).not.toBeNull();
    if (rail === null) return;
    const centre = box.x + box.width / 2;
    expect(Math.abs(centre - (rail.x + rail.width / 2))).toBeLessThanOrEqual(
      // At most the burn-in amplitude (the rail drifts, the control does not).
      12.5,
    );
    expect(box.y).toBeGreaterThanOrEqual(rail.y + rail.height - 0.5);

    // It is an overlay: the document does not grow and the header keeps its place.
    const scroll = await page.evaluate(() => ({
      w: document.documentElement.scrollWidth,
      h: document.documentElement.scrollHeight,
    }));
    expect(scroll.w).toBeLessThanOrEqual(viewport.width);
    expect(scroll.h).toBeLessThanOrEqual(viewport.height);
    await expect(
      page.getByRole("heading", { level: 1, name: "Sunday" }),
    ).toBeInViewport({ ratio: 1 });
  });

  test("a short tap does nothing, a long press enters fullscreen", async ({
    page,
  }) => {
    await mockBoard(page);
    await page.goto("/");
    const control = page.getByTestId("fullscreen-control");
    await expect(control).toBeVisible();

    await control.click();
    expect(await page.evaluate(() => document.fullscreenElement !== null)).toBe(
      false,
    );
    // The tap leaves a short "press and hold" hint, fully on screen, then it goes.
    const hint = page.getByTestId("fullscreen-hint");
    await expect(hint).toHaveText("Press and hold");
    await expect(hint).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(hint).toHaveCount(0, { timeout: 5_000 });

    const box = await control.boundingBox();
    if (box === null) throw new Error("control has no box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // While held, a ring fills around the glyph.
    await expect(page.getByTestId("fullscreen-hold-ring")).toBeVisible();
    await expect(page.getByTestId("fullscreen-hold-progress")).toBeVisible();
    await page.waitForTimeout(900);
    await page.mouse.up();
    await expect(control).toHaveAttribute("data-active", "true");
    await expect(control).toBeVisible();
    await expect(page.getByTestId("fullscreen-hold-ring")).toHaveCount(0);
    await expect(hint).toHaveCount(0);
  });

  test("reduced motion: the hold shows a static ring without the sweep", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockBoard(page);
    await page.goto("/");
    const control = page.getByTestId("fullscreen-control");
    const box = await control.boundingBox();
    if (box === null) throw new Error("control has no box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.getByTestId("fullscreen-hold-ring")).toBeVisible();
    await expect(page.getByTestId("fullscreen-hold-progress")).toBeHidden();
    await page.mouse.up();
  });

  for (const view of ["Today", "Week"] as const) {
    test(`never covers content on a busy board (${view} view)`, async ({
      page,
    }) => {
      await mockBoard(page, { agenda: agenda(BUSY_EVENTS, BUSY_MEALS) });
      await page.goto("/");
      await page.getByRole("button", { name: view }).click();
      const control = page.getByTestId("fullscreen-control");
      await expect(control).toBeVisible();

      const report = await page.evaluate(() => {
        const control = document.querySelector(
          "[data-testid=fullscreen-control]",
        );
        if (control === null) throw new Error("no control");
        const c = control.getBoundingClientRect();
        const covered: string[] = [];
        for (const el of document.querySelectorAll("main *")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const overlaps =
            r.left < c.right - 0.5 &&
            r.right > c.left + 0.5 &&
            r.top < c.bottom - 0.5 &&
            r.bottom > c.top + 0.5;
          if (overlaps) {
            covered.push(`${el.tagName} ${el.textContent.slice(0, 30)}`);
          }
        }
        const root = document.documentElement;
        return {
          covered,
          doc: [root.scrollWidth, root.scrollHeight],
          view: [window.innerWidth, window.innerHeight],
          clipped: [...document.querySelectorAll("main")].filter(
            (m) => m.scrollHeight > m.clientHeight + 1,
          ).length,
        };
      });
      expect(report.covered).toEqual([]);
      expect(report.doc[0]).toBeLessThanOrEqual(report.view[0] ?? 0);
      expect(report.doc[1]).toBeLessThanOrEqual(report.view[1] ?? 0);
      expect(report.clipped).toBe(0);
    });
  }
});
