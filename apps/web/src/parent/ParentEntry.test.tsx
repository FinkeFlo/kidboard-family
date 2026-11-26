import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyLocale } from "../i18n";
import de from "../i18n/locales/de.json";
import en from "../i18n/locales/en.json";
import { fakeGate, renderWithGate } from "./gate.test-utils";
import {
  PARENT_HOLD_MS,
  PARENT_RING_DELAY_MS,
  ParentEntry,
} from "./ParentEntry";
import type { ParentGate } from "./parentGate";

let gate: ParentGate;
let unmount: () => void;

function entry(): HTMLElement {
  return screen.getByRole("button", { name: en.parent.entry });
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  gate = fakeGate();
  ({ unmount } = renderWithGate(<ParentEntry />, gate));
});
afterEach(() => {
  vi.useRealTimers();
  applyLocale("en");
});

describe("ParentEntry", () => {
  it("is a quiet, full-size touch target with a translated name", () => {
    const button = entry();
    expect(button).toHaveClass(
      "min-h-touch",
      "min-w-touch",
      "text-control-quiet",
    );
    expect(button.className).not.toMatch(/opacity-/);
    act(() => {
      applyLocale("de");
    });
    expect(
      screen.getByRole("button", { name: de.parent.entry }),
    ).toBeInTheDocument();
  });

  it("does nothing visible on a short tap", () => {
    const button = entry();
    fireEvent.pointerDown(button, { button: 0 });
    advance(PARENT_RING_DELAY_MS - 1);
    expect(screen.queryByTestId("parent-hold-ring")).toBeNull();
    fireEvent.pointerUp(button);
    fireEvent.click(button, { detail: 1 });
    advance(PARENT_HOLD_MS * 2);
    expect(screen.queryByTestId("parent-hold-ring")).toBeNull();
    expect(button).toHaveAttribute("data-holding", "false");
    expect(gate.openPin).not.toHaveBeenCalled();
  });

  it("opens the PIN pad after a 2 s hold, with a ring filling meanwhile", () => {
    const button = entry();
    fireEvent.pointerDown(button, { button: 0 });
    advance(PARENT_RING_DELAY_MS);
    const progress = screen.getByTestId("parent-hold-progress");
    expect(progress.style.animation).toContain(
      `${String(PARENT_HOLD_MS - PARENT_RING_DELAY_MS)}ms`,
    );
    // Reduced motion: no sweeping arc, only the static track.
    expect(progress).toHaveClass("motion-reduce:hidden");
    advance(PARENT_HOLD_MS - PARENT_RING_DELAY_MS - 1);
    expect(gate.openPin).not.toHaveBeenCalled();
    advance(1);
    expect(gate.openPin).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("parent-hold-ring")).toBeNull();
  });

  it("cancels the hold when the pointer is released, leaves or is cancelled", () => {
    const button = entry();
    for (const end of [
      fireEvent.pointerUp,
      fireEvent.pointerLeave,
      fireEvent.pointerCancel,
    ]) {
      fireEvent.pointerDown(button, { button: 0 });
      advance(PARENT_HOLD_MS - 100);
      end(button);
      advance(PARENT_HOLD_MS);
    }
    expect(gate.openPin).not.toHaveBeenCalled();
  });

  it("ignores secondary mouse buttons and the context menu of a long press", () => {
    const button = entry();
    fireEvent.pointerDown(button, { button: 2 });
    advance(PARENT_HOLD_MS);
    expect(gate.openPin).not.toHaveBeenCalled();
    expect(fireEvent.contextMenu(button)).toBe(false);
  });

  it.each([
    ["Enter", "Enter"],
    ["Space", " "],
  ])(
    "opens after %s is held 2 s; key repeats do not restart the hold",
    (_, key) => {
      const button = entry();
      button.focus();
      expect(fireEvent.keyDown(button, { key })).toBe(false);
      advance(1000);
      fireEvent.keyDown(button, { key, repeat: true });
      advance(PARENT_HOLD_MS - 1001);
      expect(gate.openPin).not.toHaveBeenCalled();
      advance(1);
      expect(gate.openPin).toHaveBeenCalledTimes(1);
    },
  );

  it("does not open on a short Enter or Space, a keyboard click or blur mid-hold", () => {
    const button = entry();
    button.focus();
    fireEvent.keyDown(button, { key: "Enter" });
    advance(PARENT_HOLD_MS - 1);
    fireEvent.keyUp(button, { key: "Enter" });
    advance(PARENT_HOLD_MS);
    fireEvent.keyDown(button, { key: " " });
    advance(PARENT_HOLD_MS - 1);
    // Space is released before the 2 s: no click either.
    expect(fireEvent.keyUp(button, { key: " " })).toBe(false);
    advance(PARENT_HOLD_MS);
    // Assistive tech / keyboard activation is a click with detail 0.
    fireEvent.click(button, { detail: 0 });
    fireEvent.keyDown(button, { key: "Enter" });
    advance(1000);
    fireEvent.blur(button);
    advance(PARENT_HOLD_MS);
    expect(gate.openPin).not.toHaveBeenCalled();
  });

  it("clears its timers on unmount", () => {
    fireEvent.pointerDown(entry(), { button: 0 });
    expect(vi.getTimerCount()).toBe(2);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
