import type { CalendarEvent, Child } from "@kidboard/shared";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { type FormatContext, formatTime } from "../i18n/format";
import type { DayBand } from "../time";
import { BringChips, type ChipSize } from "./BringChips";
import { ChildBadges } from "./ChildBadges";
import { CHILD_EDGE_AFTER } from "./childColor";
import {
  resolveTileTint,
  stripeStyle,
  type TileTint,
  tileTintStyle,
} from "./childTint";
import { Emoji } from "./Emoji";
import { BRING_TILE, tileClasses, type TileSize } from "./eventTileSizes";
import {
  AllDayIcon,
  ClockIcon,
  NextIcon,
  TimeOfDayIcon,
} from "./TimeOfDayIcon";

export type { SizeClasses, TileSize } from "./eventTileSizes";

export type EventStatus = "upcoming" | "current" | "past";

/** Tile heights in rem; `large` and `compact` are `--spacing-tile(-compact)`. */
export const TILE_HEIGHT_REM: Record<TileSize, number> = {
  large: 5,
  medium: 4.5,
  dense: 3.5,
  slim: 2.75,
  compact: 4.75,
  "compact-dense": 3.75,
  week: 7.25,
  "week-dense": 5.25,
  "week-small": 4.75,
  "week-slim": 3,
};

/**
 * Extra height in rem of a prominent tile (the current event, else the next one, in
 * today's column): about 1.3× the normal tile, with a larger emoji. 0: no prominent look.
 */
export const PROMINENT_EXTRA_REM: Record<TileSize, number> = {
  large: 1.5,
  medium: 1,
  dense: 1,
  slim: 0,
  compact: 0,
  "compact-dense": 0,
  week: 0,
  "week-dense": 0,
  "week-small": 0,
  "week-slim": 0,
};

/**
 * Extra height in rem of a tile that shows a bring list in a chip row of its own (ADR-0010):
 * the narrow tiles of the other overview days and the week, whose time row has no room
 * for chips. The row holds 28px chips (`large`, plus the badges at its end where the
 * picture sits beside the text) below the picture and the text, and the tile gets a
 * little vertical padding, so its title keeps clear of the edge: each value is the
 * measured content (title lines, time row, chip row, gaps, padding) minus the plain
 * tile's height, rounded up. 0: the chips sit in the time row (today's column, which is
 * about twice as wide), and the tile keeps its height. Past tiles show no chips and never
 * grow.
 */
export const BRING_EXTRA_REM: Record<TileSize, number> = {
  large: 0,
  medium: 0,
  dense: 0,
  slim: 0,
  // 0.625 padding + two title lines 2.73 + time row 1.5 + 0.125 gap + chips 1.75.
  compact: 2,
  // 0.625 padding + one title line 1.37 + time row 1.5 + 0.125 gap + chips 1.75.
  "compact-dense": 1.625,
  // 0.5 padding + emoji 2.5 + two title lines 2.5 + time row 1.5 + 3 gaps + chips 1.75.
  week: 1.875,
  // 0.5 padding + emoji 2 + title 1.09 + time row 1.5 + 3 gaps + chips 1.75.
  "week-dense": 2,
  // 0.5 padding + emoji 1.75 + title 1.09 + time row 1.13 + 3 gaps + chips 1.75.
  "week-small": 1.875,
  // 0.5 padding + title 1.09 and time 1 beside the emoji + 0.125 gap + chips 1.5 (24px:
  // the narrowest tile and the last step before "+N", see TILE_CHIP_SIZE).
  "week-slim": 1.25,
};

/**
 * Whether `event` with `status` shows bring chips (a non-empty list, not over yet). The
 * capacity steps count such a tile at its taller height ({@link BRING_EXTRA_REM}).
 */
export function showsBring(
  event: Pick<CalendarEvent, "bring">,
  status: EventStatus,
): boolean {
  return status !== "past" && (event.bring?.length ?? 0) > 0;
}

