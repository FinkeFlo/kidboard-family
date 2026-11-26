/*
 * Tile sizes and the Tailwind classes of each (class names are written out in full so
 * Tailwind can see them). Used by `EventTile.tsx`.
 */

/**
 * Tile sizes: `large` → `medium` → `dense` → `slim` in today's column (it shrinks step by
 * step when space is short; `slim` puts title and time in one row), `compact` / `compact-dense` on the other days, `week` →
 * `week-dense` → `week-small` → `week-slim` for the seven narrow week columns (the first three stacked:
 * emoji, a title of two lines / one line where the column is wide enough, then the time; `week-slim` a
 * small emoji beside title and time). Heights are fixed, so a column can derive how many tiles fit from its height
 * ({@link TILE_HEIGHT_REM}, plus {@link PROMINENT_EXTRA_REM} for a prominent tile).
 */
export type TileSize =
  | "large"
  | "medium"
  | "dense"
  | "slim"
  | "compact"
  | "compact-dense"
  | "week"
  | "week-dense"
  | "week-small"
  | "week-slim";

export interface SizeClasses {
  tile: string;
  /** Light disc behind the emoji; `null`: no disc (week tiles). */
  disc: string | null;
  emoji: string;
  /** Title size and how many lines it may wrap to. */
  title: string;
  /**
   * Week tiles: how the title text itself is cut (two lines, or one line with an ellipsis).
   * Empty for the other sizes (their `title` says it).
   */
  titleCut: string;
  /** Size of the time row's text ("12:30", "Ganztägig"). */
  metaText: string;
  /** Size of the all-day icon in the time row. */
  allDayIcon: string;
  /** Time-of-day icon next to the time (>= 1.5rem in the overview). */
  timeIcon: string;
  badge: string;
  badgeText: string;
  /** A quarter of `badge`, as a negative start margin. */
  badgeOverlap: string;
  /**
   * Two-line titles: the badges float at the end of the first line (one line high, so a
   * second line runs under them); one-line titles keep the badges in a row beside them.
   */
  badgeFloat: boolean;
  /** Emoji above the time (week columns) instead of beside the title. */
  stacked: boolean;
  /** Title, badges and time in one row (the slimmest today tile). */
  inline: boolean;
  /**
   * The slimmest week tile: a small emoji beside two rows, the title with the badges at its
   * end, then the time.
   */
  weekRow: boolean;
  /** Size of the "now" / "next" cue on the emoji disc. */
  cue: string;
}

