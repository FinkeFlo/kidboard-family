import { describe, expect, it } from "vitest";

import {
  BRING_EXTRA_REM,
  PROMINENT_EXTRA_REM,
  TILE_HEIGHT_REM,
} from "../components/EventTile";
import {
  COLUMN_GAP_REM,
  DAY_SIZES,
  fitColumn,
  freeRem,
  layoutHeightRem,
  listMinRem,
  SUMMARY_ROW_REM,
  tileHeightRem,
  TODAY_SIZES,
} from "./columnCapacity";
import { columnLayout } from "./columnLayout";

type Status = "past" | "current" | "upcoming";
type Item = { id: string; status: Status };

/** Items in time order: `p` past, `c` current, `u` upcoming, e.g. "ppcuu". */
function items(pattern: string): Item[] {
  const statuses: Record<string, Status> = {
    p: "past",
    c: "current",
    u: "upcoming",
  };
  return Array.from(pattern).map((char, i) => ({
    id: `${char}${String(i)}`,
    status: statuses[char] ?? "upcoming",
  }));
}

/** Height of `n` tiles of `rem` each, with the gaps between them. */
const rows = (n: number, rem: number): number =>
  n * rem + (n - 1) * COLUMN_GAP_REM;

const LARGE = TILE_HEIGHT_REM.large;
const MEDIUM = TILE_HEIGHT_REM.medium;
const DENSE = TILE_HEIGHT_REM.dense;
const SLIM = TILE_HEIGHT_REM.slim;
const STRIP = SUMMARY_ROW_REM + COLUMN_GAP_REM;

describe("tile sizes", () => {
  it("shrink step by step: today large > medium > dense > slim, other days compact > compact-dense", () => {
    expect(TODAY_SIZES).toEqual(["large", "medium", "dense", "slim"]);
    expect(DAY_SIZES).toEqual(["compact", "compact-dense"]);
    for (const ladder of [TODAY_SIZES, DAY_SIZES]) {
      const heights = ladder.map((size) => TILE_HEIGHT_REM[size]);
      expect(heights).toEqual([...heights].sort((a, b) => b - a));
      expect(new Set(heights).size).toBe(heights.length);
    }
  });

  it("a prominent tile is about 1.2-1.3x taller in today's column (not slim), never elsewhere", () => {
    // Slim is the last step before "+N": no enlargement, every event first.
    expect(PROMINENT_EXTRA_REM.slim).toBe(0);
    for (const size of TODAY_SIZES.filter((s) => s !== "slim")) {
      const ratio = tileHeightRem(size, true) / tileHeightRem(size, false);
      expect(ratio).toBeGreaterThanOrEqual(1.2);
      expect(ratio).toBeLessThanOrEqual(1.5);
    }
    for (const size of DAY_SIZES) {
      expect(PROMINENT_EXTRA_REM[size]).toBe(0);
    }
  });
});

describe("layoutHeightRem", () => {
  it("adds tiles, prominent extras, the summary rows and the gaps between rows", () => {
    expect(layoutHeightRem(columnLayout(items(""), 4), "large")).toBe(0);
    const two = items("uu");
    expect(layoutHeightRem(columnLayout(two, 4), "large")).toBe(
      2 * LARGE + COLUMN_GAP_REM,
    );
    expect(
      layoutHeightRem(columnLayout(two, 4), "large", [two[0] as Item]),
    ).toBe(2 * LARGE + PROMINENT_EXTRA_REM.large + COLUMN_GAP_REM);
    // 8 events, 2 tiles: strip + 2 tiles + "+N".
    const layout = columnLayout(items("ppppcuuu"), 2);
    expect(layout.pastStrip).toHaveLength(4);
    expect(layout.hiddenLater).toBe(2);
    expect(layoutHeightRem(layout, "dense")).toBe(
      2 * DENSE + 2 * SUMMARY_ROW_REM + 3 * COLUMN_GAP_REM,
    );
  });
});

