import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { CHIP_DISC } from "../components/BringChips";
import { ChildAvatar } from "../components/ChildAvatar";
import { CHILD_EDGE, childColorStyle } from "../components/childColor";
import { resolveChildTint } from "../components/childTint";
import { Emoji } from "../components/Emoji";
import { type FormatContext, formatWeekdayShort } from "../i18n/format";
import {
  BRING_BAG,
  type BringGroup,
  type BringReminder,
  type BringWhen,
} from "./buildBringReminder";
import { useContentWidth } from "./useContentWidth";

/**
 * Sizes of the 🎒 area in rem; the classes below use exactly these values (full class
 * names so Tailwind can see them).
 */
export const BRING_AREA_LAYOUT = {
  /** Padding around the content (`p-1.5`). */
  padRem: 0.375,
  /** One row of groups (`h-9`). */
  rowRem: 2.25,
  /** Gap between two rows (`gap-1`). */
  rowGapRem: 0.25,
  /** The head beside the rows (`w-18`), and the gap to the rows (`gap-1.5`). */
  headWidthRem: 4.5,
  headGapRem: 0.375,
  /** The head's stack in the evening: 🎒 (`h-7`), arrow and weekday (`h-6`), label (`h-5`). */
  headTomorrowRem: 1.75 + 1.5 + 1.25,
  /** … and in the morning: 🎒 and the label. */
  headTodayRem: 1.75 + 1.25,
} as const;

/**
 * Height in rem of the 🎒 area with `rows` rows of groups: the padding plus the taller of
 * the rows and the head beside them (which is taller in the evening, `when`).
 */
export function bringAreaRem(rows: number, when: BringWhen): number {
  const l = BRING_AREA_LAYOUT;
  const count = Math.max(1, rows);
  const stack = count * l.rowRem + (count - 1) * l.rowGapRem;
  const head = when === "tomorrow" ? l.headTomorrowRem : l.headTodayRem;
  return 2 * l.padRem + Math.max(stack, head);
}

/**
 * How many rows the area draws for `groups` groups when it may be `budgetRem` high
 * (`null`: not measured, then one row per group). Every group gets a row of its own while
 * they fit; with fewer rows, the last one holds the remaining groups side by side (see
 * {@link bringRowsOf}). Always at least one row (a too short budget still gets the
 * one-row area).
 */
export function bringAreaRows(
  groups: number,
  budgetRem: number | null,
  when: BringWhen,
): number {
  if (groups <= 0) return 0;
  if (budgetRem === null) return groups;
  let rows = groups;
  while (rows > 1 && bringAreaRem(rows, when) > budgetRem + 1e-6) rows -= 1;
  return rows;
}

/**
 * Splits `groups` groups into `rows` rows: one group per row, and when there are fewer
 * rows than groups, the last row holds all remaining groups. Group indexes, in order.
 */
export function bringRowsOf(groups: number, rows: number): number[][] {
  const count = Math.max(0, Math.min(rows, groups));
  return Array.from({ length: count }, (_, row) => {
    const last = row === count - 1;
    const end = last ? groups : row + 1;
    return Array.from({ length: end - row }, (_, offset) => row + offset);
  });
}

/**
 * Room of one row of groups in rem; the classes below use exactly these values (full
 * class names so Tailwind can see them).
 */
export const BRING_AREA_METRICS = {
  /** One chip disc (`size-7`). */
  chipRem: 1.75,
  /** Gap between the items of a group: badge, chips, "+N" (`gap-1`). */
  itemGapRem: 0.25,
  /** The child's avatar badge (`size-8`). */
  badgeRem: 2,
  /** Room kept for a "+N" (`min-w-8`): two digits ("+12") are 1.8rem wide. */
  moreRem: 2,
  /** Inline padding of a group with a badge (`ps-0.5 pe-2`) … */
  badgePadRem: 0.125 + 0.5,
  /** … and of the neutral group, which has none (`px-2`). */
  plainPadRem: 0.5 + 0.5,
  /** Gap between two groups and before the trailing "+N" (`gap-1.5`). */
  groupGapRem: 0.375,
} as const;

/** What the fit needs to know of a group: its icon count and whether it has a badge. */
export interface BringGroupSize {
  icons: number;
  badge: boolean;
}

export interface BringGroupFit {
  /** Groups drawn (the first `shown`), each with its drawn icon count. */
  drawn: number[];
  /** Icons of the groups that did not fit at all, counted in a trailing "+N". */
  hiddenIcons: number;
}

function groupRem(drawn: number, icons: number, badge: boolean): number {
  const m = BRING_AREA_METRICS;
  const more = drawn < icons ? 1 : 0;
  const items = (badge ? 1 : 0) + drawn + more;
  const pad = badge ? m.badgePadRem : m.plainPadRem;
  if (items === 0) return pad;
  return (
    pad +
    (badge ? m.badgeRem : 0) +
    drawn * m.chipRem +
    more * m.moreRem +
    (items - 1) * m.itemGapRem
  );
}