/**
 * Bring chip size per tile size: `regular` (24px) in today's time row, `large` (28px) in
 * the chip row of its own of the narrow tiles.
 */
export const TILE_CHIP_SIZE: Record<TileSize, ChipSize> = {
  large: "regular",
  medium: "regular",
  dense: "regular",
  slim: "regular",
  compact: "large",
  "compact-dense": "large",
  week: "large",
  "week-dense": "large",
  "week-small": "large",
  // The last week step before "+N", about 7.7rem wide at 1280: 28px chips would cost a
  // whole tile on a school day (5 tiles with chips) and leave room for only two chips
  // beside the badges, so it keeps 24px (up from 20px).
  "week-slim": "regular",
};

/** Overlay that carries the tile edge on top of the tile's content. */
const EDGE_OVERLAY =
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-tile";

/**
 * Status look. Past events recede through surface/text tokens, never opacity (merge
 * rule 4). "Now" and "next" read without words (merge rule 3) and in person-neutral
 * colours, never a child's: the current event has a thick solid ring in the "now" ink
 * (plus the filled clock cue on its emoji), the next upcoming one a dashed outline in the
 * same ink (plus an outlined ▶ cue), so it does not repeat the gold of today's column.
 */
function statusClasses(
  status: EventStatus,
  next: boolean,
  tint: TileTint,
): string {
  if (status === "past") return "bg-surface-sunken text-text-muted";
  // The edge is drawn by an overlay above the content (`after:`), so a large emoji glyph
  // can never paint over the child's edge.
  const edge =
    tint.edge !== null
      ? `${EDGE_OVERLAY} after:inset-ring-4 ${CHILD_EDGE_AFTER}`
      : `${EDGE_OVERLAY} after:inset-ring-2 after:inset-ring-border`;
  const emphasis =
    status === "current"
      ? "ring-now shadow-raised ring-4"
      : next
        ? "outline-now shadow-raised outline-3 outline-offset-2 outline-dashed"
        : "";
  return `text-text ${edge} ${emphasis}`;
}

/**
 * Start-edge stripes of a shared tile: one vertical band per child, side by side.
 * Decorative (the accessible name names the children); clipped by the tile's corners.
 */
export function TileStripes({
  tint,
}: {
  tint: TileTint;
}): React.JSX.Element | null {
  const style = stripeStyle(tint);
  if (style === undefined) return null;
  return (
    <span
      aria-hidden="true"
      data-testid="tile-stripes"
      style={style}
      // Dimmed a quarter at night like the edges and badges (decorative stripes).
      className="night:brightness-75 pointer-events-none absolute inset-y-0 start-0"
    />
  );
}

/**
 * An emoji on a small light disc with a subtle ring, so pale glyphs (🦷, 🥛) stay
 * visible on light tints and dark ones at night. Decorative; `children` are drawn on top
 * (e.g. the "now" clock cue).
 */
export function EmojiDisc({
  emoji,
  disc,
  className,
  past = false,
  children,
}: {
  emoji: string;
  /** Disc size, e.g. `size-12`. */
  disc: string;
  /** Emoji size, e.g. `text-[2.5rem]`. */
  className: string;
  past?: boolean;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <span
      data-testid="emoji-disc"
      className={`${disc} ${past ? "bg-surface" : "bg-surface-sunken shadow-card"} rounded-pill inset-ring-border relative inline-flex shrink-0 items-center justify-center inset-ring-1`}
    >
      <Emoji
        emoji={emoji}
        className={`${className} ${past ? "grayscale" : ""}`}
      />
      {children}
    </span>
  );
}

/** Configured children of an event, in the event's order (unknown ids skipped). */
export function childrenOf(
  event: CalendarEvent,
  childList: readonly Child[],
): Child[] {
  return event.childIds.flatMap((id) => {
    const child = childList.find((c) => c.id === id);
    return child === undefined ? [] : [child];
  });
}

/** Joins the parts of a tile's accessible name ("Ballett, 15:30, For Mia"), skipping gaps. */
export function tileName(parts: readonly (string | undefined)[]): string {
  return parts.filter((part) => part !== undefined).join(", ");
}

