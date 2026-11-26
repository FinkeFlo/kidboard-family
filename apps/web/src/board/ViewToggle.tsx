import { useTranslation } from "react-i18next";

import { Emoji } from "../components/Emoji";

export type BoardView = "day" | "week";

/** Rail order: the overview ("Today") first. */
const VIEWS: readonly BoardView[] = ["day", "week"];

/**
 * Seven bars: one week, today's bar in the sun colour. Decorative (the label names the
 * button); colours come from tokens (`fill-sun`, `fill-border`).
 */
function WeekBars(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      data-testid="week-bars"
      viewBox="0 0 34 24"
      className="h-8 w-11"
    >
      {Array.from({ length: 7 }, (_, index) => (
        <rect
          key={index}
          x={index * 5}
          y="1"
          width="3.4"
          height="22"
          rx="1.7"
          className={index === 0 ? "fill-sun" : "fill-border"}
        />
      ))}
    </svg>
  );
}

export interface ViewToggleProps {
  view: BoardView;
  onChange: (view: BoardView) => void;
}

/**
 * The navigation rail's two big buttons, "Today" (sun, also at night: one symbol, one
 * meaning) and "Week" (seven bars). Picture plus a short word, so it works for children
 * who cannot read; the word is the accessible name. The active button is filled, the
 * other outlined (a cue besides colour). Each is far above the 64 px touch minimum.
 */
export function ViewToggle({
  view,
  onChange,
}: ViewToggleProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t("board.viewGroup")}
      data-testid="view-toggle"
      className="gap-gutter flex flex-col"
    >
      {VIEWS.map((option) => {
        const active = option === view;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            data-view={option}
            onClick={() => {
              onChange(option);
            }}
            className={`${
              active
                ? "bg-nav-active text-on-nav-active shadow-card"
                : "bg-surface-raised text-text inset-ring-border inset-ring-3"
            } w-nav min-h-touch rounded-nav text-body focus-visible:outline-text flex h-30 flex-col items-center justify-center gap-2 font-black transition-transform duration-(--duration-fast) focus-visible:outline-4 focus-visible:outline-offset-2 active:scale-[0.97] motion-reduce:transition-none`}
          >
            {option === "day" ? (
              // At night the active fill is a light tan, on which the dimmed sun fades:
              // it then sits on a dark page-coloured disc (same flow height either way).
              <span
                data-testid="today-sun"
                className={`${active ? "night:bg-surface" : ""} rounded-pill -my-1 grid size-10 place-items-center`}
              >
                <Emoji emoji="☀️" className="text-heading" />
              </span>
            ) : (
              <WeekBars />
            )}
            {t(`board.${option}`)}
          </button>
        );
      })}
    </div>
  );
}
