import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type ContentSize,
  measureContentHeight,
  useContentHeight,
} from "./useContentHeight";

/** Every height the hook returned, render by render. */
let seen: (number | null)[] = [];
/** Every size object the hook returned, render by render. */
let objects: (ContentSize | null)[] = [];

function Probe(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const size = useContentHeight(ref);
  seen.push(size === null ? null : size.height);
  objects.push(size);
  return (
    <div
      ref={ref}
      data-testid="probe"
      style={{ paddingTop: "8px", paddingBottom: "6px" }}
    />
  );
}

function fakeClientHeight(px: number): void {
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(px);
}

/** An observer that never reports on its own; `fire` reports a new height. */
function stubObserver(): { fire: (height: number) => void } {
  const callbacks: ((
    entries: { contentRect: { height: number } }[],
  ) => void)[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(
        callback: (entries: { contentRect: { height: number } }[]) => void,
      ) {
        callbacks.push(callback);
      }
      observe(): void {}
      disconnect(): void {}
    },
  );
  return {
    fire(height: number): void {
      for (const callback of callbacks) callback([{ contentRect: { height } }]);
    },
  };
}

afterEach(() => {
  seen = [];
  objects = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("measureContentHeight", () => {
  it("is the client height minus the vertical padding, never negative", () => {
    render(<Probe />);
    const probe = screen.getByTestId("probe");
    fakeClientHeight(300);
    expect(measureContentHeight(probe)).toBe(286);
    fakeClientHeight(10);
    expect(measureContentHeight(probe)).toBe(0);
  });
});

describe("useContentHeight", () => {
  it("measures before the first paint, without waiting for the observer", () => {
    stubObserver();
    fakeClientHeight(300);
    render(<Probe />);
    // The layout effect's synchronous update re-rendered before `render` returned: the
    // first committed frame after mount already has the fitted height.
    expect(seen).toEqual([null, 286]);
  });

  it("follows the observer afterwards and ignores unchanged sizes", () => {
    const observer = stubObserver();
    fakeClientHeight(300);
    render(<Probe />);
    act(() => {
      observer.fire(200);
    });
    expect(seen.at(-1)).toBe(200);
    const before = objects.at(-1);
    act(() => {
      observer.fire(200);
    });
    // Same size: the previous state object is kept, so nothing downstream changes.
    expect(objects.at(-1)).toBe(before);
  });

  it("stays null without ResizeObserver (callers then show everything)", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    fakeClientHeight(300);
    render(<Probe />);
    expect(seen.every((value) => value === null)).toBe(true);
  });
});
