import { renderHook } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";

import {
  useWakeLock,
  WAKE_LOCK_RETRY_BASE_MS,
  WAKE_LOCK_RETRY_MAX_MS,
} from "./useWakeLock";

class FakeSentinel extends EventTarget {
  released = false;
  release = vi.fn(() => {
    this.released = true;
    this.dispatchEvent(new Event("release"));
    return Promise.resolve();
  });
}

let sentinels: FakeSentinel[];
let request: Mock<() => Promise<FakeSentinel>>;
let visibility: DocumentVisibilityState;

function setVisibility(state: DocumentVisibilityState): void {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Lets pending promise continuations run. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function grant(): Promise<FakeSentinel> {
  const sentinel = new FakeSentinel();
  sentinels.push(sentinel);
  return Promise.resolve(sentinel);
}

beforeEach(() => {
  sentinels = [];
  visibility = "visible";
  request = vi.fn(grant);
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: { request },
  });
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "wakeLock");
});

describe("useWakeLock", () => {
  it("requests a screen lock while the page is visible", async () => {
    renderHook(() => {
      useWakeLock();
    });
    await flush();
    expect(request).toHaveBeenCalledExactlyOnceWith("screen");
  });

  it("does not request while hidden, then acquires when visible again", async () => {
    visibility = "hidden";
    renderHook(() => {
      useWakeLock();
    });
    await flush();
    expect(request).not.toHaveBeenCalled();
    setVisibility("visible");
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not re-acquire on release while hidden, but on becoming visible", async () => {
    renderHook(() => {
      useWakeLock();
    });
    await flush();
    // Browser releases the lock when the page is hidden.
    setVisibility("hidden");
    sentinels[0]?.dispatchEvent(new Event("release"));
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("re-acquires at once when the system releases it while visible", async () => {
    renderHook(() => {
      useWakeLock();
    });
    await flush();
    sentinels[0]?.dispatchEvent(new Event("release"));
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(sentinels).toHaveLength(2);
  });

  it("retries a rejected request by timer with a bounded delay, no visibility change", async () => {
    vi.useFakeTimers();
    request.mockRejectedValue(new DOMException("low", "NotAllowedError"));
    renderHook(() => {
      useWakeLock();
    });
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(WAKE_LOCK_RETRY_BASE_MS - 1);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(2);
    // Still failing: the delay doubles (no hot loop) and stays capped.
    await vi.advanceTimersByTimeAsync(WAKE_LOCK_RETRY_BASE_MS * 2 - 1);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(WAKE_LOCK_RETRY_MAX_MS * 10);
    expect(request.mock.calls.length).toBeLessThanOrEqual(3 + 10 + 1);
    // Success ends the retrying.
    request.mockImplementation(grant);
    await vi.advanceTimersByTimeAsync(WAKE_LOCK_RETRY_MAX_MS);
    const calls = request.mock.calls.length;
    expect(sentinels).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(WAKE_LOCK_RETRY_MAX_MS * 3);
    expect(request).toHaveBeenCalledTimes(calls);
    vi.useRealTimers();
  });

  it("also retries on window focus and clears the retry timer on unmount", async () => {
    vi.useFakeTimers();
    request.mockRejectedValueOnce(new DOMException("low", "NotAllowedError"));
    const { unmount } = renderHook(() => {
      useWakeLock();
    });
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    window.dispatchEvent(new Event("focus"));
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(sentinels).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0); // the successful acquire cleared the timer

    unmount();
    request.mockRejectedValue(new DOMException("low", "NotAllowedError"));
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("leaves no retry timer behind when unmounted after a rejection", async () => {
    vi.useFakeTimers();
    request.mockRejectedValue(new DOMException("low", "NotAllowedError"));
    const { unmount } = renderHook(() => {
      useWakeLock();
    });
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("does not stack a second lock while one is held", async () => {
    renderHook(() => {
      useWakeLock();
    });
    await flush();
    setVisibility("visible");
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not issue parallel requests while one is pending", async () => {
    renderHook(() => {
      useWakeLock();
    });
    setVisibility("visible");
    setVisibility("visible");
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("survives a rejected request and retries on the next visibility change", async () => {
    request.mockRejectedValueOnce(new DOMException("low", "NotAllowedError"));
    renderHook(() => {
      useWakeLock();
    });
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(sentinels).toHaveLength(0);
    setVisibility("visible");
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(sentinels).toHaveLength(1);
  });

  it("is a no-op where the API is missing", async () => {
    Reflect.deleteProperty(navigator, "wakeLock");
    const { unmount } = renderHook(() => {
      useWakeLock();
    });
    setVisibility("visible");
    await flush();
    expect(() => {
      unmount();
    }).not.toThrow();
  });

  it("releases the lock and stops listening on unmount", async () => {
    const { unmount } = renderHook(() => {
      useWakeLock();
    });
    await flush();
    unmount();
    expect(sentinels[0]?.released).toBe(true);
    setVisibility("visible");
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("releases a lock that arrives after unmount", async () => {
    const { unmount } = renderHook(() => {
      useWakeLock();
    });
    unmount();
    await flush();
    expect(sentinels[0]?.released).toBe(true);
  });
});
