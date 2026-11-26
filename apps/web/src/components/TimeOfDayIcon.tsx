import type { DayBand } from "../time";
import { Emoji } from "./Emoji";

/**
 * Time-of-day symbols on tiles and meal plates. One symbol, one meaning (merge rule 1):
 * 🌙 only counts sleeps (countdown) and ☀️ is the "Today" button, so midday is the sun
 * with a face and the evening a dusk skyline, never a moon.
 */
export const TIME_OF_DAY_SYMBOL: Record<DayBand, string> = {
  morning: "🌅",
  midday: "🌞",
  evening: "🌆",
};

/** Small decorative time-of-day emoji; the time next to it carries the meaning. */
export function TimeOfDayIcon({
  timeOfDay,
  className = "",
}: {
  timeOfDay: DayBand;
  className?: string;
}): React.JSX.Element {
  return (
    <Emoji
      emoji={TIME_OF_DAY_SYMBOL[timeOfDay]}
      className={`${className} shrink-0`.trim()}
    />
  );
}

/**
 * Own symbol for all-day events (not the midday sun, merge rule 1): a bar that spans the
 * whole width between two end marks, "from start to end of the day". Decorative; the
 * visible "All day" label next to it says the same.
 */
export function AllDayIcon({
  className = "size-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      data-testid="all-day-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      className={`shrink-0 ${className}`}
    >
      <path d="M2.5 5v14M21.5 5v14" />
      <rect
        x="5.5"
        y="9"
        width="13"
        height="6"
        rx="3"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

/** Clock face: the "now" cue on the now line and on the current tile. Decorative. */
export function ClockIcon({
  className = "size-4",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      data-testid="now-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

/** Check mark on the icons of the "vorbei" strip ("done"). Decorative. */
export function CheckIcon({
  className = "size-3",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      data-testid="done-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/**
 * "Next" cue on the emoji of the next upcoming tile: a play triangle ("this comes next"),
 * distinct from the clock of "now". Decorative (`currentColor`); the tile's name says it.
 */
export function NextIcon({
  className = "size-4",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      data-testid="next-icon"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`shrink-0 ${className} rtl:-scale-x-100`}
    >
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
    </svg>
  );
}