/**
 * Width in rem of the groups row when group `i` draws `drawn[i]` chips (plus its "+N"
 * when that is fewer than its icons), with a trailing "+N" when `hidden`.
 */
export function bringRowRem(
  groups: readonly BringGroupSize[],
  drawn: readonly number[],
  hidden: boolean,
): number {
  const m = BRING_AREA_METRICS;
  const widths = drawn.map((count, index) => {
    const group = groups[index];
    return group === undefined ? 0 : groupRem(count, group.icons, group.badge);
  });
  const parts = widths.length + (hidden ? 1 : 0);
  return (
    widths.reduce((sum, width) => sum + width, 0) +
    (hidden ? m.moreRem : 0) +
    Math.max(0, parts - 1) * m.groupGapRem
  );
}

/**
 * Which icons of the groups of one row of the 🎒 area fit it `widthRem` wide (`null`:
 * not measured, then all of them). A row usually holds one group (its icons in event
 * order, so a cut row keeps the earliest event's icons); the last row may hold several. Whole icons only, as `stripIconsThatFit`: every group keeps its badge
 * and shows as many whole chips as fit, its other icons in a plain-text "+N". Groups are
 * kept in order (neutral first, then config order); room is shared out one chip at a time
 * across them, so every child gets a fair share. Only when not even every group's badge
 * and "+N" fit, the last groups are left out and their icons counted in a trailing "+N".
 * `shown + counted` always covers every icon (the area's accessible name lists them all).
 */
export function bringGroupsThatFit(
  groups: readonly BringGroupSize[],
  widthRem: number | null,
): BringGroupFit {
  const all = groups.map((group) => Math.max(0, group.icons));
  if (widthRem === null) return { drawn: all, hiddenIcons: 0 };
  const available = widthRem + 1e-6;
  const iconsFrom = (start: number): number =>
    all.slice(start).reduce((sum, icons) => sum + icons, 0);

  // The most groups whose badge and "+N" fit (with a trailing "+N" for the rest).
  let shown = groups.length;
  while (
    shown > 0 &&
    bringRowRem(
      groups,
      new Array<number>(shown).fill(0),
      shown < groups.length,
    ) > available
  ) {
    shown -= 1;
  }
  const hidden = shown < groups.length;
  const drawn = new Array<number>(shown).fill(0);
  // One more chip per group in turn, while the row still fits.
  let grew = true;
  while (grew) {
    grew = false;
    for (let index = 0; index < shown; index += 1) {
      const current = drawn[index] ?? 0;
      if (current >= (all[index] ?? 0)) continue;
      drawn[index] = current + 1;
      if (bringRowRem(groups, drawn, hidden) <= available) {
        grew = true;
        continue;
      }
      // One more chip does not fit with the group's "+N" kept; all of its remaining
      // chips may still, as the "+N" then falls away (it is wider than a chip).
      drawn[index] = all[index] ?? current;
      if (bringRowRem(groups, drawn, hidden) <= available) {
        grew = true;
      } else {
        drawn[index] = current;
      }
    }
  }
  return { drawn, hiddenIcons: iconsFrom(shown) };
}

function groupName(group: BringGroup, everyone: string): string {
  return `${group.child?.name ?? everyone} ${group.icons.join(" ")}`;
}

/**
 * "→" before the day the bag is packed for (also before tomorrow's weather in the
 * evening clothing pill, T-49). Decorative, `currentColor`.
 */
export function TowardsArrow({
  testId = "bring-arrow",
}: {
  testId?: string;
}): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      data-testid={testId}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-text-muted size-4 shrink-0 rtl:-scale-x-100"
    >
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  );
}

/** The short weekday pill of the 🎒 area's day cue. */
export const DAY_PILL =
  "rounded-pill bg-surface-raised inset-ring-border text-meta text-text px-1.5 leading-tight font-black inset-ring-1";

/** One group: a pill with the child's badge (none for everyone) and whole chips. */
function GroupPill({
  group,
  drawn,
}: {
  group: BringGroup;
  drawn: number;
}): React.JSX.Element {
  const { t } = useTranslation();
  const counted = group.icons.length - drawn;
  const child = group.child;
  return (
    <span
      data-testid="bring-group"
      data-child={child?.id ?? ""}
      data-count={group.icons.length}
      data-drawn={drawn}
      style={
        child === null
          ? undefined
          : {
              background: resolveChildTint(child),
              ...childColorStyle(child.color),
            }
      }
      className={`rounded-pill flex h-9 shrink-0 items-center gap-1 ${
        child === null
          ? "bg-surface-raised inset-ring-border px-2 inset-ring-1"
          : `${CHILD_EDGE} ps-0.5 pe-2 inset-ring-2`
      }`}
    >
      {child !== null && (
        <ChildAvatar decorative child={child} className="text-body size-8" />
      )}
      {group.icons.slice(0, drawn).map((icon, position) => (
        <span
          key={`${String(position)}-${icon}`}
          data-testid="bring-area-chip"
          className={`size-7 ${CHIP_DISC}`}
        >
          <Emoji emoji={icon} className="text-[1.125rem]" />
        </span>
      ))}
      {counted > 0 && (
        <span
          data-testid="bring-group-more"
          className="text-meta text-text-muted min-w-8 shrink-0 text-center font-black"
        >
          {t("day.hidden.badge", { count: counted })}
        </span>
      )}
    </span>
  );
}

