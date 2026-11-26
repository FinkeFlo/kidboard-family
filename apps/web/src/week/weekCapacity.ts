import { type EventStatus, type TileSize } from "../components/EventTile";
import {
  COLUMN_GAP_REM,
  SUMMARY_ROW_REM,
  tileHeightRem,
} from "../day/columnCapacity";
import { DENSE_FROM } from "../day/columnLayout";

/** Tile sizes of a week column, largest first: the steps it shrinks through. */
export const WEEK_SIZES: readonly TileSize[] = [
  "week",
  "week-dense",
  "week-small",
  "week-slim",
];

export interface WeekFit<T> {
  size: TileSize;
  /** Items that get a tile, in the order given (the most important first). */
  visible: T[];
  /**
   * Past events folded into the "done" strip (only today has them), in the order given.
   * Empty while every event of the column gets a tile.
   */
  past: T[];
  /** Upcoming items without a tile: they are summed up in a "+N" row. */
  hidden: T[];
}

/**
 * Height in rem of a week column showing `tiles` at `size` plus `summaries` summary rows
 * ("done" strip, "+N"), with the gaps between the rows; tiles in `bring` (those showing
 * a bring list) are counted with their chip row.
 */
export function weekRowsRem<T>(
  tiles: readonly T[],
  size: TileSize,
  summaries: number,
  bring: readonly T[] = [],
): number {
  const rows = tiles.length + summaries;
  if (rows === 0) return 0;
  const tileRem = tiles.reduce(
    (sum, item) => sum + tileHeightRem(size, false, bring.includes(item)),
    0,
  );
  return tileRem + summaries * SUMMARY_ROW_REM + (rows - 1) * COLUMN_GAP_REM;
}

/**
 * How many tiles a week column can show, decided by its measured height (`heightRem`,
 * `null` until measured: show everything). `items` come most important first; `bring`
 * are the ones whose tile shows a bring list (taller by its chip row). The same steps as
 * the overview's columns (`fitColumn`), taking the first that fits:
 *
 * 1. every event as a tile at the normal size (past ones receded);
 * 2. otherwise *all* past events fold into the "done" strip (so a finished event never
 *    takes a slot an upcoming one needs), and the upcoming tiles shrink step by step
 *    ({@link WEEK_SIZES}: stacked with a two-line title, stacked with a one-line title,
 *    the same smaller, then a slim row of small emoji beside title and time; every step
 *    keeps the title where the column is wide enough);
 * 3. only then the least important upcoming events are summed up in "+N", at the
 *    smallest size, with the largest number of tiles that still leaves room for it.
 *
 * A "+N" appears only when one more tile at the smallest size would not fit, never
 * because of a fixed count. Nothing
 * is lost: `visible + past + hidden` are the items. A column too short for even one tile
 * shows only the summaries.
 */
export function fitWeekColumn<T extends { status: EventStatus }>(
  items: readonly T[],
  heightRem: number | null,
  bring: readonly T[] = [],
): WeekFit<T> {
  const largest = WEEK_SIZES[0] ?? "week";
  const smallest = WEEK_SIZES[WEEK_SIZES.length - 1] ?? "week-slim";
  const count = items.length;
  if (heightRem === null) {
    return {
      // Unmeasured: a busy day starts dense (with titles), never at the last step.
      size: count >= DENSE_FROM ? "week-dense" : largest,
      visible: [...items],
      past: [],
      hidden: [],
    };
  }
  const available = heightRem + 1e-6;
  // 1. Everything as tiles at the normal size.
  if (weekRowsRem(items, largest, 0, bring) <= available) {
    return { size: largest, visible: [...items], past: [], hidden: [] };
  }
  // 2. All past events fold into the strip; the upcoming ones shrink step by step.
  const past = items.filter((item) => item.status === "past");
  const upcoming = items.filter((item) => item.status !== "past");
  const strip = past.length > 0 ? 1 : 0;
  for (const size of WEEK_SIZES) {
    if (weekRowsRem(upcoming, size, strip, bring) <= available) {
      return { size, visible: upcoming, past, hidden: [] };
    }
  }
  // 3. Sum up the least important upcoming events, keeping room for the "+N" row.
  let tiles = Math.max(0, upcoming.length - 1);
  while (
    tiles > 0 &&
    weekRowsRem(upcoming.slice(0, tiles), smallest, strip + 1, bring) >
      available
  )
    tiles -= 1;
  return {
    size: smallest,
    visible: upcoming.slice(0, tiles),
    past,
    hidden: upcoming.slice(tiles),
  };
}
