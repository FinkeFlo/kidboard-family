/*
 * Burn-in protection (T-22): the whole board drifts by a few pixels on a slow orbit, so
 * static elements (header, toggle, band edges) never sit on the same pixels for hours.
 * Pure and deterministic: the offset only depends on the wall clock (epoch ms).
 */

/** A shift in units of `--spacing-burn-in` (the amplitude token); each axis is -1, 0 or 1. */
export interface BurnInOffset {
  readonly x: -1 | 0 | 1;
  readonly y: -1 | 0 | 1;
}

/** The board moves to the next orbit position every this many minutes. */
export const BURN_IN_STEP_MINUTES = 5;
export const BURN_IN_STEP_MS = BURN_IN_STEP_MINUTES * 60_000;

/**
 * The orbit: the eight points of a square ring around the centre, clockwise from the top.
 * No step is `(0, 0)`, so every step moves; four of the points are the corners, i.e. the
 * maximum shift on both axes at once.
 */
export const BURN_IN_ORBIT: readonly BurnInOffset[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

const ORIGIN: BurnInOffset = { x: 0, y: 0 };

/** Orbit step number for an instant: constant for {@link BURN_IN_STEP_MINUTES} minutes. */
export function burnInStepIndex(nowMs: number): number {
  return Math.floor(nowMs / BURN_IN_STEP_MS);
}

/**
 * Offset for a step number. Wraps around the orbit (negative numbers too); a non-finite
 * `stepIndex` gives no shift.
 */
export function burnInOffset(stepIndex: number): BurnInOffset {
  if (!Number.isFinite(stepIndex)) {
    return ORIGIN;
  }
  const size = BURN_IN_ORBIT.length;
  const index = ((Math.trunc(stepIndex) % size) + size) % size;
  return BURN_IN_ORBIT[index] ?? ORIGIN;
}

/**
 * Test hook: `?burnin=<n>` (n = 0..7, an index into {@link BURN_IN_ORBIT}; 1, 3, 5 and 7
 * are the corners = maximum shift) pins the offset instead of following the clock.
 * Anything else is ignored.
 */
export function parseBurnInOverride(search: string): BurnInOffset | undefined {
  const value = new URLSearchParams(search).get("burnin");
  if (value === null || !/^[0-7]$/.test(value)) {
    return undefined;
  }
  return BURN_IN_ORBIT[Number(value)];
}