describe("fitColumn", () => {
  it("shows everything until the list is measured (largest below 6, smallest from 6)", () => {
    const few = fitColumn(items("puu"), true, null);
    expect(few.size).toBe("large");
    expect(few.layout.visible).toHaveLength(3);
    const many = fitColumn(items("ppcuuuuu"), true, null);
    expect(many.size).toBe("slim");
    expect(many.layout.visible).toHaveLength(8);
    expect(fitColumn(items("uuuuuu"), false, null).size).toBe("compact-dense");
  });

  it("keeps the large size and enlarges the prominent tile while everything fits", () => {
    const all = items("puuu");
    const next = all[1] as Item;
    const height = rows(4, LARGE) + PROMINENT_EXTRA_REM.large;
    const fit = fitColumn(all, true, height, 0, [next]);
    expect(fit).toMatchObject({ size: "large", prominent: true });
    expect(fit.layout.visible).toHaveLength(4);
    // Six events also stay large when there is room: space decides, not a count.
    expect(fitColumn(items("uuuuuu"), true, 100).size).toBe("large");
    expect(fitColumn(items("uuu"), false, 20).size).toBe("compact");
  });

  it("folds all past events before shrinking, and drops the enlargement before shrinking", () => {
    const all = items("ppuuu");
    const next = all[2] as Item;
    // Too small for five large tiles, enough for the strip and three large ones.
    const strip3 = STRIP + rows(3, LARGE);
    expect(rows(5, LARGE)).toBeGreaterThan(strip3);
    const folded = fitColumn(all, true, strip3, 0, [next]);
    expect(folded.size).toBe("large");
    expect(folded.prominent).toBe(false);
    expect(folded.layout.pastStrip.map((i) => i.id)).toEqual(["p0", "p1"]);
    expect(folded.layout.visible.map((i) => i.id)).toEqual(["u2", "u3", "u4"]);
    // With room for the enlargement too, it is kept.
    const roomy = fitColumn(all, true, strip3 + PROMINENT_EXTRA_REM.large, 0, [
      next,
    ]);
    expect(roomy).toMatchObject({ size: "large", prominent: true });
  });

  it("shrinks large -> medium -> dense -> slim before anything is summed up", () => {
    const all = items("uuuuu");
    const medium = rows(5, MEDIUM);
    expect(rows(5, LARGE)).toBeGreaterThan(medium);
    expect(fitColumn(all, true, medium).size).toBe("medium");
    const dense = rows(5, DENSE);
    const fit = fitColumn(all, true, dense);
    expect(fit.size).toBe("dense");
    expect(fit.layout.hiddenLater).toBe(0);
    // A bit less: slim tiles, still every event.
    const slimFit = fitColumn(all, true, dense - 0.1);
    expect(slimFit.size).toBe("slim");
    expect(slimFit.layout.hiddenLater).toBe(0);
    // Less than five slim tiles: four slim tiles plus the "+N" row.
    const slim = rows(5, SLIM);
    const tight = fitColumn(all, true, slim - 0.1);
    expect(tight.size).toBe("slim");
    expect(tight.layout.visible).toHaveLength(4);
    expect(tight.layout.later.map((i) => i.id)).toEqual(["u4"]);
    expect(layoutHeightRem(tight.layout, "slim")).toBeLessThanOrEqual(
      slim - 0.1,
    );
  });

  it('fits today at 10:20 without "+N" (21.125rem list, two done, next and four later)', () => {
    // The demo board's today column at 1280x800 and 2000x1200 (the list scales with rem):
    // dense tiles left two events in "+2" with free space below; slim ones fit them all.
    const all = items("ppuuuuu");
    const next = [all[2] as Item];
    const reserved = 1.75 + COLUMN_GAP_REM;
    const fit = fitColumn(all, true, 21.125, reserved, next);
    expect(fit.size).toBe("slim");
    expect(fit.prominent).toBe(false);
    expect(fit.layout.hiddenLater).toBe(0);
    expect(fit.layout.pastStrip).toHaveLength(2);
    expect(fit.layout.visible).toHaveLength(5);
    expect(freeRem(fit, 21.125, reserved, next)).toBeGreaterThanOrEqual(0);
  });

  it("uses the enlargement whenever a size still fits with it", () => {
    const all = items("ppcuu");
    const now = [all[2] as Item];
    const plain = STRIP + rows(3, DENSE);
    // Exactly the room for the enlarged dense tile: kept.
    const roomy = fitColumn(
      all,
      true,
      plain + PROMINENT_EXTRA_REM.dense,
      0,
      now,
    );
    expect(roomy).toMatchObject({ size: "dense", prominent: true });
    // Just below it: the same size without the enlargement, not a smaller one.
    const tight = fitColumn(all, true, plain + 0.5, 0, now);
    expect(tight).toMatchObject({ size: "dense", prominent: false });
  });

  it("reports the free height below the rows (null until measured, never negative)", () => {
    const all = items("uu");
    const fit = fitColumn(all, true, 20);
    expect(freeRem(fit, 20)).toBeCloseTo(20 - rows(2, LARGE));
    expect(freeRem(fit, 20, 2)).toBeCloseTo(18 - rows(2, LARGE));
    expect(freeRem(fitColumn(all, true, null), null)).toBeNull();
    expect(freeRem(fitColumn(items("uuuuuuuuuu"), true, 3), 3)).toBe(0);
  });

  it("subtracts reserved space (the now line)", () => {
    const height = rows(4, LARGE);
    expect(fitColumn(items("uuuu"), true, height).size).toBe("large");
    expect(fitColumn(items("uuuu"), true, height, 2).size).not.toBe("large");
  });

  it("sweep: fits the list from a minimum height on, never loses an event, keeps current ones, one rule for the past", () => {
    for (let count = 0; count <= 14; count += 1) {
      for (let pastCount = 0; pastCount <= count; pastCount += 1) {
        const pattern =
          "p".repeat(pastCount) +
          (count > pastCount ? "c" : "") +
          "u".repeat(Math.max(0, count - pastCount - 1));
        expect(pattern.length).toBe(count);
        for (let height = 6; height <= 40; height += 0.75) {
          for (const today of [true, false]) {
            const all = items(pattern);
            const prominent = all.filter((i) => i.status === "current");
            const fit = fitColumn(all, today, height, 2, prominent);
            const { size, layout } = fit;
            const used = layoutHeightRem(
              layout,
              size,
              fit.prominent ? prominent : [],
            );
            // From one tile plus the strip and "+N" on, it never exceeds the list.
            const minimum = tileHeightRem(size, false) + 2 * STRIP + 2;
            if (height >= minimum) {
              expect(used).toBeLessThanOrEqual(height - 2 + 1e-6);
            }
            expect(
              layout.visible.length +
                layout.pastStrip.length +
                layout.hiddenLater,
            ).toBe(count);
            for (const item of prominent) {
              expect(layout.visible).toContain(item);
            }
            // Past events are either all tiles or all folded.
            const pastShown = layout.visible.filter(
              (i) => i.status === "past",
            ).length;
            expect([0, pastCount]).toContain(pastShown);
            if (pastShown > 0) expect(layout.pastStrip).toHaveLength(0);
            // Size and enlargement come from the column's own steps.
            const ladder = today ? TODAY_SIZES : DAY_SIZES;
            expect(ladder).toContain(size);
            // Summed up only at the smallest size, and only when one more tile there
            // would not fit (no "+N" while the space would take the event).
            if (layout.hiddenLater > 0) {
              expect(size).toBe(ladder[ladder.length - 1]);
              const upcoming = count - pastCount;
              const oneMore = columnLayout(all, layout.visible.length + 1);
              if (layout.visible.length + 1 <= upcoming) {
                expect(layoutHeightRem(oneMore, size)).toBeGreaterThan(
                  height - 2 + 1e-6,
                );
              }
            }
          }
        }
      }
    }
  });
});