export interface EventTileProps {
  event: CalendarEvent;
  /** Configured children; `event.childIds` are looked up here (unknown ids skipped). */
  childList: readonly Child[];
  format: FormatContext;
  /** Relative to now; computed by the caller (the tile is presentational). */
  status?: EventStatus;
  /** Timed event that began on an earlier day: shows "continues" instead of the start. */
  continues?: boolean;
  /** Time of day for the icon next to the time; `null` for all-day events. */
  timeOfDay?: DayBand | null;
  size?: TileSize;
  /** The next event that has not started yet (today only). */
  next?: boolean;
  /** Larger tile for "now" (else "next") in today's column, when space allows. */
  prominent?: boolean;
}

/**
 * An event as a picture tile: emoji on a light disc, a title of up to two lines with the
 * children's badges beside it (inside the tile), and the time-of-day icon with the time.
 * The fill is the child's tint (one child, with an edge), or neutral with a colour stripe
 * per child on the start edge (two and more) or plain neutral (none). The accessible name
 * says title, time, children and state ("Ballett, 15:30, Für Mia"); emoji and badges are
 * decorative. A bring list (ADR-0010) shows as emoji chips: in today's column at the end
 * of the time row (slim: of the one row), elsewhere in a row of their own below the time
 * (the tile is {@link BRING_EXTRA_REM} taller, with a little vertical padding; where the
 * picture sits beside the text the row spans the tile and ends with the badges, so the
 * title keeps the whole width); only whole chips plus "+N". The chips are
 * decorative; the tile's accessible description lists every icon ("Bring along: 👟 🩱").
 * Past tiles show no chips. Not interactive.
 */
