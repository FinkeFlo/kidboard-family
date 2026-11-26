import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { agenda, type MockEvent } from "./mockApi";

/** A busy board: 6 events on each of the next 7 days, 4 meals a day. */
export const BUSY: MockEvent[] = Array.from({ length: 7 }, (_, day) => [
  { title: `Swimming ${String(day)}`, icon: "🏊", time: "07:30", day },
  { title: `Dentist ${String(day)}`, icon: "🦷", time: "08:30", day },
  { title: `Music ${String(day)}`, icon: "🎻", time: "11:30", day },
  { title: `Football ${String(day)}`, icon: "⚽", time: "15:00", day },
  { title: `Bath ${String(day)}`, icon: "🛁", time: "18:00", day },
  { title: `Trip ${String(day)}`, icon: "🦁", time: null, day },
]).flat();
export const MEALS = Array.from({ length: 7 }, (_, day) => [
  { slot: "breakfast", title: "Oatmeal with berries", icon: "🥣", day },
  { slot: "lunch", title: "Spaghetti with tomato sauce", icon: "🍝", day },
  { slot: "dinner", title: "Vegetable soup and bread", icon: "🍲", day },
  { slot: "unspecified", title: "Apple slices", icon: "🍎", day },
]).flat();

export function withCountdown(day: number, extra: MockEvent[] = []): unknown {
  return agenda(
    [
      ...BUSY,
      {
        title: "Christmas party",
        icon: "🎄",
        time: null,
        day,
        countdown: true,
      },
      ...extra,
    ],
    MEALS,
  );
}

/** Nothing scrolls, is clipped or leaves the viewport; the countdown stays in the header. */
export async function expectNoOverflow(page: Page): Promise<void> {
  const report = await page.evaluate(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const root = document.documentElement;
    const problems: string[] = [];
    const inside = (rect: DOMRect, box: DOMRect): boolean =>
      rect.left >= box.left - 0.5 &&
      rect.top >= box.top - 0.5 &&
      rect.right <= box.right + 0.5 &&
      rect.bottom <= box.bottom + 0.5;
    const screen = new DOMRect(0, 0, viewport.width, viewport.height);
    // `column-events` clips (overflow hidden), so its own scroll size reveals a cut tile.
    for (const el of document.querySelectorAll<HTMLElement>(
      "main, header, [data-testid=countdown], [data-testid=day-column], [data-testid=column-events], [data-testid=nav-rail], article",
    )) {
      const name = `${el.tagName}[${el.dataset["testid"] ?? ""}] ${el.textContent.slice(0, 24)}`;
      if (el.scrollHeight > el.clientHeight + 1) problems.push(`${name} h`);
      if (el.scrollWidth > el.clientWidth + 1) problems.push(`${name} w`);
      if (!inside(el.getBoundingClientRect(), screen)) {
        problems.push(`${name} off-screen`);
      }
    }
    // Every part of the countdown lies inside it, and it lies inside the header.
    const countdown = document.querySelector("[data-testid=countdown]");
    const header = document.querySelector("header");
    if (countdown !== null && header !== null) {
      const box = countdown.getBoundingClientRect();
      if (!inside(box, header.getBoundingClientRect())) {
        problems.push("countdown outside header");
      }
      for (const part of countdown.querySelectorAll("span")) {
        if (!inside(part.getBoundingClientRect(), box)) {
          problems.push(`countdown part ${part.textContent}`);
        }
      }
    }
    // Every list item, tile, badge, strip and now line lies inside its day column.
    for (const column of document.querySelectorAll(
      "[data-testid=day-column]",
    )) {
      const box = column.getBoundingClientRect();
      for (const item of column.querySelectorAll(
        "li, article, [data-testid=child-badges], [data-testid=past-strip], [data-testid=now-line]",
      )) {
        if (!inside(item.getBoundingClientRect(), box)) {
          problems.push(`escaping ${item.textContent.slice(0, 24)}`);
        }
      }
    }
    return {
      docScroll: [root.scrollWidth, root.scrollHeight],
      viewport: [viewport.width, viewport.height],
      problems,
    };
  });
  expect(report.docScroll[0]).toBeLessThanOrEqual(report.viewport[0] ?? 0);
  expect(report.docScroll[1]).toBeLessThanOrEqual(report.viewport[1] ?? 0);
  expect(report.problems).toEqual([]);
}

/**
 * Smallest emoji size (rem) of today's tile sizes: large 3.5rem, medium 3rem, dense
 * 2.75rem, slim 2rem (the last step before "+N"); prominent tiles are larger still.
 */
export function minEmojiRem(size: string): number {
  if (size === "large") return 3.5;
  if (size === "medium") return 3;
  // Today's last step before "+N": title and time in one row, emoji as on week tiles.
  if (size === "slim") return 2;
  return 2.75;
}

/** Moon symbols drawn in the countdown. */
export async function moons(page: Page): Promise<number> {
  return page
    .getByTestId("countdown")
    .locator(".font-emoji")
    .filter({ hasText: /^🌙$/u })
    .count();
}