describe("listMinRem", () => {
  it("keeps room for the strip, the now line, two slim tiles and +N", () => {
    const reserved = 2.25;
    expect(listMinRem(reserved)).toBeCloseTo(
      reserved +
        2 * TILE_HEIGHT_REM.slim +
        2 * SUMMARY_ROW_REM +
        3 * COLUMN_GAP_REM,
    );
    // In that much room a column of any length keeps the tiles of its current and its
    // next event and folds or sums up the rest, within the room.
    for (let count = 1; count <= 12; count += 1) {
      const all = items("p".repeat(count - 1) + "cuuuu");
      const current = all.filter((item) => item.status === "current");
      const next = all.find((item) => item.status === "upcoming");
      const fit = fitColumn(all, true, listMinRem(reserved), reserved, current);
      expect(fit.layout.visible).toContain(current[0]);
      expect(fit.layout.visible).toContain(next);
      expect(
        layoutHeightRem(fit.layout, fit.size, fit.prominent ? current : []),
      ).toBeLessThanOrEqual(listMinRem(reserved) - reserved + 1e-6);
    }
  });
});

describe("fitColumn with bring lists", () => {
  it("today's tiles keep their height with chips; the other days' tiles grow by a chip row", () => {
    for (const size of TODAY_SIZES) {
      expect(tileHeightRem(size, false, true)).toBe(tileHeightRem(size, false));
      expect(tileHeightRem(size, true, true)).toBe(tileHeightRem(size, true));
    }
    for (const size of DAY_SIZES) {
      expect(BRING_EXTRA_REM[size]).toBeGreaterThan(0);
      expect(tileHeightRem(size, false, true)).toBe(
        TILE_HEIGHT_REM[size] + BRING_EXTRA_REM[size],
      );
    }
    // Every step of the other days still gets smaller, also with chips.
    expect(tileHeightRem("compact-dense", false, true)).toBeLessThan(
      tileHeightRem("compact", false, true),
    );
  });

  it("counts a chip row only for the tiles that show one", () => {
    const all = items("uuu");
    const layout = columnLayout(all, 3);
    const plain = layoutHeightRem(layout, "compact");
    const one = layoutHeightRem(layout, "compact", [], all.slice(1, 2));
    expect(one - plain).toBeCloseTo(BRING_EXTRA_REM.compact);
    expect(layoutHeightRem(layout, "compact", [], all) - plain).toBeCloseTo(
      3 * BRING_EXTRA_REM.compact,
    );
    expect(layoutHeightRem(layout, "large", [], all)).toBe(
      layoutHeightRem(layout, "large"),
    );
  });

  it("another day steps down sooner when its tiles carry chips, never with a +N while one more fits", () => {
    const all = items("uuu");
    // Room for three dense tiles with chips: plenty for three plain compact ones.
    const height = rows(3, tileHeightRem("compact-dense", false, true));
    expect(fitColumn(all, false, height).size).toBe("compact");
    const fit = fitColumn(all, false, height, 0, [], all);
    expect(fit.size).toBe("compact-dense");
    expect(fit.layout.hiddenLater).toBe(0);
  });

  it("sweep with bring lists: fits from a minimum height on, never loses an event, +N only when one more tile would not fit", () => {
    // Which events carry a bring list: none, all, every other one, the first only.
    const masks: ((index: number) => boolean)[] = [
      () => false,
      () => true,
      (index) => index % 2 === 0,
      (index) => index === 0,
    ];
    for (let count = 0; count <= 14; count += 1) {
      for (let pastCount = 0; pastCount <= count; pastCount += 2) {
        const pattern =
          "p".repeat(pastCount) +
          (count > pastCount ? "c" : "") +
          "u".repeat(Math.max(0, count - pastCount - 1));
        const all = items(pattern);
        for (const mask of masks) {
          // Past tiles never show chips (the caller passes only the others).
          const bring = all.filter(
            (item, index) => mask(index) && item.status !== "past",
          );
          for (let height = 6; height <= 40; height += 0.75) {
            for (const today of [true, false]) {
              const prominent = all.filter((i) => i.status === "current");
              const fit = fitColumn(all, today, height, 2, prominent, bring);
              const { size, layout } = fit;
              const used = layoutHeightRem(
                layout,
                size,
                fit.prominent ? prominent : [],
                bring,
              );
              const minimum = tileHeightRem(size, false, true) + 2 * STRIP + 2;
              if (height >= minimum) {
                expect(used).toBeLessThanOrEqual(height - 2 + 1e-6);
              }
              // No loss: shown + folded + hidden = n.
              expect(
                layout.visible.length +
                  layout.pastStrip.length +
                  layout.hiddenLater,
              ).toBe(count);
              for (const item of prominent) {
                expect(layout.visible).toContain(item);
              }
              // Today's column decides exactly as without chips (they sit in the time row).
              if (today) {
                expect(fit).toEqual(
                  fitColumn(all, today, height, 2, prominent),
                );
              }
              const ladder = today ? TODAY_SIZES : DAY_SIZES;
              if (layout.hiddenLater > 0) {
                expect(size).toBe(ladder[ladder.length - 1]);
                const oneMore = columnLayout(all, layout.visible.length + 1);
                if (layout.visible.length + 1 <= count - pastCount) {
                  expect(
                    layoutHeightRem(oneMore, size, [], bring),
                  ).toBeGreaterThan(height - 2 + 1e-6);
                }
              }
            }
          }
        }
      }
    }
  });
});
