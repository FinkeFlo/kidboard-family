import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFullscreen } from "./useFullscreen";

let fullscreenElement: Element | null;
let requestFullscreen: ReturnType<typeof vi.fn>;
let exitFullscreen: ReturnType<typeof vi.fn>;
let modes: Record<string, boolean>;

function setFullscreen(element: Element | null): void {
  fullscreenElement = element;
  document.dispatchEvent(new Event("fullscreenchange"));
}

function define(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { configurable: true, value });
}

beforeEach(() => {
  fullscreenElement = null;
  modes = {};
  requestFullscreen = vi.fn(() => {
    setFullscreen(document.documentElement);
    return Promise.resolve();
  });
  exitFullscreen = vi.fn(() => {
    setFullscreen(null);
    return Promise.resolve();
  });
  define(document, "fullscreenEnabled", true);
  define(document, "exitFullscreen", exitFullscreen);
  define(document.documentElement, "requestFullscreen", requestFullscreen);
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
  define(window, "matchMedia", (query: string) => ({
    matches: modes[/display-mode: (\w+)/.exec(query)?.[1] ?? ""] ?? false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  for (const key of [
    "fullscreenEnabled",
    "exitFullscreen",
    "fullscreenElement",
  ]) {
    Reflect.deleteProperty(document, key);
  }
  Reflect.deleteProperty(document.documentElement, "requestFullscreen");
  Reflect.deleteProperty(window, "matchMedia");
  vi.restoreAllMocks();
});

describe("useFullscreen", () => {
  it("is available in a plain browser tab", () => {
    const { result } = renderHook(() => useFullscreen());
    expect(result.current).toMatchObject({ available: true, active: false });
  });

  it("is unavailable where fullscreen is unsupported or disabled", () => {
    define(document, "fullscreenEnabled", false);
    expect(renderHook(() => useFullscreen()).result.current.available).toBe(
      false,
    );
    define(document, "fullscreenEnabled", true);
    Reflect.deleteProperty(document.documentElement, "requestFullscreen");
    expect(renderHook(() => useFullscreen()).result.current.available).toBe(
      false,
    );
  });

  it.each(["standalone", "fullscreen"])(
    "is hidden when launched in %s display mode",
    (mode) => {
      modes[mode] = true;
      expect(renderHook(() => useFullscreen()).result.current.available).toBe(
        false,
      );
    },
  );

  it("enters and leaves fullscreen and follows fullscreenchange", async () => {
    const { result } = renderHook(() => useFullscreen());
    await act(() => result.current.toggle());
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(result.current.active).toBe(true);
    // Entered through the control: display-mode now reads fullscreen, control stays.
    modes["fullscreen"] = true;
    act(() => {
      setFullscreen(document.documentElement);
    });
    expect(result.current.available).toBe(true);
    await act(() => result.current.toggle());
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(result.current.active).toBe(false);
  });

  it("picks up fullscreen left by the browser (Esc)", () => {
    const { result } = renderHook(() => useFullscreen());
    act(() => {
      setFullscreen(document.documentElement);
    });
    expect(result.current.active).toBe(true);
    act(() => {
      setFullscreen(null);
    });
    expect(result.current.active).toBe(false);
  });

  it("swallows a refused request", async () => {
    requestFullscreen.mockRejectedValueOnce(new TypeError("denied"));
    const { result } = renderHook(() => useFullscreen());
    await act(() => result.current.toggle());
    expect(result.current.active).toBe(false);
  });
});
