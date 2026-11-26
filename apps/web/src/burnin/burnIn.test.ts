import { describe, expect, it } from "vitest";

import {
  BURN_IN_ORBIT,
  BURN_IN_STEP_MS,
  burnInOffset,
  burnInStepIndex,
  parseBurnInOverride,
} from "./burnIn";

describe("burnInStepIndex", () => {
  it("is constant within a step and advances on the step boundary", () => {
    const start = 1000 * BURN_IN_STEP_MS;
    expect(burnInStepIndex(start)).toBe(1000);
    expect(burnInStepIndex(start + BURN_IN_STEP_MS - 1)).toBe(1000);
    expect(burnInStepIndex(start + BURN_IN_STEP_MS)).toBe(1001);
  });
});

describe("burnInOffset", () => {
  it("never stands still: consecutive steps always move", () => {
    for (let step = 0; step < BURN_IN_ORBIT.length * 2; step++) {
      expect(burnInOffset(step)).not.toEqual(burnInOffset(step + 1));
      expect(burnInOffset(step)).not.toEqual({ x: 0, y: 0 });
    }
  });

  it("is periodic over the orbit and visits every point once per round", () => {
    const size = BURN_IN_ORBIT.length;
    const round = Array.from({ length: size }, (_, i) => burnInOffset(i));
    expect(
      new Set(round.map(({ x, y }) => `${String(x)},${String(y)}`)).size,
    ).toBe(size);
    for (let i = 0; i < size; i++) {
      expect(burnInOffset(i + 7 * size)).toBe(burnInOffset(i));
    }
  });

  it("moves at most one unit per axis and only to a neighbouring ring point", () => {
    for (let step = 0; step < BURN_IN_ORBIT.length; step++) {
      const a = burnInOffset(step);
      const b = burnInOffset(step + 1);
      expect(Math.abs(a.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
    }
  });

  it("wraps negative step numbers and survives non-finite input", () => {
    expect(burnInOffset(-1)).toBe(burnInOffset(BURN_IN_ORBIT.length - 1));
    expect(burnInOffset(-9)).toBe(burnInOffset(7));
    expect(burnInOffset(Number.NaN)).toEqual({ x: 0, y: 0 });
    expect(burnInOffset(Number.POSITIVE_INFINITY)).toEqual({ x: 0, y: 0 });
    expect(burnInOffset(2.9)).toBe(burnInOffset(2));
  });
});

describe("parseBurnInOverride", () => {
  it("pins an orbit index", () => {
    expect(parseBurnInOverride("?burnin=3")).toEqual({ x: 1, y: 1 });
    expect(parseBurnInOverride("?night=1&burnin=7")).toEqual({ x: -1, y: -1 });
  });

  it("ignores missing, out-of-range and malformed values", () => {
    for (const search of [
      "",
      "?burnin=",
      "?burnin=8",
      "?burnin=-1",
      "?burnin=1.5",
      "?burnin=a",
      "?burnin=01",
    ]) {
      expect(parseBurnInOverride(search)).toBeUndefined();
    }
  });
});
