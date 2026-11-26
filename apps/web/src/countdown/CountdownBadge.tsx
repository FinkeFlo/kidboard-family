import type { Child } from "@kidboard/shared";
import { useTranslation } from "react-i18next";

import { CHILD_EDGE } from "../components/childColor";
import { resolveTileTint, tileTintStyle } from "../components/childTint";
import { Emoji } from "../components/Emoji";
import { childrenOf } from "../components/EventTile";
import type { Countdown } from "./buildCountdown";

/** Up to this many nights every night is its own 🌙; beyond, one 🌙 with a number. */
export const MAX_INDIVIDUAL_MOONS = 14;
/** Moons per row: a week per row, so 14 nights are two rows (fits the header). */
export const MOONS_PER_ROW = 7;
/** Event icons shown when several countdown events fall on the same day. */
export const MAX_COUNTDOWN_ICONS = 3;

/** 🌙 means "one sleep" and nothing else on the board (tiles use 🌅 🌞 🌆, merge rule 1). */
const MOON = "🌙";
/** Pictorial "today!" cue next to the word, so non-readers see that the day has come. */
export const TODAY_CUE = "🎉";

// Full class names so Tailwind can see them. One size in both views (the pill looks the
// same on the overview and the week view), as high as the name chips next to it (`h-16`,
// see `ChildLegend`); 8 to 14 moons take two smaller rows. Moons are the part a child
// counts at a glance, so they stay big (heading, not body).
const SIZE = {
  icon: "text-title",
  disc: "size-11",
  moon: "text-heading",
  moonTwoRows: "text-title",
  count: "text-title",
  name: "text-body max-w-[10rem]",
  box: "gap-2 ps-4 pe-4",
} as const;

/** Night counts split into rows of {@link MOONS_PER_ROW}: 10 → [7, 3]. */
export function moonRows(nights: number): number[] {
  const rows: number[] = [];
  for (let left = nights; left > 0; left -= MOONS_PER_ROW) {
    rows.push(Math.min(left, MOONS_PER_ROW));
  }
  return rows;
}

/** One 🌙 per night (rows of a week), or a single 🌙 beyond {@link MAX_INDIVIDUAL_MOONS}. */
function Moons({ nights }: { nights: number }): React.JSX.Element {
  if (nights > MAX_INDIVIDUAL_MOONS) {
    return (
      <span data-testid="countdown-grouped" className="flex items-center">
        <Emoji emoji={MOON} className={SIZE.moon} />
      </span>
    );
  }
  const rows = moonRows(nights);
  const moon = rows.length > 1 ? SIZE.moonTwoRows : SIZE.moon;
  return (
    <span className="flex flex-col gap-0.5">
      {rows.map((count, row) => (
        <span key={row} className="flex gap-0.5">
          {Array.from({ length: count }, (_, index) => (
            <Emoji key={index} emoji={MOON} className={moon} />
          ))}
        </span>
      ))}
    </span>
  );
}

/** "→" between the moons and the goal: count towards it. Decorative, `currentColor`. */
function TowardsArrow(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      data-testid="countdown-arrow"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-text-muted size-6 shrink-0 rtl:-scale-x-100"
    >
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  );
}

export interface CountdownBadgeProps {
  countdown: Countdown;
  /** Configured children: the awaited event sits in its child's tint and edge. */
  childList?: readonly Child[];
}

/**
 * "How many sleeps?" (T-19), read from start to goal: the number of nights ("6 ×"), one
 * 🌙 per night (up to {@link MAX_INDIVIDUAL_MOONS}, in rows of a week; beyond, a single 🌙
 * after the number), an arrow, the awaited event icon(s) and the first event's title,
 * short. Today: 🎉 "Today!", then the icon(s) and the title. The visuals are hidden from
 * assistive tech; a localized, pluralized label says the same in words. As high as the
 * name chips beside it and the same size in both views. Static (no animation), so reduced motion needs nothing extra.
 */
export function CountdownBadge({
  countdown,
  childList = [],
}: CountdownBadgeProps): React.JSX.Element {
  const { t } = useTranslation();
  const titles = countdown.events.map((event) => event.title);
  const label =
    countdown.nights === 0
      ? t("countdown.todayLabel", { titles })
      : t("countdown.nights", { count: countdown.nights, titles });
  const isToday = countdown.nights === 0;
  const name = countdown.events[0]?.title;
  return (
    <section
      aria-label={t("countdown.label")}
      data-testid="countdown"
      data-nights={countdown.nights}
      className={`${isToday ? "ring-today-ring ring-4" : ""} bg-surface-raised text-text rounded-pill shadow-card flex h-16 min-w-0 items-center ${SIZE.box}`}
    >
      <p className="sr-only">{label}</p>
      <span aria-hidden="true" className="flex shrink-0 items-center gap-2">
        {isToday ? (
          <span
            data-testid="countdown-today"
            className="flex items-center gap-2"
          >
            <Emoji emoji={TODAY_CUE} className={SIZE.moon} />
            <span className={`${SIZE.count} font-extrabold`}>
              {t("countdown.today")}
            </span>
          </span>
        ) : (
          <>
            <span
              data-testid="countdown-count"
              className={`${SIZE.count} font-black whitespace-nowrap`}
            >
              {t("countdown.count", { count: countdown.nights })}
            </span>
            <Moons nights={countdown.nights} />
            <TowardsArrow />
          </>
        )}
      </span>
      <span aria-hidden="true" className="flex shrink-0 items-center">
        {countdown.events.slice(0, MAX_COUNTDOWN_ICONS).map((event) => {
          // The awaited event in its children's tint, with the child's edge (one child).
          const tint = resolveTileTint(childrenOf(event, childList));
          return (
            <span
              key={event.id}
              data-testid="countdown-target"
              data-tint={tint.kind}
              style={tileTintStyle(tint)}
              className={`${
                tint.edge === null ? "inset-ring-border" : CHILD_EDGE
              } rounded-pill -ms-2 inline-flex shrink-0 items-center justify-center inset-ring-3 first:ms-0 ${SIZE.disc}`}
            >
              <Emoji emoji={event.icon} className={SIZE.icon} />
            </span>
          );
        })}
      </span>
      {name !== undefined && (
        <span
          aria-hidden="true"
          data-testid="countdown-name"
          className={`${SIZE.name} min-w-0 truncate font-extrabold`}
        >
          {name}
        </span>
      )}
    </section>
  );
}
