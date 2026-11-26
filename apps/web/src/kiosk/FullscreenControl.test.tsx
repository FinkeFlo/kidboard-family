import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyLocale } from "../i18n";
import de from "../i18n/locales/de.json";
import en from "../i18n/locales/en.json";
import {
  FULLSCREEN_HINT_MS,
  FULLSCREEN_HOLD_MS,
  FullscreenControl,
} from "./FullscreenControl";

const toggle = vi.fn(() => Promise.resolve());
let state: { available: boolean; active: boolean };

vi.mock("./useFullscreen", () => ({
  useFullscreen: () => ({ ...state, toggle }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  toggle.mockClear();
  state = { available: true, active: false };
});
afterEach(() => {
  vi.useRealTimers();
  applyLocale("en");
});

describe("FullscreenControl", () => {
  it("renders nothing when fullscreen is not available", () => {
    state = { available: false, active: false };
    const { container } = render(<FullscreenControl />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is labelled in both locales and reflects the state", () => {
    const { rerender } = render(<FullscreenControl />);
    expect(
      screen.getByRole("button", { name: en.fullscreen.enter }),
    ).toBeInTheDocument();
    state = { available: true, active: true };
    rerender(<FullscreenControl />);
    expect(
      screen.getByRole("button", { name: en.fullscreen.exit }),
    ).toBeInTheDocument();
    act(() => {
      applyLocale("de");
    });
    expect(
      screen.getByRole("button", { name: de.fullscreen.exit }),
    ).toBeInTheDocument();
  });

  it("draws the glyph in the quiet token colour without opacity (WCAG 1.4.11)", () => {
    render(<FullscreenControl />);
    const button = screen.getByTestId("fullscreen-control");
    expect(button).toHaveClass("text-control-quiet");
    expect(button.className).not.toMatch(/opacity-/);
  });

  it("ignores a short tap (children)", () => {
    render(<FullscreenControl />);
    const button = screen.getByTestId("fullscreen-control");
    fireEvent.pointerDown(button);
    vi.advanceTimersByTime(FULLSCREEN_HOLD_MS - 1);
    fireEvent.pointerUp(button);
    fireEvent.click(button, { detail: 1 });
    vi.advanceTimersByTime(FULLSCREEN_HOLD_MS * 2);
    expect(toggle).not.toHaveBeenCalled();
  });

  it("toggles on pointer-up after a long press", () => {
    render(<FullscreenControl />);
    const button = screen.getByTestId("fullscreen-control");
    fireEvent.pointerDown(button);
    vi.advanceTimersByTime(FULLSCREEN_HOLD_MS);
    expect(toggle).not.toHaveBeenCalled(); // needs the pointer-up gesture
    fireEvent.pointerUp(button);
    fireEvent.click(button, { detail: 1 });
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("cancels the hold when the pointer leaves or is cancelled", () => {
    render(<FullscreenControl />);
    const button = screen.getByTestId("fullscreen-control");
    fireEvent.pointerDown(button);
    vi.advanceTimersByTime(FULLSCREEN_HOLD_MS - 100);
    fireEvent.pointerLeave(button);
    vi.advanceTimersByTime(500);
    fireEvent.pointerUp(button);
    fireEvent.pointerDown(button);
    vi.advanceTimersByTime(FULLSCREEN_HOLD_MS);
    fireEvent.pointerCancel(button);
    fireEvent.pointerUp(button);
    expect(toggle).not.toHaveBeenCalled();
  });

  it("works at once from the keyboard", async () => {
    vi.useRealTimers();
    render(<FullscreenControl />);
    screen.getByTestId("fullscreen-control").focus();
    await userEvent.keyboard("{Enter}");
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("clears the hold timer on unmount", () => {
    const { unmount } = render(<FullscreenControl />);
    fireEvent.pointerDown(screen.getByTestId("fullscreen-control"));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows a filling ring while held, gone when released or cancelled", () => {
    render(<FullscreenControl />);
    const button = screen.getByTestId("fullscreen-control");
    expect(screen.queryByTestId("fullscreen-hold-ring")).toBeNull();
    fireEvent.pointerDown(button);
    const ring = screen.getByTestId("fullscreen-hold-ring");
    expect(ring).toHaveAttribute("aria-hidden", "true");
    expect(button).toHaveAttribute("data-holding", "true");
    const progress = screen.getByTestId("fullscreen-hold-progress");
    // The arc fills over exactly the hold time; reduced motion hides the sweep.
    expect(progress.style.animation).toContain(
      `${String(FULLSCREEN_HOLD_MS)}ms`,
    );
    expect(progress.style.animation).toContain("kb-hold-ring");
    expect(progress).toHaveClass("motion-reduce:hidden");
    fireEvent.pointerLeave(button);
    expect(screen.queryByTestId("fullscreen-hold-ring")).toBeNull();
    fireEvent.pointerDown(button);
    fireEvent.pointerCancel(button);
    expect(screen.queryByTestId("fullscreen-hold-ring")).toBeNull();
    expect(button).toHaveAttribute("data-holding", "false");
  });

  it("shows a short 'press and hold' hint after a tap, then hides it", () => {
    render(<FullscreenControl />);
    const button = screen.getByTestId("fullscreen-control");
    fireEvent.pointerDown(button);
    vi.advanceTimersByTime(150);
    act(() => {
      fireEvent.pointerUp(button);
    });
    const hint = screen.getByTestId("fullscreen-hint");
    expect(hint).toHaveTextContent(en.fullscreen.hint);
    // Not a dialog and not a second name: the button's label already says it.
    expect(hint).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toggle).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(FULLSCREEN_HINT_MS);
    });
    expect(screen.queryByTestId("fullscreen-hint")).toBeNull();
  });

  it("shows no hint after a successful hold, and a new press hides an old hint", () => {
    render(<FullscreenControl />);
    const button = screen.getByTestId("fullscreen-control");
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
    expect(screen.getByTestId("fullscreen-hint")).toBeInTheDocument();
    fireEvent.pointerDown(button);
    expect(screen.queryByTestId("fullscreen-hint")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(FULLSCREEN_HOLD_MS);
    });
    fireEvent.pointerUp(button);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("fullscreen-hint")).toBeNull();
  });

  it("clears the hint timer on unmount", () => {
    const { unmount } = render(<FullscreenControl />);
    const button = screen.getByTestId("fullscreen-control");
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("has the hint in German too", () => {
    expect(de.fullscreen.hint).toBe("Gedrückt halten");
  });
});
