import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { useContentWidth } from "../day/useContentWidth";
import { Emoji } from "./Emoji";
import { type IconRowMetrics, iconRowRem, iconsThatFit } from "./iconsThatFit";

/**
 * Chip sizes: `regular` (24px) where the chips share the time row (today's tiles, the
 * all-day banner), as tall as its time-of-day icon (1.5rem), so the row and the tile keep
 * their height; `large` (28px, as in the 🎒 area) in the chip row of its own of the narrow
 * tiles (`compact`, `compact-dense` and every week size), so the icons stay distinct
 * across the room.
 */
export type ChipSize = "regular" | "large";

interface ChipClasses extends IconRowMetrics {
  chip: string;
  emoji: string;
  more: string;
  gap: string;
}

// Full class names so Tailwind can see them; the rem metrics match the classes.
const CHIP_SIZES: Record<ChipSize, ChipClasses> = {
  regular: {
    chip: "size-6",
    emoji: "text-[1rem]",
    more: "text-meta",
    gap: "gap-0.5",
    slotRem: 1.5,
    gapRem: 0.125,
    moreRem: 1.5,
  },
  large: {
    chip: "size-7",
    emoji: "text-[1.125rem]",
    more: "text-meta",
    gap: "gap-0.5",
    slotRem: 1.75,
    gapRem: 0.125,
    moreRem: 1.5,
  },
};

/**
 * The disc behind one bring chip (size classes not included): `--color-chip` (the emoji
 * disc colour by day, lighter than every surface and tint at night, so dark glyphs stay
 * visible) with a thin `--color-border` ring. Shared by the tiles and the bring area.
 */
export const CHIP_DISC =
  "bg-chip rounded-pill inset-ring-border inline-grid shrink-0 place-items-center inset-ring-1";

/** Row metrics of `size` (for the pure fit, {@link iconsThatFit}). */
export function chipMetrics(size: ChipSize): IconRowMetrics {
  const { slotRem, gapRem, moreRem } = CHIP_SIZES[size];
  return { slotRem, gapRem, moreRem };
}

/**
 * How many of `count` chips of `size` fit `widthRem` (`null`: not measured, all), whole
 * chips only, the rest counted in a "+N".
 */
export function chipsThatFit(
  count: number,
  widthRem: number | null,
  size: ChipSize,
): number {
  return iconsThatFit(count, 0, widthRem, chipMetrics(size));
}

/**
 * An event's bring list as small emoji chips on its tile (ADR-0010): each icon on a
 * {@link CHIP_DISC} (light by day like the tile's own emoji disc, lighter than the tile at
 * night, so pale and dark glyphs stay visible on every tint), then a plain-text "+N" for
 * the icons that do not fit. Decorative:
 * the tile names the whole list once in its accessible description (`event.bring`:
 * "Bring along: 👟 🩱").
 *
 * The chip area asks for the width of every chip and gives it up first when its row is
 * short (it shrinks before the time text), down to the room of the "+N". It measures the
 * width it got and draws only whole chips ({@link chipsThatFit}); its width never depends
 * on how many it draws, so the measurement is stable. Emoji are React text only.
 */
export function BringChips({
  bring,
  size = "regular",
  align = "end",
  className = "",
}: {
  bring: readonly string[];
  size?: ChipSize;
  /** `end`: the chips sit at the end of their row; `start`: right after the time. */
  align?: "start" | "end";
  /** Extra classes on the area, e.g. a `max-w-*` cap. */
  className?: string;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const ref = useRef<HTMLSpanElement>(null);
  const width = useContentWidth(ref);
  if (bring.length === 0) return null;
  const sizes = CHIP_SIZES[size];
  const need = iconRowRem(bring.length, sizes);
  const drawn = chipsThatFit(bring.length, width, size);
  const counted = bring.length - drawn;
  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-testid="bring-chips"
      data-count={bring.length}
      data-drawn={drawn}
      // The width of all chips, shrinking first (`shrink-999`) down to the "+N" room.
      style={{
        width: `${String(need)}rem`,
        minWidth: `${String(Math.min(need, sizes.moreRem))}rem`,
      }}
      className={`flex shrink-999 items-center overflow-hidden ${sizes.gap} ${align === "end" ? "ms-auto justify-end" : ""} ${className}`}
    >
      {bring.slice(0, drawn).map((icon, index) => (
        <span
          // The list is deduplicated server-side; the index keeps keys unique anyway.
          key={`${String(index)}-${icon}`}
          data-testid="bring-chip"
          className={`${sizes.chip} ${CHIP_DISC}`}
        >
          <Emoji emoji={icon} className={sizes.emoji} />
        </span>
      ))}
      {counted > 0 && (
        <span
          data-testid="bring-chips-more"
          className={`${sizes.more} text-text-muted shrink-0 font-black`}
        >
          {t("day.hidden.badge", { count: counted })}
        </span>
      )}
    </span>
  );
}