/**
 * The evening-before 🎒 area in today's overview column (T-36): a head with 🎒 and the
 * day it is for (evening: "→", tomorrow's short weekday and "Tomorrow"; morning:
 * "Today"), beside it one row per group (the neutral group for everyone first, then one per
 * child in config order: avatar badge, the child's tint and edge, the icons as chips), so
 * every child's icons show side by side, not behind a "+N". Its height is fixed by its
 * row count and variant ({@link bringAreaRem}); `maxRows` (from the column's space, `null`: one row
 * per group) caps it, and with fewer rows than groups the last row holds the rest side by
 * side. Each row measures its width and draws whole chips only (in event order), the rest
 * of a group as a plain-text "+N" ({@link bringGroupsThatFit}): a last resort for a very
 * long list. A labelled region (not a live region) whose name lists every child and icon;
 * nothing in it is interactive. Rendered only when there is something to pack. Emoji are
 * React text only (through `<Emoji>`, dimmed at night); the chips use the shared
 * {@link CHIP_DISC} (`--color-chip`, lighter at night).
 */
export function BringArea({
  reminder,
  format,
  maxRows = null,
}: {
  reminder: BringReminder;
  format: FormatContext;
  maxRows?: number | null;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const width = useContentWidth(ref);
  const { groups } = reminder;
  if (groups.length === 0) return null;
  const rows = bringRowsOf(
    groups.length,
    Math.max(1, Math.min(groups.length, maxRows ?? groups.length)),
  );
  const everyone = t("bring.everyone");
  const tomorrow = reminder.when === "tomorrow";
  const label = t(tomorrow ? "bring.tomorrow" : "bring.today", {
    groups: groups.map((group) => groupName(group, everyone)),
  });
  return (
    <section
      aria-label={label}
      data-testid="bring-area"
      data-when={reminder.when}
      data-rows={rows.length}
      style={{
        height: `${String(bringAreaRem(rows.length, reminder.when))}rem`,
      }}
      className="bg-surface-sunken rounded-tile inset-ring-border flex shrink-0 items-center gap-1.5 overflow-hidden p-1.5 inset-ring-1"
    >
      {/* Who reads can tell the day; the region's name says it for assistive tech. */}
      <div
        aria-hidden="true"
        data-testid="bring-head"
        className="flex w-18 shrink-0 flex-col items-center justify-center"
      >
        <Emoji
          emoji={BRING_BAG}
          className="flex h-7 items-center text-[1.5rem]"
        />
        {tomorrow && (
          <span className="flex h-6 items-center gap-0.5">
            <TowardsArrow />
            <span data-testid="bring-day" className={DAY_PILL}>
              {formatWeekdayShort(reminder.date, format)}
            </span>
          </span>
        )}
        <span
          data-testid="bring-cue"
          className="text-caption text-text-muted h-5 max-w-full truncate font-extrabold"
        >
          {t(tomorrow ? "bring.cueTomorrow" : "bring.cueToday")}
        </span>
      </div>
      <div
        ref={ref}
        aria-hidden="true"
        data-testid="bring-groups"
        className="flex min-w-0 flex-1 basis-0 flex-col justify-center gap-1"
      >
        {rows.map((indexes) => {
          const rowGroups = indexes.flatMap((index) => {
            const group = groups[index];
            return group === undefined ? [] : [group];
          });
          const fit = bringGroupsThatFit(
            rowGroups.map((group) => ({
              icons: group.icons.length,
              badge: group.child !== null,
            })),
            width,
          );
          return (
            <div
              key={rowGroups.map((group) => group.child?.id ?? "").join(",")}
              data-testid="bring-area-row"
              className="flex h-9 min-w-0 items-center gap-1.5 overflow-hidden"
            >
              {fit.drawn.map((drawn, position) => {
                const group = rowGroups[position];
                if (group === undefined) return null;
                return (
                  <GroupPill
                    key={group.child?.id ?? "everyone"}
                    group={group}
                    drawn={drawn}
                  />
                );
              })}
              {fit.hiddenIcons > 0 && (
                <span
                  data-testid="bring-area-more"
                  className="text-meta text-text-muted min-w-8 shrink-0 text-center font-black"
                >
                  {t("day.hidden.badge", { count: fit.hiddenIcons })}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
