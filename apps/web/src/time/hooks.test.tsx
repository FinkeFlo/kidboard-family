import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useNow, useToday } from "./hooks";

const at = (iso: string): number => Date.parse(iso);
const HOUR_MS = 3_600_000;

function startAt(iso: string): void {
  vi.useFakeTimers({ now: at(iso) });
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Renders `useToday(zone)` and records every value it rendered. */
function renderToday(zone: string | undefined): {
  current: () => string | undefined;
  renders: (string | undefined)[];
  unmount: () => void;
} {
  const renders: (string | undefined)[] = [];
  const { result, unmount } = renderHook(() => {
    const today = useToday(zone);
    renders.push(today);
    return today;
  });
  return { current: () => result.current, renders, unmount };
}

function setVisibility(state: DocumentVisibilityState): void {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("useNow", () => {
  it("returns the current minute and ticks at each minute boundary", () => {
    startAt("2026-11-22T10:15:42.500Z");
    const { result, unmount } = renderHook(() => useNow());
    expect(result.current).toBe(at("2026-11-22T10:15:00Z"));

    advance(17_499);
    expect(result.current).toBe(at("2026-11-22T10:15:00Z"));
    advance(1);
    expect(result.current).toBe(at("2026-11-22T10:16:00Z"));
    advance(60_000 * 5);
    expect(result.current).toBe(at("2026-11-22T10:21:00Z"));

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("useToday", () => {
  it("changes exactly at local midnight (normal night)", () => {
    // 23:59:30 Berlin (+01:00).
    startAt("2026-11-22T22:59:30Z");
    const today = renderToday("Europe/Berlin");
    expect(today.current()).toBe("2026-11-22");

    advance(29_999);
    expect(today.current()).toBe("2026-11-22");
    advance(1);
    expect(today.current()).toBe("2026-11-23");
    // Re-renders only when the date changes, not every minute.
    advance(10 * 60_000);
    expect(today.renders).toEqual(["2026-11-22", "2026-11-23"]);
    today.unmount();
  });

  it("spring-forward night: 23 h day, next midnight 23 h later", () => {
    // 2026-03-28 23:59 +01:00; at 02:00 the clock jumps to 03:00 +02:00.
    startAt("2026-03-28T22:59:00Z");
    const today = renderToday("Europe/Berlin");
    advance(60_000);
    expect(today.current()).toBe("2026-03-29");
    expect(Date.now()).toBe(at("2026-03-29T00:00:00+01:00"));

    // 23 h after midnight it is 00:00 +02:00 on the 30th.
    advance(23 * HOUR_MS - 1);
    expect(today.current()).toBe("2026-03-29");
    advance(1);
    expect(today.current()).toBe("2026-03-30");
    expect(Date.now()).toBe(at("2026-03-30T00:00:00+02:00"));
    expect(today.renders).toEqual(["2026-03-28", "2026-03-29", "2026-03-30"]);
    today.unmount();
  });

  it("fall-back night: 25 h day, no change 24 h after midnight", () => {
    // 2026-10-24 23:59 +02:00; at 03:00 the clock goes back to 02:00 +01:00.
    startAt("2026-10-24T21:59:00Z");
    const today = renderToday("Europe/Berlin");
    advance(60_000);
    expect(today.current()).toBe("2026-10-25");

    advance(24 * HOUR_MS); // 23:00 +01:00, still the 25th
    expect(today.current()).toBe("2026-10-25");
    advance(HOUR_MS - 1);
    expect(today.current()).toBe("2026-10-25");
    advance(1);
    expect(today.current()).toBe("2026-10-26");
    expect(Date.now()).toBe(at("2026-10-26T00:00:00+01:00"));
    today.unmount();
  });

  it("DST change at midnight: the day starts at 01:00 (America/Santiago)", () => {
    // 2026-09-05 23:59 -04:00 is followed by 2026-09-06 01:00 -03:00.
    startAt("2026-09-06T03:59:00Z");
    const today = renderToday("America/Santiago");
    expect(today.current()).toBe("2026-09-05");
    advance(59_999);
    expect(today.current()).toBe("2026-09-05");
    advance(1);
    expect(today.current()).toBe("2026-09-06");
    today.unmount();
  });

  it("follows the config zone, not the device zone", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    // Precondition: the device zone really is different (UTC-8 in November).
    expect(new Date(at("2026-11-22T12:00:00Z")).getTimezoneOffset()).toBe(480);
    // 23:59 Berlin = 14:59 Los Angeles.
    startAt("2026-11-22T22:59:00Z");
    const berlin = renderToday("Europe/Berlin");
    const tokyo = renderToday("Asia/Tokyo");
    expect(berlin.current()).toBe("2026-11-22");
    expect(tokyo.current()).toBe("2026-11-23");

    advance(60_000);
    expect(berlin.current()).toBe("2026-11-23");
    // Device midnight (08:00Z) changes nothing for Berlin; Tokyo flips at 15:00Z.
    advance(9 * HOUR_MS); // 08:00Z
    expect(berlin.current()).toBe("2026-11-23");
    expect(tokyo.current()).toBe("2026-11-23");
    advance(7 * HOUR_MS); // 15:00Z = 00:00 Tokyo on the 24th
    expect(tokyo.current()).toBe("2026-11-24");
    expect(berlin.current()).toBe("2026-11-23");
    berlin.unmount();
    tokyo.unmount();
  });

  it("tab sleeping across midnight: updates on visibilitychange", () => {
    startAt("2026-11-22T21:30:00Z"); // 22:30 Berlin
    const today = renderToday("Europe/Berlin");
    setVisibility("hidden");
    // The tablet sleeps; no timer runs while the wall clock moves to 07:05 next day.
    vi.setSystemTime(at("2026-11-23T06:05:20Z"));
    expect(today.current()).toBe("2026-11-22");

    setVisibility("visible");
    expect(today.current()).toBe("2026-11-23");
    today.unmount();
  });

  it("a hidden-state event does not update, a late timer does", () => {
    startAt("2026-11-22T22:59:30Z");
    const today = renderToday("Europe/Berlin");
    setVisibility("hidden");
    // Throttled background timer: the clock is already past midnight when it fires.
    vi.setSystemTime(at("2026-11-23T01:00:00Z"));
    setVisibility("hidden");
    expect(today.current()).toBe("2026-11-22");
    advance(30_000);
    expect(today.current()).toBe("2026-11-23");
    today.unmount();
  });

  it("system clock jumping backwards is recomputed, not accumulated", () => {
    startAt("2026-11-23T00:30:10Z"); // 01:30 Berlin, 23rd
    const today = renderToday("Europe/Berlin");
    expect(today.current()).toBe("2026-11-23");
    // NTP correction: the clock was 2 h ahead.
    vi.setSystemTime(at("2026-11-22T22:30:10Z"));
    advance(50_000);
    expect(today.current()).toBe("2026-11-22");
    advance(29 * 60_000); // 23:00Z = 00:00 Berlin on the 23rd
    expect(today.current()).toBe("2026-11-23");
    today.unmount();
  });

  it("is undefined until the zone is known, then derives the date", () => {
    startAt("2026-11-22T22:59:30Z");
    const { result, rerender, unmount } = renderHook(
      ({ zone }: { zone: string | undefined }) => useToday(zone),
      { initialProps: { zone: undefined as string | undefined } },
    );
    expect(result.current).toBeUndefined();
    rerender({ zone: "Asia/Tokyo" });
    expect(result.current).toBe("2026-11-23");
    rerender({ zone: "Europe/Berlin" });
    expect(result.current).toBe("2026-11-22");
    unmount();
  });
});