export function EventTile({
  event,
  childList,
  format,
  status = "upcoming",
  continues = false,
  timeOfDay = null,
  size = "large",
  next = false,
  prominent = false,
}: EventTileProps): React.JSX.Element {
  const { t } = useTranslation();
  const kids = childrenOf(event, childList);
  const tint = resolveTileTint(kids);
  const big = prominent && PROMINENT_EXTRA_REM[size] > 0;
  const sizes = tileClasses(size, big);
  // Shared tiles: the disc moves off the start-edge stripes.
  const stripeRoom = tint.stripes.length > 0 ? "ms-2.5" : "";
  const past = status === "past";
  const bring = showsBring(event, status) ? (event.bring ?? []) : [];
  const bringId = useId();
  // Narrow tiles give the chips a row of their own (and grow); today's sit in the time row.
  const bringRow = bring.length > 0 && BRING_EXTRA_REM[size] > 0;
  const bringTile = bringRow ? BRING_TILE[size] : undefined;
  // A tile whose picture sits beside its text moves the badges to the end of its chip
  // row: the title keeps the tile's whole width (stacked week tiles keep the badges
  // beside the emoji, off the title anyway).
  const rowBadges = bringRow && !sizes.stacked;
  const chips =
    bring.length > 0 ? (
      <BringChips
        bring={bring}
        size={TILE_CHIP_SIZE[size]}
        align={bringRow ? "start" : "end"}
        className={sizes.inline ? "max-w-[40%]" : ""}
      />
    ) : null;
  const tileStyle: React.CSSProperties | undefined = past
    ? undefined
    : {
        ...tileTintStyle(tint),
        // The taller height the capacity steps count for this tile.
        ...(bringRow
          ? {
              height: `${String(
                TILE_HEIGHT_REM[size] + BRING_EXTRA_REM[size],
              )}rem`,
            }
          : {}),
      };
  const time = event.allDay
    ? t("event.allDay")
    : continues
      ? t("event.continues")
      : formatTime(event.start, format);
  const name = tileName([
    event.title,
    time,
    kids.length === 0
      ? t("event.forEveryone")
      : t("event.forChildren", { names: kids.map((child) => child.name) }),
    status === "upcoming"
      ? next
        ? t("event.status.next")
        : undefined
      : t(`event.status.${status}`),
  ]);
  const badges = (
    <ChildBadges
      tint={tint}
      size={sizes.badge}
      text={sizes.badgeText}
      overlap={sizes.badgeOverlap}
    />
  );
  const chipRow = bringRow ? (
    <div
      data-testid="bring-row"
      className={`flex w-full min-w-0 items-center gap-1 ${sizes.stacked ? "justify-center" : tint.stripes.length > 0 ? "ps-2.5" : ""}`}
    >
      {chips}
      {rowBadges && tint.badges.length > 0 && (
        <span data-testid="row-badges" className="ms-auto flex shrink-0">
          {badges}
        </span>
      )}
    </div>
  ) : null;
  // Slimmest week tile, all day: the badges move to the time row (only an icon there), so
  // the title keeps the width of its row.
  const allDayBadges = sizes.weekRow && event.allDay && !rowBadges;
  const meta = (
    <p
      className={`${sizes.metaText} text-text-muted flex min-w-0 items-center ${sizes.weekRow ? "gap-1" : "gap-1.5"} ${sizes.stacked ? "justify-center" : ""}`}
    >
      {event.allDay ? (
        <AllDayIcon className={sizes.allDayIcon} />
      ) : timeOfDay !== null && !sizes.weekRow ? (
        <TimeOfDayIcon timeOfDay={timeOfDay} className={sizes.timeIcon} />
      ) : null}
      {/* The slimmest week tile shows the all-day icon alone (too narrow for the word,
          which stays in the accessible name). */}
      {!(sizes.weekRow && event.allDay) && (
        <span className="min-w-0 truncate">{time}</span>
      )}
      {!sizes.inline && !bringRow && chips}
      {allDayBadges && <span className="ms-auto flex shrink-0">{badges}</span>}
    </p>
  );
  const plainEmoji = (
    <Emoji
      emoji={event.icon}
      className={`${sizes.emoji} ${past ? "grayscale" : ""}`}
    />
  );
  const disc =
    sizes.disc === null ? null : (
      <EmojiDisc
        emoji={event.icon}
        disc={`${sizes.disc} ${stripeRoom}`}
        className={sizes.emoji}
        past={past}
      >
        {status === "current" && (
          <span
            data-testid="now-cue"
            className={`bg-now text-surface rounded-pill absolute start-0 top-0 grid place-items-center ${sizes.cue}`}
          >
            <ClockIcon className="size-[75%]" />
          </span>
        )}
        {status === "upcoming" && next && (
          <span
            data-testid="next-cue"
            className={`bg-surface text-now ring-now rounded-pill absolute start-0 top-0 grid place-items-center ring-2 ${sizes.cue}`}
          >
            <NextIcon className="size-[70%]" />
          </span>
        )}
      </EmojiDisc>
    );
  const main = sizes.stacked ? (
    <>
      {/* Week tiles are picture-first. The badges sit beside the emoji in their own
         grid column (side by side, a gap to the emoji, never on top of it); the
         emoji stays centred while there is room. */}
      <div
        data-testid="tile-head"
        className="grid w-full min-w-0 grid-cols-[1fr_auto_1fr] items-start gap-1"
      >
        <span className="col-start-2 flex">{plainEmoji}</span>
        {tint.badges.length > 0 && (
          <span className="col-start-3 justify-self-end">{badges}</span>
        )}
      </div>
      {/* The title follows where the column is wide enough (`@container` on the
         week column's list), else it is only in the accessible name. */}
      <p
        className={`${sizes.title} ${tint.stripes.length > 0 ? "ps-2" : ""} hidden w-full min-w-0 text-center font-extrabold hyphens-manual @min-[5.5rem]:block`}
      >
        <span data-testid="tile-title" className={sizes.titleCut}>
          {event.title}
        </span>
      </p>
      {/* Full width, so a long word ("Ganztägig") is cut, not pushed out. */}
      <div className="w-full min-w-0">{meta}</div>
    </>
  ) : sizes.weekRow ? (
    // Slimmest week tile: emoji beside the title (badges at its end) and the time.
    <>
      {/* The time-of-day icon sits on the emoji's corner (as on the meal plates),
         so the time row has the width for "10:30 PM". */}
      <span
        className={`relative inline-flex shrink-0 ${tint.stripes.length > 0 ? "ms-2" : ""}`}
      >
        {plainEmoji}
        {!event.allDay && timeOfDay !== null && (
          <span
            data-testid="tile-time-of-day"
            className="absolute -end-1 -bottom-1"
          >
            <TimeOfDayIcon timeOfDay={timeOfDay} className={sizes.timeIcon} />
          </span>
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <div className="flex min-w-0 items-center justify-end gap-1">
          <p
            className={`${sizes.title} hidden min-w-0 flex-1 font-extrabold hyphens-manual @min-[7rem]:block`}
          >
            <span data-testid="tile-title" className={sizes.titleCut}>
              {event.title}
            </span>
          </p>
          {!allDayBadges && !rowBadges && badges}
        </div>
        {meta}
      </div>
    </>
  ) : sizes.inline ? (
    // Slim: one row (title cut with an ellipsis, badges, time), so a full day fits.
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <p className={`${sizes.title} min-w-0 flex-1 truncate`}>
        <span data-testid="tile-title">{event.title}</span>
      </p>
      {badges}
      <div className="shrink-0">{meta}</div>
      {chips}
    </div>
  ) : (
    <div className="flex min-w-0 flex-1 flex-col">
      {sizes.badgeFloat ? (
        // The badges float at the end of the first line only (one line high), so a
        // second line and the time run under them; a word that does not fit beside
        // them starts on the next line instead of being cut.
        <p
          className={`${sizes.title} max-h-[2lh] min-w-0 text-ellipsis hyphens-manual`}
        >
          {tint.badges.length > 0 && !rowBadges && (
            <span data-testid="badge-float" className="float-end ms-2 h-[1lh]">
              {badges}
            </span>
          )}
          <span data-testid="tile-title">{event.title}</span>
        </p>
      ) : (
        <div className="flex min-w-0 items-start gap-2">
          <p
            className={`${sizes.title} min-w-0 flex-1 text-ellipsis hyphens-manual`}
          >
            <span data-testid="tile-title">{event.title}</span>
          </p>
          {!rowBadges && badges}
        </div>
      )}
      {meta}
    </div>
  );
  return (
    <article
      aria-label={name}
      aria-describedby={bring.length > 0 ? bringId : undefined}
      data-testid="event-tile"
      data-status={status}
      data-next={next}
      data-prominent={big}
      data-all-day={event.allDay}
      data-size={size}
      data-tint={past ? "past" : tint.kind}
      data-bring={bring.length > 0 ? (bringRow ? "row" : "inline") : undefined}
      style={tileStyle}
      className={`${statusClasses(status, next, tint)} ${bringTile?.tile ?? sizes.tile} rounded-tile relative flex min-w-0 ${rowBadges ? "items-stretch" : "items-center"}`}
    >
      {/* The stripes are clipped to the tile's rounded start edge by their own wrapper. */}
      {!past && tint.stripes.length > 0 && (
        <span
          aria-hidden="true"
          className="rounded-tile pointer-events-none absolute inset-0 overflow-hidden"
        >
          <TileStripes tint={tint} />
        </span>
      )}
      {rowBadges ? (
        // A chip row of its own below the picture and the text, the badges at its end.
        <>
          <div
            data-testid="tile-main"
            className={`flex w-full min-w-0 flex-1 items-center ${bringTile?.row ?? ""}`}
          >
            {disc}
            {main}
          </div>
          {chipRow}
        </>
      ) : (
        <>
          {disc}
          {main}
          {chipRow}
        </>
      )}
      {bring.length > 0 && (
        <span id={bringId} hidden>
          {t("event.bring", { icons: bring.join(" ") })}
        </span>
      )}
    </article>
  );
}