// Full class names so Tailwind can see them. Today's large emoji stay >= 3.5rem, medium
// ones are 3rem and dense ones 2.75rem; slim tiles (the last step before "+N", so a whole
// day still fits) put the title and time in one row next to a 2rem emoji (as on week tiles). The disc
// leaves a thin light ring around the glyph.
const SIZES: Record<TileSize, SizeClasses> = {
  large: {
    tile: "h-tile gap-3 ps-3 pe-3",
    disc: "size-[4.25rem]",
    emoji: "text-[3.5rem]",
    title: "text-tile line-clamp-2",
    titleCut: "",
    metaText: "text-meta",
    allDayIcon: "size-6",
    timeIcon: "text-[1.5rem]",
    badge: "size-6.5",
    badgeText: "text-meta",
    badgeOverlap: "-ms-1.5",
    badgeFloat: true,
    stacked: false,
    inline: false,
    weekRow: false,
    cue: "size-6",
  },
  medium: {
    tile: "h-18 gap-3 ps-3 pe-3",
    disc: "size-[3.75rem]",
    emoji: "text-[3rem]",
    title: "text-tile-compact line-clamp-2",
    titleCut: "",
    metaText: "text-meta",
    allDayIcon: "size-6",
    timeIcon: "text-[1.5rem]",
    badge: "size-6",
    badgeText: "text-caption",
    badgeOverlap: "-ms-1.5",
    badgeFloat: true,
    stacked: false,
    inline: false,
    weekRow: false,
    cue: "size-6",
  },
  dense: {
    tile: "h-14 gap-2.5 ps-2.5 pe-3",
    disc: "size-[3.125rem]",
    emoji: "text-[2.75rem]",
    title: "text-tile-compact line-clamp-1",
    titleCut: "",
    metaText: "text-meta",
    allDayIcon: "size-6",
    timeIcon: "text-[1.5rem]",
    badge: "size-7",
    badgeText: "text-body",
    badgeOverlap: "-ms-1.75",
    badgeFloat: false,
    stacked: false,
    inline: false,
    weekRow: false,
    cue: "size-6",
  },
  slim: {
    tile: "h-11 gap-2.5 ps-2 pe-3",
    disc: "size-9",
    emoji: "text-[2rem]",
    title: "text-tile-compact",
    titleCut: "",
    metaText: "text-meta",
    allDayIcon: "size-6",
    timeIcon: "text-[1.5rem]",
    badge: "size-6",
    badgeText: "text-caption",
    badgeOverlap: "-ms-1.5",
    badgeFloat: false,
    stacked: false,
    inline: true,
    weekRow: false,
    cue: "size-4",
  },
  compact: {
    tile: "h-tile-compact gap-1.5 ps-1.5 pe-1.5",
    disc: "size-12",
    emoji: "text-[2.5rem]",
    title: "text-tile-compact line-clamp-2",
    titleCut: "",
    metaText: "text-meta",
    allDayIcon: "size-6",
    timeIcon: "text-[1.5rem]",
    badge: "size-6",
    badgeText: "text-caption",
    badgeOverlap: "-ms-1.5",
    badgeFloat: true,
    stacked: false,
    inline: false,
    weekRow: false,
    cue: "size-6",
  },
  "compact-dense": {
    tile: "h-15 gap-1.5 ps-1.5 pe-1.5",
    disc: "size-11",
    emoji: "text-[2.25rem]",
    title: "text-tile-compact line-clamp-1",
    titleCut: "",
    metaText: "text-meta",
    allDayIcon: "size-6",
    timeIcon: "text-[1.5rem]",
    badge: "size-6",
    badgeText: "text-caption",
    badgeOverlap: "-ms-1.5",
    badgeFloat: false,
    stacked: false,
    inline: false,
    weekRow: false,
    cue: "size-6",
  },
  // Week tiles stack emoji, the title and the time; the title shows where the column is
  // wide enough (container query on the column's list), else only the name has it. The
  // normal size gives it two lines (broken at spaces, never hyphenated), dense one.
  week: {
    tile: "h-29 flex-col justify-center gap-0.5 px-1.5",
    disc: null,
    emoji: "text-[2.5rem]",
    title: "text-meta leading-tight",
    titleCut: "line-clamp-2 break-words",
    metaText: "text-meta",
    allDayIcon: "size-6",
    timeIcon: "text-[1.5rem]",
    badge: "size-6",
    badgeText: "text-caption",
    badgeOverlap: "-ms-1.5",
    badgeFloat: false,
    stacked: true,
    inline: false,
    weekRow: false,
    cue: "size-6",
  },
  "week-dense": {
    tile: "h-21 flex-col justify-center gap-0.5 px-1.5",
    disc: null,
    emoji: "text-[2rem]",
    title: "text-caption",
    titleCut: "block truncate",
    metaText: "text-meta",
    allDayIcon: "size-6",
    timeIcon: "text-[1.5rem]",
    badge: "size-6",
    badgeText: "text-caption",
    badgeOverlap: "-ms-1.5",
    badgeFloat: false,
    stacked: true,
    inline: false,
    weekRow: false,
    cue: "size-6",
  },
  // Smaller emoji and time row, so one more stacked tile fits before the slim row.
  "week-small": {
    tile: "h-19 flex-col justify-center gap-0.5 px-1.5",
    disc: null,
    emoji: "text-[1.75rem]",
    title: "text-caption",
    titleCut: "block truncate",
    metaText: "text-caption",
    allDayIcon: "size-5",
    timeIcon: "text-[1.125rem]",
    badge: "size-5",
    badgeText: "text-[0.75rem]",
    badgeOverlap: "-ms-1.25",
    badgeFloat: false,
    stacked: true,
    inline: false,
    weekRow: false,
    cue: "size-4",
  },
  // Last step before "+N" in a week column: a small emoji beside the title (with the
  // badges at its end) and the time, so a busy day keeps its titles and no event is
  // summed up while one more of these still fits.
  "week-slim": {
    tile: "h-12 gap-2 ps-1.5 pe-1",
    disc: null,
    emoji: "text-[1.75rem]",
    title: "text-caption",
    titleCut: "block truncate",
    metaText: "text-caption",
    allDayIcon: "size-4",
    timeIcon: "text-[1rem]",
    badge: "size-5",
    badgeText: "text-[0.75rem]",
    badgeOverlap: "-ms-1.25",
    badgeFloat: false,
    stacked: false,
    inline: false,
    weekRow: true,
    cue: "size-4",
  },
};

