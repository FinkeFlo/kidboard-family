import { describe, expect, it } from "vitest";

import {
  BRING_EXTRA_REM,
  type EventStatus,
  TILE_HEIGHT_REM,
} from "../components/EventTile";
import { COLUMN_GAP_REM, SUMMARY_ROW_REM } from "../day/columnCapacity";
import { fitWeekColumn, WEEK_SIZES, weekRowsRem } from "./weekCapacity";

const WEEK = TILE_HEIGHT_REM.week;
const DENSE = TILE_HEIGHT_REM["week-dense"];
const SMALL = TILE_HEIGHT_REM["week-small"];
const SLIM = TILE_HEIGHT_REM["week-slim"];

interface Item {
  id: number;
  status: EventStatus;
}

/** `n` upcoming items, most important first. */
const list = (n: number, status: EventStatus = "upcoming"): Item[] =>
  Array.from({ length: n }, (_, id) => ({ id, status }));
const ids = (items: readonly Item[]): number[] => items.map((item) => item.id);
/** Height of `tiles` tiles plus `summaries` summary rows, with the gaps between. */
const rows = (tiles: number, tile: number, summaries = 0): number => {
  const count = tiles + summaries;
  return count === 0
    ? 0
    : tiles * tile + summaries * SUMMARY_ROW_REM + (count - 1) * COLUMN_GAP_REM;
};
/**
 * A day like today's week column: upcoming ones first, then `past` finished ones (the
 * ranking puts finished events last).
 */
const today = (upcoming: number, past: number): Item[] => [
  ...list(upcoming),
  ...Array.from({ length: past }, (_, i) => ({
    id: upcoming + i,
    status: "past" as const,
  })),
];

