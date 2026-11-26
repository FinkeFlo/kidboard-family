import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";
import { AUTO_RESET_BASE_MS } from "./components/AppErrorBoundary";
import en from "./i18n/locales/en.json";

class FakeSentinel extends EventTarget {
  release = vi.fn(() => {
    this.dispatchEvent(new Event("release"));
    return Promise.resolve();
  });
}

let sentinels: FakeSentinel[];
let request: ReturnType<typeof vi.fn<() => Promise<FakeSentinel>>>;
let shouldThrow: boolean;

function Bomb(): React.JSX.Element {
  if (shouldThrow) throw new Error("render failure");
  return <p>board</p>;
}

/** Lets the pending `request()` continuation run. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("AppShell", () => {
  beforeEach(() => {
    shouldThrow = true;
    sentinels = [];
    request = vi.fn(() => {
      const sentinel = new FakeSentinel();
      sentinels.push(sentinel);
      return Promise.resolve(sentinel);
    });
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request },
    });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    // React logs caught render errors; keep the output clean.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "wakeLock");
  });

  it("keeps the wake lock while the error fallback shows and across its automatic reset", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    render(
      <AppShell>
        <Bomb />
      </AppShell>,
    );
    await flush();
    expect(
      screen.getByRole("heading", { name: en.error.title }),
    ).toBeInTheDocument();
    expect(request).toHaveBeenCalledExactlyOnceWith("screen");
    const [held] = sentinels;
    expect(held?.release).not.toHaveBeenCalled();

    // A failed automatic retry shows the fallback again: the lock is still the same one.
    act(() => {
      vi.advanceTimersByTime(AUTO_RESET_BASE_MS);
    });
    await flush();
    expect(
      screen.getByRole("heading", { name: en.error.title }),
    ).toBeInTheDocument();
    shouldThrow = false;
    act(() => {
      vi.advanceTimersByTime(AUTO_RESET_BASE_MS * 2);
    });
    await flush();
    expect(screen.getByText("board")).toBeInTheDocument();
    expect(held?.release).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("releases the lock only when the whole shell unmounts", async () => {
    shouldThrow = false;
    const { unmount } = render(
      <AppShell>
        <Bomb />
      </AppShell>,
    );
    await flush();
    expect(screen.getByText("board")).toBeInTheDocument();
    unmount();
    expect(sentinels[0]?.release).toHaveBeenCalledTimes(1);
  });
});