export interface ColumnAccount {
  /** Accessible names of the timed tiles shown. */
  shown: string[];
  /** Events folded into the "vorbei" strip, and the strip's accessible name. */
  folded: number;
  stripName: string;
  /** Events summed up in the trailing "+N", and its screen-reader text. */
  hidden: number;
  hiddenText: string;
}

/** What a day column does with its timed events: shown, folded, summed up. */
export async function columnAccount(column: Locator): Promise<ColumnAccount> {
  const list = column.getByTestId("column-events");
  const shown = await list
    .getByTestId("event-tile")
    .evaluateAll((tiles) =>
      tiles.map((tile) => tile.getAttribute("aria-label") ?? ""),
    );
  const strip = list.getByTestId("past-strip");
  const more = list.getByTestId("column-more");
  const folded =
    (await strip.count()) > 0
      ? Number(await strip.getAttribute("data-count"))
      : 0;
  const hidden =
    (await more.count()) > 0
      ? Number(await more.getAttribute("data-count"))
      : 0;
  return {
    shown,
    folded,
    stripName:
      folded > 0 ? ((await strip.getAttribute("aria-label")) ?? "") : "",
    hidden,
    hiddenText:
      hidden > 0 ? ((await more.locator(".sr-only").textContent()) ?? "") : "",
  };
}

export interface ClothingPlacement {
  /** Icon size (rem) the row picked to stay on one line. */
  iconRem: number;
  /** Overlaps, cut icons, parts outside today's column, icons below 1.5rem. */
  problems: string[];
  /** The clothing pill sits on the heading row (beside the chip), not wrapped below it. */
  sameLine: boolean;
}

/**
 * Where today's clothing pill (T-49) sits: in the heading row before the weather chip (it
 * must never wrap below it); never over the heading, the chip or the event list, whole
 * icons only, each at least 1.5rem. `iconRem` is the size the row picked.
 */
export async function clothingPlacement(
  page: Page,
): Promise<ClothingPlacement> {
  // The fit is checked again once the web fonts are in: measure after them.
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
  return page
    .locator("[data-testid=day-column][data-today=true]")
    .evaluate((column) => {
      const problems: string[] = [];
      const row = column.querySelector("[data-testid=clothing-row]");
      const chip = column.querySelector(
        "[data-testid=weather-head] [data-testid=weather-chip]",
      );
      const heading = column.querySelector("h2");
      const list = column.querySelector("[data-testid=column-events]");
      if (row === null || heading === null || list === null) {
        return { problems: ["missing part"], sameLine: false, iconRem: 0 };
      }
      const inside = (rect: DOMRect, outer: DOMRect): boolean =>
        rect.left >= outer.left - 0.5 &&
        rect.right <= outer.right + 0.5 &&
        rect.top >= outer.top - 0.5 &&
        rect.bottom <= outer.bottom + 0.5;
      const overlap = (a: DOMRect, b: DOMRect): boolean =>
        a.left < b.right - 0.5 &&
        b.left < a.right - 0.5 &&
        a.top < b.bottom - 0.5 &&
        b.top < a.bottom - 0.5;
      const box = row.getBoundingClientRect();
      // The chip may have given way (evening fallback): the pill's own line then counts.
      const chipBox = chip?.getBoundingClientRect() ?? box;
      const headingBox = heading.getBoundingClientRect();
      const columnBox = column.getBoundingClientRect();
      if (!inside(box, columnBox)) problems.push("row out");
      if (!inside(chipBox, columnBox)) problems.push("chip out");
      if (chip !== null && overlap(box, chipBox)) {
        problems.push("row over the chip");
      }
      if (overlap(box, headingBox)) problems.push("row over the heading");
      if (chip !== null && overlap(chipBox, headingBox)) {
        problems.push("chip over the heading");
      }
      // The pill is never clipped by the weather head (nothing hides on its left).
      const head = column.querySelector("[data-testid=weather-head]");
      if (head !== null && !inside(box, head.getBoundingClientRect())) {
        problems.push("row clipped");
      }
      if (box.bottom > list.getBoundingClientRect().top + 0.5)
        problems.push("row over the events");
      for (const item of row.querySelectorAll("[data-testid=clothing-item]")) {
        if (!inside(item.getBoundingClientRect(), box)) {
          problems.push(`cut item ${item.textContent}`);
        }
      }
      const rem = parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      for (const icon of row.querySelectorAll(
        "[data-testid=clothing-item] .font-emoji, [data-testid=clothing-pictogram]",
      )) {
        const size = parseFloat(getComputedStyle(icon).fontSize) / rem;
        if (size < 1.5 - 0.01) problems.push(`small icon ${String(size)}`);
      }
      // The heading keeps its whole text ("Today" is never cut by the weather).
      if (heading.scrollWidth > heading.clientWidth + 1) {
        problems.push("heading cut");
      }
      const middle = (box.top + box.bottom) / 2;
      return {
        problems,
        sameLine: middle > chipBox.top && middle < chipBox.bottom,
        iconRem: Number(row.getAttribute("data-icon-rem")),
      };
    });
}