describe("fitWeekColumn", () => {
  it("steps from the normal to the dense, the small and the slim week size", () => {
    expect(WEEK_SIZES).toEqual([
      "week",
      "week-dense",
      "week-small",
      "week-slim",
    ]);
    expect(DENSE).toBeLessThan(WEEK);
    expect(SMALL).toBeLessThan(DENSE);
    expect(SLIM).toBeLessThan(SMALL);
  });

  it("shows everything until the column is measured", () => {
    expect(fitWeekColumn(list(3), null)).toEqual({
      size: "week",
      visible: list(3),
      past: [],
      hidden: [],
    });
    expect(fitWeekColumn(list(7), null).size).toBe("week-dense");
    expect(fitWeekColumn(list(7), null).hidden).toEqual([]);
  });

  it("has no +N when all tiles fit, however many (no fixed count)", () => {
    const fit = fitWeekColumn(list(5), rows(5, DENSE));
    expect(fit.visible).toHaveLength(5);
    expect(fit.hidden).toEqual([]);
    // Exactly full at the normal size: still no +N.
    expect(fitWeekColumn(list(4), rows(4, WEEK))).toMatchObject({
      size: "week",
      hidden: [],
    });
  });

  it("decides by space alone: six or more events stay normal while they fit", () => {
    expect(fitWeekColumn(list(7), rows(7, WEEK)).size).toBe("week");
  });

  it("goes dense before it hides: five events that do not fit at the normal size", () => {
    const height = rows(5, DENSE);
    expect(rows(5, WEEK)).toBeGreaterThan(height);
    expect(fitWeekColumn(list(5), height)).toMatchObject({
      size: "week-dense",
      hidden: [],
    });
  });

  it("keeps finished events as receded tiles while everything fits", () => {
    const items = today(2, 2);
    const fit = fitWeekColumn(items, rows(4, WEEK));
    expect(fit).toMatchObject({ size: "week", past: [], hidden: [] });
    expect(ids(fit.visible)).toEqual([0, 1, 2, 3]);
  });

  it("folds every finished event into the strip before an upcoming one is hidden", () => {
    // Room for 3 normal tiles plus the strip, not for all 6 tiles.
    const items = today(3, 3);
    const fit = fitWeekColumn(items, rows(3, WEEK, 1));
    expect(fit.size).toBe("week");
    expect(ids(fit.visible)).toEqual([0, 1, 2]);
    expect(ids(fit.past)).toEqual([3, 4, 5]);
    expect(fit.hidden).toEqual([]);
  });

  it("folds the finished events first, then shrinks, then hides the least important", () => {
    const items = today(5, 4);
    // Dense tiles for all five upcoming ones plus the strip.
    const shrunk = fitWeekColumn(items, rows(5, DENSE, 1));
    expect(shrunk.size).toBe("week-dense");
    expect(ids(shrunk.visible)).toEqual([0, 1, 2, 3, 4]);
    expect(shrunk.past).toHaveLength(4);
    expect(shrunk.hidden).toEqual([]);
    // Small, then slim tiles before anything is hidden.
    expect(fitWeekColumn(items, rows(5, SMALL, 1))).toMatchObject({
      size: "week-small",
      hidden: [],
    });
    expect(fitWeekColumn(items, rows(5, SLIM, 1))).toMatchObject({
      size: "week-slim",
      hidden: [],
    });
    // Room for three slim tiles, the strip and "+N": the last two upcoming are summed up.
    const hidden = fitWeekColumn(items, rows(3, SLIM, 2));
    expect(hidden.size).toBe("week-slim");
    expect(ids(hidden.visible)).toEqual([0, 1, 2]);
    expect(ids(hidden.hidden)).toEqual([3, 4]);
    expect(hidden.past).toHaveLength(4);
    // A finished event never takes a slot while an upcoming one is hidden.
    expect(hidden.visible.every((item) => item.status !== "past")).toBe(true);
  });

  it("sums up the least important events, keeping room for the +N row", () => {
    const height = rows(3, SLIM, 1);
    const fit = fitWeekColumn(list(8), height);
    expect(fit.size).toBe("week-slim");
    expect(ids(fit.visible)).toEqual([0, 1, 2]);
    expect(ids(fit.hidden)).toEqual([3, 4, 5, 6, 7]);
    expect(fit.past).toEqual([]);
  });

  it("never loses an event and never exceeds the height, for every height and mix", () => {
    for (let count = 0; count <= 12; count += 1) {
      for (let pastCount = 0; pastCount <= count; pastCount += 3) {
        const items = today(count - pastCount, pastCount);
        for (let height = 0; height <= 40; height += 0.25) {
          const fit = fitWeekColumn(items, height);
          expect(
            ids([...fit.visible, ...fit.past, ...fit.hidden]).sort(
              (a, b) => a - b,
            ),
          ).toEqual(ids(items));
          // Past events are either all tiles (nothing folded or hidden) or all folded.
          if (fit.past.length > 0) {
            expect(fit.past).toHaveLength(pastCount);
          }
          if (fit.hidden.length > 0) {
            expect(fit.visible.some((item) => item.status === "past")).toBe(
              false,
            );
          }
          const summaries =
            (fit.past.length > 0 ? 1 : 0) + (fit.hidden.length > 0 ? 1 : 0);
          const used = rows(
            fit.visible.length,
            TILE_HEIGHT_REM[fit.size],
            summaries,
          );
          // A column too short even for one tile shows only the summaries (they may
          // not fit below ~5 rem; nothing smaller exists).
          if (height >= 2 * SUMMARY_ROW_REM + COLUMN_GAP_REM) {
            expect(used).toBeLessThanOrEqual(height + 1e-6);
          }
        }
      }
    }
  });

  it("sums up only when one more slim tile would not fit (no +N above free space)", () => {
    for (let tiles = 1; tiles <= 7; tiles += 1) {
      // Just too short for one more tile next to the "+N" row: exactly `tiles` stay.
      const short = rows(tiles + 1, SLIM, 1) - 0.01;
      const fit = fitWeekColumn(list(tiles + 3), short);
      expect(fit.visible).toHaveLength(tiles);
      // The space left below is less than one more tile with its gap.
      expect(short - rows(tiles, SLIM, 1)).toBeLessThan(SLIM + COLUMN_GAP_REM);
      // With room for that tile, it is shown.
      expect(
        fitWeekColumn(list(tiles + 3), rows(tiles + 1, SLIM, 1)).visible,
      ).toHaveLength(tiles + 1);
    }
  });

  it("keeps a busy today whole in the measured week column (1280x800: 23.8 rem)", () => {
    // The demo's today at 10:20: two finished, six upcoming (one all-day).
    const fit = fitWeekColumn(today(6, 2), 23.8);
    expect(fit.size).toBe("week-slim");
    expect(fit.visible).toHaveLength(6);
    expect(fit.past).toHaveLength(2);
    expect(fit.hidden).toEqual([]);
    // At 16:10: four finished, four upcoming fit as small stacked tiles.
    expect(fitWeekColumn(today(4, 4), 23.8)).toMatchObject({
      size: "week-small",
      hidden: [],
    });
  });

  it("shows only +N in a column too short for one tile", () => {
    const fit = fitWeekColumn(list(3), SUMMARY_ROW_REM + 0.5);
    expect(fit.visible).toEqual([]);
    expect(ids(fit.hidden)).toEqual([0, 1, 2]);
  });

  it("handles a day of only finished events that does not fit", () => {
    const fit = fitWeekColumn(list(4, "past"), SUMMARY_ROW_REM + 0.5);
    expect(fit).toMatchObject({ visible: [], hidden: [] });
    expect(fit.past).toHaveLength(4);
  });
});

