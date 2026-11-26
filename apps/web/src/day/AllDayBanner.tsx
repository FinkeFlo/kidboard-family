import type { Child } from "@kidboard/shared";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { BringChips } from "../components/BringChips";
import { ChildBadges } from "../components/ChildBadges";
import { CHILD_EDGE } from "../components/childColor";
import { resolveTileTint, tileTintStyle } from "../components/childTint";
import {
  childrenOf,
  EmojiDisc,
  tileName,
  TileStripes,
} from "../components/EventTile";
import { AllDayIcon } from "../components/TimeOfDayIcon";
import type { DayEvent } from "./buildDayModel";

/** All-day entries a banner shows; more are summed up in a "+N" (never hidden silently). */
export const ALL_DAY_MAX = 2;
/** Badge sizes on a banner entry (today / other days). */
const BADGE = {
  large: { size: "size-8", text: "text-body", overlap: "-ms-2" },
  small: { size: "size-6", text: "text-caption", overlap: "-ms-1.5" },
} as const;

/** Start margin that moves the emoji off a shared entry's stripes. */
const STRIPE_ROOM = "ms-2.5";

/**
 * All-day events at the top of a day column (merge rule 1: their own treatment, not a
 * tile with the midday sun): a flat strip per event with the emoji, a visible "All day"
 * label with the span icon above the title, and the children's tint, stripes and badges
 * as on the tiles, and a bring list as chips before the badges (described as on the
 * tiles). Beyond {@link ALL_DAY_MAX} a "+N" names the rest for assistive tech.
 */
export function AllDayBanner({
  items,
  childList,
  large,
}: {
  items: readonly DayEvent[];
  childList: readonly Child[];
  /** Today's column: larger emoji and title. */
  large: boolean;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const baseId = useId();
  if (items.length === 0) return null;
  const shown = items.slice(0, ALL_DAY_MAX);
  const rest = items.slice(ALL_DAY_MAX);
  const badge = large ? BADGE.large : BADGE.small;
  const discSize = large ? "size-11" : "size-10";
  return (
    <ul
      data-testid="all-day"
      className="-mx-1.5 flex shrink-0 flex-col gap-2 px-1.5 pt-2"
    >
      {shown.map(({ event }, index) => {
        const bring = event.bring ?? [];
        const bringId = `${baseId}-bring-${String(index)}`;
        const kids = childrenOf(event, childList);
        const tint = resolveTileTint(kids);
        const name = tileName([
          event.title,
          t("event.allDay"),
          kids.length === 0
            ? t("event.forEveryone")
            : t("event.forChildren", {
                names: kids.map((child) => child.name),
              }),
        ]);
        return (
          <li key={event.id} className="min-w-0">
            <article
              aria-label={name}
              aria-describedby={bring.length > 0 ? bringId : undefined}
              data-testid="event-tile"
              data-all-day="true"
              data-tint={tint.kind}
              style={tileTintStyle(tint)}
              className={`${
                tint.edge === null
                  ? "inset-ring-border inset-ring-2"
                  : `inset-ring-4 ${CHILD_EDGE}`
              } text-text rounded-tile relative flex items-center gap-2 overflow-hidden ${large ? "h-14 ps-2.5" : "h-13 ps-2"} pe-2.5`}
            >
              <TileStripes tint={tint} />
              <EmojiDisc
                emoji={event.icon}
                disc={`${discSize} ${tint.stripes.length > 0 ? STRIPE_ROOM : ""}`}
                className={large ? "text-[2.125rem]" : "text-[1.875rem]"}
              />
              <div className="min-w-0 flex-1">
                <p
                  aria-hidden="true"
                  data-testid="all-day-label"
                  className="text-caption text-text-muted flex items-center gap-1 font-black"
                >
                  <AllDayIcon className="size-4" />
                  <span className="truncate">{t("event.allDay")}</span>
                </p>
                <p
                  className={`${large ? "text-tile" : "text-tile-compact"} truncate`}
                >
                  {event.title}
                </p>
              </div>
              {bring.length > 0 && (
                <BringChips bring={bring} className="max-w-[45%]" />
              )}
              <ChildBadges
                tint={tint}
                size={badge.size}
                text={badge.text}
                overlap={badge.overlap}
              />
              {bring.length > 0 && (
                <span id={bringId} hidden>
                  {t("event.bring", { icons: bring.join(" ") })}
                </span>
              )}
            </article>
          </li>
        );
      })}
      {rest.length > 0 && (
        <li
          data-testid="all-day-more"
          data-count={rest.length}
          className="text-meta text-text-muted flex items-center gap-1.5 font-black"
        >
          <AllDayIcon className="size-5" />
          <span aria-hidden="true">
            {t("day.hidden.badge", { count: rest.length })}
          </span>
          <span className="sr-only">
            {t("day.hidden.allDay", {
              count: rest.length,
              titles: rest.map((item) => item.event.title),
            })}
          </span>
        </li>
      )}
    </ul>
  );
}
