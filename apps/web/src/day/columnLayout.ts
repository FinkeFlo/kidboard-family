import type { EventStatus } from "../components/EventTile";

/**
 * From this many events a column starts at its dense size while it is not measured yet
 * (the week view also uses it). Measured day columns choose their size by space alone.
 */
export const DENSE_FROM = 6;
/** Past events the "vorbei" strip can draw as icons; further ones are counted ("+N"). */
export const STRIP_ICONS_MAX = 8;
/** Smallest number of full tiles the layout works with. */
export const MIN_TILES = 1;

export interface ColumnLayout<T> {
  /**
   * Every past event folded into the "vorbei" strip (oldest first); the strip's
   * accessible name lists all of them. Draw `stripIcons` as icons.
   */
  pastStrip: T[];
  /** The first `STRIP_ICONS_MAX` of `pastStrip`: the icons that fit into the strip. */
  stripIcons: T[];
  /** Events shown as full tiles, in time order. */
  visible: T[];
  /** Folded past events without an icon (`pastStrip.length - stripIcons.length`): "+N". */
  hiddenEarlier: number;
  /** Latest upcoming events summed up in a trailing "+N" row, in time order. */
  later: T[];
  /** `later.length`. */
  hiddenLater: number;
}

/**
 * How a day column lays out its events (given in time order) when `tiles` full tiles fit
 * (a number the caller derives from the available space; at least `MIN_TILES`).
 *
 * One deterministic rule for past events: when every event gets a tile, past ones stay
 * tiles (receded); otherwise *all* past events fold into the strip, never only some of
 * them. If the rest still does not fit, the latest upcoming events are summed up in "+N".
 * Nothing is lost: `visible + pastStrip + later` is always `items.length`, and every list
 * keeps the time order. A `current` event is never hidden or folded; only when more
 * events are current at once than `tiles` can `visible` be longer than `tiles`.
 */
export function columnLayout<T extends { status: EventStatus }>(
  items: readonly T[],
  tiles: number,
): ColumnLayout<T> {
  const count = items.length;
  const capacity = Math.max(
    MIN_TILES,
    Math.floor(Number.isFinite(tiles) ? tiles : MIN_TILES),
  );
  if (count <= capacity) {
    return {
      pastStrip: [],
      stripIcons: [],
      visible: [...items],
      hiddenEarlier: 0,
      later: [],
      hiddenLater: 0,
    };
  }

  const pastStrip = items.filter((item) => item.status === "past");
  const rest = items.filter((item) => item.status !== "past");
  const hidden = new Set<T>();
  // Hide from the latest end, never a current event.
  let toHide = rest.length - capacity;
  for (let index = rest.length - 1; index >= 0 && toHide > 0; index -= 1) {
    const item = rest[index];
    if (item === undefined || item.status === "current") continue;
    hidden.add(item);
    toHide -= 1;
  }
  const stripIcons = pastStrip.slice(0, STRIP_ICONS_MAX);
  const later = rest.filter((item) => hidden.has(item));
  return {
    pastStrip,
    stripIcons,
    visible: rest.filter((item) => !hidden.has(item)),
    hiddenEarlier: pastStrip.length - stripIcons.length,
    later,
    hiddenLater: later.length,
  };
}
