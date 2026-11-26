import { addWallMinutes, zonedWallTimeToEpochMs } from "./zonedTime";

/** Default duration of a timed entry without `endTime`. */
export const DEFAULT_DURATION_MINUTES = 60;

/** The time fields of a timed entry. */
export interface TimedFields {
  date: string;
  startTime: string;
  endTime?: string | undefined;
  endDate?: string | undefined;
}

export interface TimedRange {
  startMs: number;
  endMs: number;
  /** True if `endTime` was given (the end may then be invalid, see `valid`). */
  explicitEnd: boolean;
  /** End strictly after start (always true for the default end). */
  valid: boolean;
}

/**
 * Start and end instants of a timed entry in `timeZone` (the configured zone, never the
 * device zone). Wall-clock times are resolved with the RFC 5545 gap/overlap rules of
 * `zonedWallTimeToEpochMs`, so in a spring-forward gap a start such as 02:30 becomes
 * 03:30 (new offset).
 *
 * - No `endTime`: one hour later on the wall clock; if that does not lie after the
 *   resolved start (the start was in a DST gap), start + 60 real minutes instead. Always
 *   valid.
 * - Explicit `endTime` (+ optional `endDate`): resolved as given; `valid` is false when
 *   the resolved end is not after the resolved start (e.g. Berlin 2026-03-29
 *   02:30-03:00: 03:30+02:00 to 03:00+02:00). Such entries are rejected by
 *   `parseEditorEntryInput` (`time_range_invalid`), never clamped.
 */
export function resolveTimedRange(
  fields: TimedFields,
  timeZone: string,
): TimedRange {
  const startMs = zonedWallTimeToEpochMs(
    fields.date,
    fields.startTime,
    timeZone,
  );
  if (fields.endTime === undefined) {
    const wall = addWallMinutes(
      fields.date,
      fields.startTime,
      DEFAULT_DURATION_MINUTES,
    );
    const wallEndMs = zonedWallTimeToEpochMs(wall.date, wall.time, timeZone);
    return {
      startMs,
      endMs:
        wallEndMs > startMs
          ? wallEndMs
          : startMs + DEFAULT_DURATION_MINUTES * 60_000,
      explicitEnd: false,
      valid: true,
    };
  }
  const endMs = zonedWallTimeToEpochMs(
    fields.endDate ?? fields.date,
    fields.endTime,
    timeZone,
  );
  return { startMs, endMs, explicitEnd: true, valid: endMs > startMs };
}
