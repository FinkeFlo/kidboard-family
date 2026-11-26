import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { measureContentWidthRem, useContentWidth } from "./useContentWidth";

/** Every width the hook returned, render by render. */
let seen: (number | null)[] = [];

function Probe(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  seen.push(useContentWidth(ref));
  return (
    <div
      ref={ref}
      data-testid="probe"
      style={{ paddingLeft: "8px", paddingRight: "8px" }}
    />
  );
}

/** An observer that never reports on its own; `fire` reports a new width. */
function stubObserver(): { fire: (width: number) => void } {
  const callbacks: ((entries: { contentRect: { width: number } }[]) => void)[] =
    [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(
        callback: (entries: { contentRect: { width: number } }[]) => void,
      ) {
        callbacks.push(callback);
      }
      observe(): void {}
      disconnect(): void {}
    },
  );
  return {
    fire(width: number): void {
      for (const callback of callbacks) callback([{ contentRect: { width } }]);
    },
  };
}

afterEach(() => {
  seen = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useContentWidth", () => {
  it("is null without ResizeObserver (callers fall back to their maximum)", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(<Probe />);
    expect(seen.every((width) => width === null)).toBe(true);
  });

  it("measures the content box in rem before the first paint, then follows the observer", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(176);
    const observer = stubObserver();
    render(<Probe />);
    // 176px minus 16px padding at a 16px root.
    expect(seen.at(-1)).toBe(10);
    act(() => {
      observer.fire(320);
    });
    expect(seen.at(-1)).toBe(20);
  });

  it("ignores a report without a width instead of turning it into NaN", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(96);
    const observer = stubObserver();
    render(<Probe />);
    act(() => {
      observer.fire(Number.NaN);
    });
    expect(seen.at(-1)).toBe(5);
  });

  it("never reports a negative width", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(4);
    vi.stubGlobal("ResizeObserver", undefined);
    render(<Probe />);
    expect(measureContentWidthRem(screen.getByTestId("probe"))).toBe(0);
  });
});
