import { TZDate } from "@date-fns/tz";
import { minutesOfTime, type PublicConfig } from "@kidboard/shared";

/**
 * Pure clock and band logic (no React, no timers), so it can be tested at exact
 * instants. Every function takes the configured IANA zone explicitly; the device zone
 * is never used.
 */

export const MINUTE_MS = 60_000;

export { minutesOfTime };

/** Start of the minute containing `epochMs` (epoch ms). */
export function startOfMinute(epochMs: number): number {
  return epochMs - mod(epochMs, MINUTE_MS);
}

/**
 * Milliseconds from `epochMs` to the next minute boundary, in `(0, 60 000]`.
 *
 * Epoch minute boundaries are local minute boundaries in every zone with a
 * whole-minute UTC offset (all current IANA zones, including +05:45 or +12:45), so
 * local midnight is always one of them.
 */
export function msUntilNextMinute(epochMs: number): number {
  return MINUTE_MS - mod(epochMs, MINUTE_MS);
}

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/** Day bands of the config (`HH:mm`, strictly ascending; validated by the shared schema). */
export type Bands = PublicConfig["bands"];

/**
 * Band of the day:
 * - `night`: `[00:00, morningStart)`, before the day has started (nothing is current),
 * - `morning`: `[morningStart, middayStart)`,
 * - `midday`: `[middayStart, eveningStart)`,
 * - `evening`: `[eveningStart, 24:00)`.
 */
export type BandId = "night" | "morning" | "midday" | "evening";

/** The three visible bands of the day view, in order. */
export const DAY_BANDS = ["morning", "midday", "evening"] as const;
export type DayBand = (typeof DAY_BANDS)[number];

/**
 * Wall-clock minutes since local midnight of `instant` in `timeZone` (0-1439).
 * Reads the zone's wall clock: on a fall-back night 02:30 occurs twice and both
 * instants give 150; on a spring-forward night 02:00-02:59 never occurs.
 */
export function minuteOfDay(instant: Date | number, timeZone: string): number {
  const wall = new TZDate(+instant, timeZone);
  const hours = wall.getHours();
  if (Number.isNaN(hours)) {
    throw new RangeError("Unknown time zone or invalid instant");
  }
  return hours * 60 + wall.getMinutes();
}

/** Band containing `instant` in `timeZone`; boundaries belong to the later band. */
export function bandOf(
  instant: Date | number,
  bands: Bands,
  timeZone: string,
): BandId {
  const minutes = minuteOfDay(instant, timeZone);
  if (minutes < minutesOfTime(bands.morningStart)) {
    return "night";
  }
  if (minutes < minutesOfTime(bands.middayStart)) {
    return "morning";
  }
  return minutes < minutesOfTime(bands.eveningStart) ? "midday" : "evening";
}
