import { expect, type Page, test } from "@playwright/test";

import { expectNoOverflow, moons, withCountdown } from "./layout";
import { mockBoard } from "./mockApi";

/*
 * Burn-in protection (T-22). `?burnin=<0..7>` pins the orbit position (test hook, see
 * src/burnin/burnIn.ts); 1, 3, 5 and 7 are the corners = the maximum shift on both axes.
 */

const CORNERS = [1, 3, 5, 7] as const;
const SHOT_DIR = process.env["E2E_SCREENSHOT_DIR"];

interface Metrics {
  /** `--spacing-burn-in` and `--spacing-gutter` in px. */
  amplitude: number;
  gutter: number;
  /** Left / top / right of the heading and the bottom of the lowest `main` descendant. */
  heading: { left: number; top: number };
  toggle: { left: number; top: number; right: number };
  contentBottom: number;
  viewport: { width: number; height: number };
}

async function metrics(page: Page): Promise<Metrics> {
  return page.evaluate(() => {
    const px = (token: string): number => {
      const probe = document.createElement("div");
      probe.style.width = `var(${token})`;
      document.body.append(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      return width;
    };
    const heading = document
      .querySelector("h1")
      ?.getBoundingClientRect() as DOMRect;
    const toggle = document
      .querySelector("[data-testid=view-toggle]")
      ?.getBoundingClientRect() as DOMRect;
    let contentBottom = 0;
    for (const el of document.querySelectorAll(
      "[data-testid=burn-in-shift] *",
    )) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0)
        contentBottom = Math.max(contentBottom, r.bottom);
    }
    return {
      amplitude: px("--spacing-burn-in"),
      gutter: px("--spacing-gutter"),
      heading: { left: heading.left, top: heading.top },
      toggle: { left: toggle.left, top: toggle.top, right: toggle.right },
      contentBottom,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
}

test.describe("burn-in shift", () => {
  test("the corners move the content by the amplitude, which is smaller than the gutter", async ({
    page,
  }) => {
    await mockBoard(page, { agenda: withCountdown(14) });
    const seen = new Map<number, Metrics>();
    for (const index of [3, 7]) {
      await page.goto(`/?burnin=${String(index)}`);
      await expect(page.getByTestId("countdown")).toBeVisible();
      seen.set(index, await metrics(page));
    }
    const down = seen.get(3);
    const up = seen.get(7);
    if (down === undefined || up === undefined) throw new Error("no metrics");
    expect(down.amplitude).toBeGreaterThan(0);
    expect(down.amplitude).toBeLessThan(down.gutter);
    // Opposite corners differ by exactly two amplitudes on each axis.
    expect(down.heading.left - up.heading.left).toBeCloseTo(
      2 * down.amplitude,
      0,
    );
    expect(down.heading.top - up.heading.top).toBeCloseTo(
      2 * down.amplitude,
      0,
    );
    // The most extreme position still leaves room: left/top >= gutter - amplitude > 0.
    expect(up.heading.left).toBeGreaterThanOrEqual(
      down.gutter - down.amplitude - 0.5,
    );
    expect(up.heading.top).toBeGreaterThanOrEqual(
      down.gutter - down.amplitude - 0.5,
    );
    // The shifted-down content stays above the bottom strip of the fullscreen control.
    expect(down.contentBottom).toBeLessThanOrEqual(
      down.viewport.height - 64 + 0.5,
    );
  });

  for (const index of CORNERS) {
    test(`max shift (corner ${String(index)}) + banner + 14 moons: no overflow, no cover, both views`, async ({
      page,
      context,
    }, testInfo) => {
      await mockBoard(page, { agenda: withCountdown(14) });
      await page.goto(`/?burnin=${String(index)}`);
      await expect(page.getByTestId("burn-in-shift")).toHaveAttribute(
        "data-burn-in-x",
        index === 1 || index === 3 ? "1" : "-1",
      );
      expect(await moons(page)).toBe(14);
      await context.setOffline(true);
      await expect(page.getByRole("status")).toContainText("Offline");

      for (const view of ["Today", "Week"]) {
        await page.getByRole("button", { name: view }).click();
        expect(await moons(page)).toBe(14);
        await expectNoOverflow(page);

        // Nothing of the board overlaps the fullscreen control or the banner slot.
        const covered = await page.evaluate(() => {
          const control = document
            .querySelector("[data-testid=fullscreen-control]")
            ?.getBoundingClientRect() as DOMRect;
          const banner = document
            .querySelector("[role=status]")
            ?.getBoundingClientRect() as DOMRect;
          const hit = (a: DOMRect, b: DOMRect): boolean =>
            a.left < b.right - 0.5 &&
            a.right > b.left + 0.5 &&
            a.top < b.bottom - 0.5 &&
            a.bottom > b.top + 0.5;
          const out: string[] = [];
          for (const el of document.querySelectorAll(
            "[data-testid=burn-in-shift] *",
          )) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (hit(r, control) || hit(r, banner)) {
              out.push(`${el.tagName} ${el.textContent.slice(0, 24)}`);
            }
          }
          return out;
        });
        expect(covered).toEqual([]);
        if (SHOT_DIR !== undefined) {
          await page.screenshot({
            path: `${SHOT_DIR}/burnin-${view.split(" ")[0]?.toLowerCase() ?? ""}-corner${String(index)}-${testInfo.project.name}.png`,
          });
        }
      }
    });
  }

  test("reduced motion: the shift applies without any transition", async ({
    page,
  }) => {
    await mockBoard(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?burnin=3");
    const wrapper = page.getByTestId("burn-in-shift");
    await expect(wrapper).toBeVisible();
    const duration = await wrapper.evaluate((el) =>
      parseFloat(getComputedStyle(el).transitionDuration),
    );
    expect(duration).toBeLessThan(0.001);
    // ...and the transform is in place at once.
    const matrix = await wrapper.evaluate(
      (el) => getComputedStyle(el).transform,
    );
    expect(matrix).not.toBe("none");
  });

  test("normal motion: the shift glides, also when it falls on the night switch", async ({
    page,
  }) => {
    await mockBoard(page);
    await page.goto("/?burnin=3");
    const wrapper = page.getByTestId("burn-in-shift");
    await expect(wrapper).toBeVisible();
    const read = (): Promise<{ property: string; duration: number }> =>
      wrapper.evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          property: style.transitionProperty,
          duration: parseFloat(style.transitionDuration),
        };
      });
    const normal = await read();
    expect(normal.property).toContain("transform");
    expect(normal.duration).toBe(0.6);
    // While the theme switches (T-21) the transform keeps its transition: no jump.
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme-switching", "");
    });
    const switching = await read();
    expect(switching.property).toContain("transform");
    expect(switching.duration).toBeGreaterThan(0);
  });

  test("night mode keeps the shift (no layout change at the theme switch)", async ({
    page,
  }) => {
    await mockBoard(page);
    await page.goto("/?burnin=3&night=0");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator("h1")).toBeVisible();
    const day = await metrics(page);
    await page.goto("/?burnin=3&night=1");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
    await expect(page.locator("h1")).toBeVisible();
    const night = await metrics(page);
    expect(night.heading).toEqual(day.heading);
    expect(night.toggle).toEqual(day.toggle);
  });
});