describe("fitWeekColumn with bring lists", () => {
  it("every week size grows by a chip row for a tile with a bring list, and keeps its order", () => {
    const withChips = WEEK_SIZES.map(
      (size) => TILE_HEIGHT_REM[size] + BRING_EXTRA_REM[size],
    );
    for (const size of WEEK_SIZES) {
      expect(BRING_EXTRA_REM[size]).toBeGreaterThan(0);
    }
    expect(withChips).toEqual([...withChips].sort((a, b) => b - a));
  });

  it("counts the chip row of exactly the tiles that show one", () => {
    const items = list(3);
    const plain = weekRowsRem(items, "week", 0);
    expect(plain).toBe(rows(3, WEEK));
    expect(weekRowsRem(items, "week", 0, items.slice(0, 1)) - plain).toBe(
      BRING_EXTRA_REM.week,
    );
    expect(weekRowsRem([], "week", 2)).toBe(rows(0, WEEK, 2));
  });

  it("steps down sooner when tiles carry chips, without a +N while they fit", () => {
    const items = list(3);
    const height = rows(3, WEEK);
    expect(fitWeekColumn(items, height).size).toBe("week");
    const fit = fitWeekColumn(items, height, items);
    expect(fit.size).toBe("week-dense");
    expect(fit.hidden).toEqual([]);
  });

  it("sweep with bring lists: never loses an event, never exceeds the height, +N only when one more tile would not fit", () => {
    const masks: ((index: number) => boolean)[] = [
      () => true,
      (index) => index % 2 === 1,
      (index) => index === 0,
    ];
    for (let count = 0; count <= 12; count += 1) {
      for (let pastCount = 0; pastCount <= count; pastCount += 3) {
        const items = today(count - pastCount, pastCount);
        for (const mask of masks) {
          const bring = items.filter(
            (item, index) => mask(index) && item.status !== "past",
          );
          for (let height = 0; height <= 40; height += 0.25) {
            const fit = fitWeekColumn(items, height, bring);
            expect(
              ids([...fit.visible, ...fit.past, ...fit.hidden]).sort(
                (a, b) => a - b,
              ),
            ).toEqual(ids(items));
            const summaries =
              (fit.past.length > 0 ? 1 : 0) + (fit.hidden.length > 0 ? 1 : 0);
            const used = weekRowsRem(fit.visible, fit.size, summaries, bring);
            const slimWithChips = SLIM + BRING_EXTRA_REM["week-slim"];
            if (
              height >=
              slimWithChips + 2 * SUMMARY_ROW_REM + 2 * COLUMN_GAP_REM
            ) {
              expect(used).toBeLessThanOrEqual(height + 1e-6);
            }
            if (fit.hidden.length > 0) {
              expect(fit.size).toBe("week-slim");
              // One more tile (the next hidden one) would not have fitted.
              const more = [...fit.visible, fit.hidden[0]].flatMap((item) =>
                item === undefined ? [] : [item],
              );
              const rest = fit.hidden.length > 1 ? 1 : 0;
              expect(
                weekRowsRem(
                  more,
                  "week-slim",
                  (fit.past.length > 0 ? 1 : 0) + rest,
                  bring,
                ),
              ).toBeGreaterThan(height + 1e-6);
            }
          }
        }
      }
    }
  });
});
