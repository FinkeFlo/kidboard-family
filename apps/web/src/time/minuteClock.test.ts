import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMinuteClock } from "./minuteClock";

const at = (iso: string): number => Date.parse(iso);

interface FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState;
  setVisibility(state: DocumentVisibilityState): void;
}

/** A `document` stand-in with a switchable `visibilityState`. */
function fakeDocument(): FakeDocument {
  const target = new EventTarget();
  const extra: Omit<FakeDocument, keyof EventTarget> = {
    visibilityState: "visible",
    setVisibility(state) {
      extra.visibilityState = state;
      target.dispatchEvent(new Event("visibilitychange"));
    },
  };
  return Object.defineProperties(target, {
    visibilityState: { get: () => extra.visibilityState },
    setVisibility: { value: extra.setVisibility },
  }) as FakeDocument;
}

beforeEach(() => {
  vi.useFakeTimers({ now: at("2026-11-22T10:15:42.500Z") });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createMinuteClock", () => {
  it("fires at minute boundaries, aligned to the wall clock", () => {
    const clock = createMinuteClock();
    const fired: number[] = [];
    const unsubscribe = clock.subscribe(() => fired.push(Date.now()));

    vi.advanceTimersByTime(17_499);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fired).toEqual([at("2026-11-22T10:16:00Z")]);
    vi.advanceTimersByTime(120_000);
    expect(fired).toEqual([
      at("2026-11-22T10:16:00Z"),
      at("2026-11-22T10:17:00Z"),
      at("2026-11-22T10:18:00Z"),
    ]);
    unsubscribe();
  });

  it("shares one timer between listeners and stops without listeners", () => {
    const clock = createMinuteClock();
    const a = vi.fn<() => void>();
    const b = vi.fn<() => void>();
    const offA = clock.subscribe(a);
    const offB = clock.subscribe(b);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(17_500);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    offA();
    expect(vi.getTimerCount()).toBe(1);
    offA(); // idempotent
    expect(vi.getTimerCount()).toBe(1);
    offB();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(600_000);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("recomputes each delay from now(): a late timer or clock jump does not drift", () => {
    const clock = createMinuteClock();
    const fired: number[] = [];
    const off = clock.subscribe(() => fired.push(Date.now()));

    // The system clock jumps 3 h 20.25 s forward; the pending timer keeps its delay.
    vi.setSystemTime(at("2026-11-22T13:16:02.750Z"));
    vi.advanceTimersByTime(17_500); // first timer fires "late", at 13:16:20.250
    expect(fired).toEqual([at("2026-11-22T13:16:20.250Z")]);
    // The next delay is computed afresh: 39.75 s to 13:17:00, not another 60 s.
    vi.advanceTimersByTime(39_749);
    expect(fired).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(fired).toEqual([
      at("2026-11-22T13:16:20.250Z"),
      at("2026-11-22T13:17:00Z"),
    ]);
    off();
  });

  it("notifies at once and realigns when the page becomes visible", () => {
    const doc = fakeDocument();
    const clock = createMinuteClock({ document: doc });
    const fired: number[] = [];
    const off = clock.subscribe(() => fired.push(Date.now()));

    doc.setVisibility("hidden");
    expect(fired).toEqual([]);
    // Asleep: timers did not run while the system time moved on.
    vi.setSystemTime(at("2026-11-23T06:30:10Z"));
    doc.setVisibility("visible");
    expect(fired).toEqual([at("2026-11-23T06:30:10Z")]);
    expect(vi.getTimerCount()).toBe(1);
    // Realigned: next tick at 06:31:00, not at the old timer's slot.
    vi.advanceTimersByTime(49_999);
    expect(fired).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(fired[1]).toBe(at("2026-11-23T06:31:00Z"));
    off();
  });

  it("notifies on pageshow (back/forward cache restore)", () => {
    const doc = fakeDocument();
    const win = new EventTarget();
    const clock = createMinuteClock({ document: doc, window: win });
    const listener = vi.fn<() => void>();
    const off = clock.subscribe(listener);
    win.dispatchEvent(new Event("pageshow"));
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    win.dispatchEvent(new Event("pageshow"));
    doc.setVisibility("visible");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