test.describe("the rail's view toggle keeps its place when the banner appears", () => {
  test("same position online and offline, with countdown, in both views", async ({
    page,
    context,
  }, testInfo) => {
    await mockBoard(page, { agenda: withCountdown(14) });
    // Pinned so that a step of the orbit cannot fall between the two measurements.
    await page.goto("/?burnin=0");
    await expect(page.getByTestId("countdown")).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);

    const positions: Record<string, Metrics["toggle"]> = {};
    for (const view of ["Today", "Week"]) {
      await page.getByRole("button", { name: view }).click();
      positions[`online ${view}`] = (await metrics(page)).toggle;
    }

    await context.setOffline(true);
    await expect(page.getByRole("status")).toContainText("Offline");
    for (const view of ["Today", "Week"]) {
      await page.getByRole("button", { name: view }).click();
      positions[`offline ${view}`] = (await metrics(page)).toggle;
      await expectNoOverflow(page);
      if (SHOT_DIR !== undefined) {
        await page.screenshot({
          path: `${SHOT_DIR}/banner-slot-${view.split(" ")[0]?.toLowerCase() ?? ""}-${testInfo.project.name}.png`,
        });
      }
    }

    for (const view of ["Today", "Week"]) {
      expect(positions[`offline ${view}`]).toEqual(positions[`online ${view}`]);
    }
    // The rail's buttons start at the top, next to the heading's row.
    const online = positions["online Today"];
    const { viewport } = await metrics(page);
    expect(online?.top).toBeLessThan(viewport.height * 0.2);
  });
});
