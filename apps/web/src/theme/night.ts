import type { PublicConfig } from "@kidboard/shared";

import { minuteOfDay, minutesOfTime } from "../time";

/** Night mode window of the config (`HH:mm`, `end` before `start` spans midnight). */
export type NightMode = PublicConfig["nightMode"];

/**
 * Whether night mode is active at `instant`, by the wall clock of `timeZone` (never the
 * device zone). The window is `[start, end)`: `start` belongs to the night, `end` to the
 * day. `end` earlier than `start` means the window spans midnight (19:30-06:30). Disabled
 * night mode is never active. Uses wall-clock minutes, so on a DST night the window
 * follows the clock face: a skipped hour never matches, a repeated hour matches twice.
 */
export function isNight(
  instant: Date | number,
  nightMode: NightMode,
  timeZone: string,
): boolean {
  if (!nightMode.enabled) {
    return false;
  }
  const minutes = minuteOfDay(instant, timeZone);
  const start = minutesOfTime(nightMode.start);
  const end = minutesOfTime(nightMode.end);
  return start < end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
}

/** Query parameter that forces night (`1`) or day (`0`) mode, for testing. */
export const NIGHT_PARAM = "night";

/**
 * Reads `?night=1|0` from a location search string: `true` = force night, `false` =
 * force day, `undefined` = no (or an invalid) override. Deliberately not persisted: it
 * lives only as long as the page was opened with it, so a forgotten test link never
 * leaves the kiosk stuck in one theme after the next reload from a clean URL.
 */
export function parseNightOverride(search: string): boolean | undefined {
  const value = new URLSearchParams(search).get(NIGHT_PARAM);
  if (value === "1") return true;
  if (value === "0") return false;
  return undefined;
}
