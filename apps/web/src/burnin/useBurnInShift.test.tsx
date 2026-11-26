import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BURN_IN_STEP_MINUTES, burnInOffset, burnInStepIndex } from "./burnIn";
import { useBurnInShift } from "./useBurnInShift";

const STEP_MS = BURN_IN_STEP_MINUTES * 60_000;
/** An instant exactly on an orbit step boundary. */
const T0 = 400_000 * STEP_MS;

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("useBurnInShift", () => {
  it("follows the orbit: stable within a step, next point on the boundary", () => {
    vi.useFakeTimers({ now: T0 });
    const { result } = renderHook(() => useBurnInShift());
    const first = result.current;
    expect(first).toBe(burnInOffset(burnInStepIndex(T0)));

    // Minute ticks inside the step re-render but keep the very same offset.
    advance(STEP_MS - 60_000);
    expect(result.current).toBe(first);

    advance(60_000);
    expect(result.current).toBe(burnInOffset(burnInStepIndex(T0) + 1));
    expect(result.current).not.toEqual(first);
  });

  it("completes the orbit and starts over", () => {
    vi.useFakeTimers({ now: T0 });
    const { result } = renderHook(() => useBurnInShift());
    const first = result.current;
    const seen = new Set([first]);
    for (let i = 1; i < 8; i++) {
      advance(STEP_MS);
      seen.add(result.current);
    }
    expect(seen.size).toBe(8);
    advance(STEP_MS);
    expect(result.current).toBe(first);
  });

  it("catches up after the page slept for several steps", () => {
    vi.useFakeTimers({ now: T0 });
    const { result } = renderHook(() => useBurnInShift());
    vi.setSystemTime(T0 + 3 * STEP_MS + 1000);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe(burnInOffset(burnInStepIndex(T0) + 3));
  });

  it("?burnin pins the offset regardless of the clock", () => {
    window.history.replaceState(null, "", "/?burnin=3");
    vi.useFakeTimers({ now: T0 });
    const { result } = renderHook(() => useBurnInShift());
    expect(result.current).toEqual({ x: 1, y: 1 });
    advance(5 * STEP_MS);
    expect(result.current).toEqual({ x: 1, y: 1 });
  });
});
