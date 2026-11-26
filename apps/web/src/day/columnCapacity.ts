import {
  BRING_EXTRA_REM,
  type EventStatus,
  PROMINENT_EXTRA_REM,
  TILE_HEIGHT_REM,
  type TileSize,
} from "../components/EventTile";
import { type ColumnLayout, columnLayout, DENSE_FROM } from "./columnLayout";

/** Gap between the rows of a day column's event list in rem (`gap-2`). */
export const COLUMN_GAP_REM = 0.5;
/** Height of the "vorbei" strip and of the "+N" row in rem (`h-9`). */
export const SUMMARY_ROW_REM = 2.25;

/** Tile sizes of today's column, largest first: the steps it shrinks through. */
export const TODAY_SIZES: readonly TileSize[] = [
  "large",
  "medium",
  "dense",
  "slim",
];
/** Tile sizes of the other overview days, largest first. */
export const DAY_SIZES: readonly TileSize[] = ["compact", "compact-dense"];

export interface ColumnFit<T> {
  size: TileSize;
  /** Whether the `prominent` events (now, else next) get their larger tile. */
  prominent: boolean;
  layout: ColumnLayout<T>;
}

/**
 * The least height in rem today's event list keeps when something else in the column
 * (the 🎒 area) asks for room: the "vorbei" strip, the now line (`reservedRem`), two
 * tiles at the smallest size and the "+N" row, with their gaps. So the current event and
 * the next one (or the next two) always keep their tiles.
 */
export function listMinRem(reservedRem: number): number {
  return (
    reservedRem +
    2 * TILE_HEIGHT_REM.slim +
    2 * SUMMARY_ROW_REM +
    3 * COLUMN_GAP_REM
  );
}

/**
 * Height in rem of one tile of `size` (larger when it is a prominent one, and when it shows
 * a bring list in a chip row of its own, `BRING_EXTRA_REM`).
 */
export function tileHeightRem(
  size: TileSize,
  prominent: boolean,
  bring = false,
): number {
  return (
    TILE_HEIGHT_REM[size] +
    (prominent ? PROMINENT_EXTRA_REM[size] : 0) +
    (bring ? BRING_EXTRA_REM[size] : 0)
  );
}

/**
 * Height in rem that `layout` takes with tiles of `size` (rows plus gaps); the tiles in
 * `prominent` are counted at their larger height, those in `bring` (tiles that show a
 * bring list) with their chip row where the size has one.
 */
export function layoutHeightRem<T>(
  layout: ColumnLayout<T>,
  size: TileSize,
  prominent: readonly T[] = [],
  bring: readonly T[] = [],
): number {
  const strip = layout.pastStrip.length > 0 ? 1 : 0;
  const more = layout.hiddenLater > 0 ? 1 : 0;
  const rows = layout.visible.length + strip + more;
  if (rows === 0) return 0;
  const tiles = layout.visible.reduce(
    (sum, item) =>
      sum + tileHeightRem(size, prominent.includes(item), bring.includes(item)),
    0,
  );
  return tiles + (strip + more) * SUMMARY_ROW_REM + (rows - 1) * COLUMN_GAP_REM;
}

/**
 * Tile size and layout of a day column whose list is `heightRem` high (`null`: not
 * measured yet, then everything is shown). `reservedRem` is space other rows take (the
 * now line plus its gap); `prominent` are the events that get a larger tile when space
 * allows (today: the current ones, else the next one); `bring` are the events whose tile
 * shows a bring list (taller at sizes with a chip row). Decided by space alone, in this
 * order, taking the first that fits:
 *
 * 1. every event as a tile at the largest size, prominent ones enlarged (past events
 *    stay tiles, receded);
 * 2. otherwise all past events fold into the "vorbei" strip and the rest shrinks step by
 *    step (`TODAY_SIZES` / `DAY_SIZES`), at each size first with, then without the
 *    enlarged prominent tiles;
 * 3. only then the latest upcoming events are summed up in "+N", at the smallest size.
 *
 * A column too short even for one tile, the strip and "+N" may still overflow.
 */
export function fitColumn<T extends { status: EventStatus }>(
  items: readonly T[],
  today: boolean,
  heightRem: number | null,
  reservedRem = 0,
  prominent: readonly T[] = [],
  bring: readonly T[] = [],
): ColumnFit<T> {
  const ladder = today ? TODAY_SIZES : DAY_SIZES;
  const largest = ladder[0] ?? "large";
  const smallest = ladder[ladder.length - 1] ?? "dense";
  const count = items.length;
  const all = columnLayout(items, count);
  if (heightRem === null) {
    return {
      size: count >= DENSE_FROM ? smallest : largest,
      prominent: prominent.length > 0,
      layout: all,
    };
  }
  const available = heightRem - reservedRem + 1e-6;
  const fits = (
    layout: ColumnLayout<T>,
    size: TileSize,
    enlarged: boolean,
  ): boolean =>
    layoutHeightRem(layout, size, enlarged ? prominent : [], bring) <=
    available;

  // 1. Everything as tiles at the largest size.
  if (fits(all, largest, true)) {
    return {
      size: largest,
      prominent: prominent.length > 0 && PROMINENT_EXTRA_REM[largest] > 0,
      layout: all,
    };
  }
  // 2. All past events fold (none if there are none); the rest shrinks step by step.
  const upcoming = items.filter((item) => item.status !== "past").length;
  const folded = columnLayout(items, upcoming);
  for (const size of ladder) {
    for (const enlarged of [true, false]) {
      if (
        enlarged &&
        (prominent.length === 0 || PROMINENT_EXTRA_REM[size] === 0)
      )
        continue;
      if (fits(folded, size, enlarged)) {
        return { size, prominent: enlarged, layout: folded };
      }
    }
  }
  // 3. Sum up the latest: the most tiles whose real height still fits.
  for (let tiles = upcoming - 1; tiles > 0; tiles -= 1) {
    const layout = columnLayout(items, tiles);
    if (fits(layout, smallest, false)) {
      return { size: smallest, prominent: false, layout };
    }
  }
  return { size: smallest, prominent: false, layout: columnLayout(items, 0) };
}

/**
 * Height in rem left below `fit`'s rows in a list `heightRem` high, after `reservedRem`
 * (the now line plus its gap); `null` while the list is not measured. Never negative.
 */
export function freeRem<T>(
  fit: ColumnFit<T>,
  heightRem: number | null,
  reservedRem = 0,
  prominent: readonly T[] = [],
  bring: readonly T[] = [],
): number | null {
  if (heightRem === null) return null;
  const used = layoutHeightRem(
    fit.layout,
    fit.size,
    fit.prominent ? prominent : [],
    bring,
  );
  return Math.max(0, heightRem - reservedRem - used);
}
