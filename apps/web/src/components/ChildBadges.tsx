import { useTranslation } from "react-i18next";

import { ChildAvatar } from "./ChildAvatar";
import type { TileTint } from "./childTint";

/**
 * The children's signs inside a tile: one badge per child (up to `MAX_BADGES`), side by
 * side and overlapping by at most a quarter of a badge, each with a ring that separates
 * it from its neighbour; more children are counted as "+N". Decorative: the tile's
 * accessible name names every child.
 */
export function ChildBadges({
  tint,
  size,
  text,
  overlap,
}: {
  tint: TileTint;
  /** Badge size, e.g. `size-9`. */
  size: string;
  /** Emoji size inside a badge, e.g. `text-body`. */
  text: string;
  /** Negative start margin of every badge but the first: a quarter of `size`, e.g. `-ms-2.25`. */
  overlap: string;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  if (tint.badges.length === 0) return null;
  return (
    <span
      aria-hidden="true"
      data-testid="child-badges"
      className="flex shrink-0 items-center"
    >
      {tint.badges.map((child) => (
        <ChildAvatar
          key={child.id}
          decorative
          child={child}
          className={`ring-on-child night:ring-surface ring-2 first:ms-0 ${overlap} ${size} ${text}`}
        />
      ))}
      {tint.overflow > 0 && (
        <span
          data-testid="child-badges-more"
          className={`bg-surface-raised text-text ring-border rounded-pill text-caption inline-flex shrink-0 items-center justify-center font-black ring-2 ${overlap} ${size}`}
        >
          {t("event.moreChildren", { count: tint.overflow })}
        </span>
      )}
    </span>
  );
}