/** Prominent (now / next) variants of today's sizes: taller, larger emoji and title. */
const PROMINENT: Partial<Record<TileSize, Partial<SizeClasses>>> = {
  large: {
    tile: "h-[6.5rem] gap-4 ps-3 pe-3",
    disc: "size-[5.5rem]",
    emoji: "text-[4.5rem]",
    title: "text-heading line-clamp-2",
    timeIcon: "text-[1.75rem]",
    badge: "size-9",
    badgeText: "text-body",
    badgeOverlap: "-ms-2.25",
  },
  medium: {
    tile: "h-[5.5rem] gap-3 ps-3 pe-3",
    disc: "size-[4.5rem]",
    emoji: "text-[3.75rem]",
    title: "text-tile line-clamp-2",
    badge: "size-6.5",
    badgeText: "text-meta",
  },
  dense: {
    tile: "h-[4.5rem] gap-3 ps-2.5 pe-3",
    disc: "size-[4rem]",
    emoji: "text-[3.25rem]",
    title: "text-tile-compact line-clamp-2",
    badge: "size-6",
    badgeText: "text-caption",
    badgeOverlap: "-ms-1.5",
    badgeFloat: true,
  },
};

/**
 * Tile classes of the narrow sizes when they show a chip row of their own (replacing
 * `tile`; the height comes from the style): a column with vertical padding, so the title
 * keeps clear of the tile's edge. `row` is the gap of the picture-and-text row above the
 * chips (sizes whose picture sits beside the text).
 */
export const BRING_TILE: Partial<
  Record<TileSize, { tile: string; row: string }>
> = {
  compact: {
    tile: "flex-col justify-center gap-0.5 px-1.5 pt-1.5 pb-1",
    row: "gap-1.5",
  },
  "compact-dense": {
    tile: "flex-col justify-center gap-0.5 px-1.5 pt-1.5 pb-1",
    row: "gap-1.5",
  },
  week: { tile: "flex-col justify-center gap-0.5 px-1.5 py-1", row: "" },
  "week-dense": {
    tile: "flex-col justify-center gap-0.5 px-1.5 py-1",
    row: "",
  },
  "week-small": {
    tile: "flex-col justify-center gap-0.5 px-1.5 py-1",
    row: "",
  },
  "week-slim": {
    tile: "flex-col justify-center gap-0.5 ps-1.5 pe-1.25 py-1",
    row: "gap-1.5",
  },
};

/** Classes of `size`, with the prominent variant applied when asked for and defined. */
export function tileClasses(size: TileSize, prominent: boolean): SizeClasses {
  const base = SIZES[size];
  const extra = prominent ? PROMINENT[size] : undefined;
  return extra === undefined ? base : { ...base, ...extra };
}
