import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAutoReturn } from "./useAutoReturn";

function tick(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useAutoReturn", () => {
  it("calls back once after the idle time", () => {
    const onReturn = vi.fn();
    renderHook(() => {
      useAutoReturn(true, 120, onReturn);
    });
    tick(119_999);
    expect(onReturn).not.toHaveBeenCalled();
    tick(1);
    expect(onReturn).toHaveBeenCalledTimes(1);
    tick(600_000);
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["pointerdown", () => new Event("pointerdown")],
    ["pointermove", () => new Event("pointermove")],
    ["touchstart", () => new Event("touchstart")],
    ["keydown", () => new KeyboardEvent("keydown", { key: "a" })],
  ])("restarts the countdown on %s", (_name, make) => {
    const onReturn = vi.fn();
    renderHook(() => {
      useAutoReturn(true, 10, onReturn);
    });
    tick(9_000);
    act(() => {
      document.body.dispatchEvent(make());
    });
    tick(9_000);
    expect(onReturn).not.toHaveBeenCalled();
    tick(1_000);
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it("does nothing while disabled and cancels when disabled", () => {
    const onReturn = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }) => {
        useAutoReturn(enabled, 10, onReturn);
      },
      { initialProps: { enabled: false } },
    );
    tick(60_000);
    expect(onReturn).not.toHaveBeenCalled();
    rerender({ enabled: true });
    tick(5_000);
    rerender({ enabled: false });
    tick(60_000);
    expect(onReturn).not.toHaveBeenCalled();
    // Re-enabling starts a full countdown again.
    rerender({ enabled: true });
    tick(9_999);
    expect(onReturn).not.toHaveBeenCalled();
    tick(1);
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it("stops listening and counting after unmount", () => {
    const onReturn = vi.fn();
    const { unmount } = renderHook(() => {
      useAutoReturn(true, 10, onReturn);
    });
    unmount();
    tick(60_000);
    expect(onReturn).not.toHaveBeenCalled();
  });

  it("uses the latest callback and restarts when the duration changes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ cb, seconds }) => {
        useAutoReturn(true, seconds, cb);
      },
      { initialProps: { cb: first, seconds: 10 } },
    );
    rerender({ cb: second, seconds: 10 });
    tick(10_000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    rerender({ cb: second, seconds: 30 });
    tick(29_999);
    expect(second).toHaveBeenCalledTimes(1);
    tick(1);
    expect(second).toHaveBeenCalledTimes(2);
  });
});
