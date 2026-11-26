import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyLocale } from "../i18n";
import de from "../i18n/locales/de.json";
import en from "../i18n/locales/en.json";
import { fakeGate, renderWithGate } from "./gate.test-utils";
import {
  type ParentGate,
  ParentGateContext,
  type UnlockOutcome,
} from "./parentGate";
import { DEMO_PIN, lockoutMinutesLeft, PinPad } from "./PinPad";

const T0 = Date.parse("2026-11-22T11:00:00Z");

function key(name: string): HTMLElement {
  return within(screen.getByTestId("pin-pad")).getByRole("button", { name });
}

function type(pin: string): void {
  for (const digit of pin) fireEvent.click(key(digit));
}

function dots(): HTMLElement {
  return screen.getByTestId("pin-dots");
}

async function submitWith(
  gate: ParentGate,
  outcome: UnlockOutcome,
): Promise<void> {
  vi.mocked(gate.unlock).mockResolvedValueOnce(outcome);
  await act(async () => {
    fireEvent.click(key(en.parent.pin.submit));
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  applyLocale("en");
});

describe("lockoutMinutesLeft", () => {
  it.each([
    [null, null],
    [T0, null],
    [T0 - 1, null],
    [T0 + 1, 1],
    [T0 + 60_000, 1],
    [T0 + 60_001, 2],
    [T0 + 900_000, 15],
  ])("until %s → %s", (until, minutes) => {
    expect(lockoutMinutesLeft(until, T0)).toBe(minutes);
  });
});

describe("PinPad", () => {
  it("is a labelled modal dialog with focus inside and 64 px keys", () => {
    renderWithGate(<PinPad />, fakeGate({ stage: "pin" }));
    const dialog = screen.getByRole("dialog", { name: en.parent.pin.title });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveFocus();
    for (const name of [
      ...Array.from({ length: 10 }, (_, digit) => String(digit)),
      en.parent.pin.erase,
      en.parent.pin.submit,
      en.parent.pin.cancel,
    ]) {
      expect(key(name)).toHaveClass("min-h-touch");
    }
  });

  it("shows no demo PIN outside the demo build", () => {
    expect(DEMO_PIN).toBeNull();
    renderWithGate(<PinPad />, fakeGate({ stage: "pin" }));
    expect(screen.queryByTestId("demo-pin")).toBeNull();
  });

  it("masks the digits: only dots and their count, never the PIN", () => {
    renderWithGate(<PinPad />, fakeGate({ stage: "pin" }));
    type("314159");
    expect(dots()).toHaveAttribute("data-count", "6");
    expect(dots()).toHaveAccessibleName("6 digits entered");
    expect(screen.getByTestId("pin-pad")).not.toHaveTextContent("314159");
    expect(dots()).toHaveTextContent("");
  });

  it("enables OK from 6 digits, caps at 12 and erases the last digit", () => {
    renderWithGate(<PinPad />, fakeGate({ stage: "pin" }));
    expect(key(en.parent.pin.erase)).toBeDisabled();
    type("12345");
    expect(key(en.parent.pin.submit)).toBeDisabled();
    type("6");
    expect(key(en.parent.pin.submit)).toBeEnabled();
    type("7890123");
    expect(dots()).toHaveAttribute("data-count", "12");
    fireEvent.click(key(en.parent.pin.erase));
    expect(dots()).toHaveAttribute("data-count", "11");
  });

  it("sends the typed PIN", async () => {
    const gate = fakeGate({ stage: "pin" });
    renderWithGate(<PinPad />, gate);
    type("2468024");
    await submitWith(gate, { kind: "unlocked" });
    expect(gate.unlock).toHaveBeenCalledWith("2468024");
  });

  it("clears a wrong PIN, says how many tries are left and shakes only with motion allowed", async () => {
    const gate = fakeGate({ stage: "pin" });
    renderWithGate(<PinPad />, gate);
    type("000000");
    await submitWith(gate, { kind: "wrong-pin", attemptsLeft: 1 });
    expect(dots()).toHaveAttribute("data-count", "0");
    const feedback = screen.getByTestId("pin-feedback");
    expect(feedback).toHaveTextContent("Wrong PIN. 1 more try.");
    expect(feedback).toHaveAttribute("aria-live", "polite");
    expect(feedback).toHaveClass("text-danger");
    const row = screen.getByTestId("pin-dots-row");
    expect(row.className).toMatch(/^motion-safe:animate-\[kb-shake/);
    expect(row.className).not.toMatch(/(^|\s)animate-/);

    type("000000");
    await submitWith(gate, { kind: "wrong-pin", attemptsLeft: 3 });
    expect(feedback).toHaveTextContent("Wrong PIN. 3 more tries.");
  });

  it("shows the lockout with the minutes left and disables the keypad until it ends", () => {
    const gate = fakeGate({ stage: "pin", lockoutUntil: T0 + 14 * 60_000 + 1 });
    renderWithGate(<PinPad />, gate);
    expect(screen.getByTestId("pin-feedback")).toHaveTextContent(
      "Too many wrong PINs. Try again in 15 minutes.",
    );
    expect(key("5")).toBeDisabled();
    expect(key(en.parent.pin.submit)).toBeDisabled();
    // Cancel stays usable.
    expect(key(en.parent.pin.cancel)).toBeEnabled();
    fireEvent.keyDown(screen.getByTestId("pin-pad"), { key: "5" });
    expect(dots()).toHaveAttribute("data-count", "0");

    act(() => {
      vi.advanceTimersByTime(14 * 60_000);
    });
    expect(screen.getByTestId("pin-feedback")).toHaveTextContent(
      "Try again in 1 minute.",
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId("pin-feedback")).toBeEmptyDOMElement();
    expect(key("5")).toBeEnabled();
  });

  it("shows the lockout right after the answer that started it", async () => {
    let gate = fakeGate({ stage: "pin" });
    const { rerender } = renderWithGate(<PinPad />, gate);
    type("111111");
    // A minute passes on the pad before the lockout answer arrives.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    const until = T0 + 60_000 + 900_000;
    await submitWith(gate, { kind: "lockout", until });
    // The provider sets `lockoutUntil` along with the answer.
    gate = { ...gate, lockoutUntil: until };
    rerender(
      <ParentGateContext value={gate}>
        <PinPad />
      </ParentGateContext>,
    );
    expect(dots()).toHaveAttribute("data-count", "0");
    // Counted from the answer, not from when the pad opened (that would say 16).
    expect(screen.getByTestId("pin-feedback")).toHaveTextContent(
      "Try again in 15 minutes.",
    );
    expect(key("1")).toBeDisabled();
  });

  it.each([
    ["unauthorized", en.parent.pin.error.unauthorized],
    ["unavailable", en.parent.pin.error.unavailable],
    ["failed", en.parent.pin.error.failed],
  ] as const)(
    "explains the error %s and keeps the PIN for a retry",
    async (error, text) => {
      const gate = fakeGate({ stage: "pin" });
      renderWithGate(<PinPad />, gate);
      type("123456");
      await submitWith(gate, { kind: "error", error });
      expect(screen.getByTestId("pin-feedback")).toHaveTextContent(text);
      expect(dots()).toHaveAttribute("data-count", "6");
    },
  );

  it("takes digits, Backspace, Enter and Escape from a keyboard; ignores key repeats", async () => {
    const gate = fakeGate({ stage: "pin" });
    renderWithGate(<PinPad />, gate);
    const dialog = screen.getByTestId("pin-pad");
    // The Enter held to open the gate keeps repeating: nothing happens.
    fireEvent.keyDown(dialog, { key: "Enter", repeat: true });
    fireEvent.keyDown(dialog, { key: "7", repeat: true });
    expect(dots()).toHaveAttribute("data-count", "0");
    for (const digit of "1234567") fireEvent.keyDown(dialog, { key: digit });
    fireEvent.keyDown(dialog, { key: "Backspace" });
    expect(dots()).toHaveAttribute("data-count", "6");
    vi.mocked(gate.unlock).mockResolvedValueOnce({ kind: "unlocked" });
    await act(async () => {
      fireEvent.keyDown(dialog, { key: "Enter" });
      await Promise.resolve();
    });
    expect(gate.unlock).toHaveBeenCalledWith("123456");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(gate.close).toHaveBeenCalledTimes(1);
  });

  it("keeps taking keys after a wrong PIN, even when the focus fell out of the pad", async () => {
    const gate = fakeGate({ stage: "pin" });
    renderWithGate(<PinPad />, gate);
    type("000000");
    key(en.parent.pin.submit).focus();
    await submitWith(gate, { kind: "wrong-pin", attemptsLeft: 4 });
    // The answer takes the focus back into the pad if it was lost.
    expect(screen.getByTestId("pin-pad")).toContainElement(
      document.activeElement as HTMLElement,
    );

    // A key button disabled during the check drops the focus to <body>.
    (document.activeElement as HTMLElement).blur();
    expect(document.body).toHaveFocus();
    for (const digit of "2468")
      fireEvent.keyDown(document.body, { key: digit });
    fireEvent.keyDown(document.body, { key: "Backspace" });
    expect(dots()).toHaveAttribute("data-count", "3");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(gate.close).toHaveBeenCalledTimes(1);
  });

  it("returns the focus into the pad after a wrong PIN sent with a mouse", async () => {
    const gate = fakeGate({ stage: "pin" });
    renderWithGate(<PinPad />, gate);
    type("000000");
    vi.mocked(gate.unlock).mockResolvedValueOnce({
      kind: "wrong-pin",
      attemptsLeft: 4,
    });
    await act(async () => {
      fireEvent.click(key(en.parent.pin.submit));
      // What a browser does when the focused OK button gets disabled.
      (document.activeElement as HTMLElement | null)?.blur();
      await Promise.resolve();
    });
    expect(screen.getByTestId("pin-pad")).toHaveFocus();
  });

  it("submits with Enter while a digit key has the focus instead of pressing it again", async () => {
    const gate = fakeGate({ stage: "pin" });
    renderWithGate(<PinPad />, gate);
    type("12345");
    const five = key("5");
    five.focus();
    // Too short: Enter neither presses the key nor submits.
    expect(fireEvent.keyDown(five, { key: "Enter" })).toBe(false);
    expect(dots()).toHaveAttribute("data-count", "5");
    expect(gate.unlock).not.toHaveBeenCalled();

    fireEvent.click(five);
    vi.mocked(gate.unlock).mockResolvedValueOnce({ kind: "unlocked" });
    let notPrevented = true;
    await act(async () => {
      notPrevented = fireEvent.keyDown(five, { key: "Enter" });
      await Promise.resolve();
    });
    // Prevented: the browser does not click the focused key.
    expect(notPrevented).toBe(false);
    expect(gate.unlock).toHaveBeenCalledWith("123455");
  });

  it("leaves Enter on OK, erase and Cancel to the buttons themselves", () => {
    const gate = fakeGate({ stage: "pin" });
    renderWithGate(<PinPad />, gate);
    type("123456");
    for (const name of [
      en.parent.pin.submit,
      en.parent.pin.erase,
      en.parent.pin.cancel,
    ]) {
      expect(fireEvent.keyDown(key(name), { key: "Enter" }), name).toBe(true);
    }
    expect(gate.unlock).not.toHaveBeenCalled();
  });

  it("takes at most 12 digits: the digit keys disable and 12 smaller dots fit", () => {
    renderWithGate(<PinPad />, fakeGate({ stage: "pin" }));
    expect(dots()).toHaveAttribute("data-compact", "false");
    for (const digit of "123456789012345") {
      fireEvent.keyDown(document.body, { key: digit });
    }
    expect(dots()).toHaveAttribute("data-count", "12");
    expect(dots()).toHaveAttribute("data-compact", "true");
    expect(dots().children).toHaveLength(12);
    expect(dots()).toHaveClass("flex-wrap", "max-w-full");
    for (const digit of "0123456789") expect(key(digit)).toBeDisabled();
    expect(key(en.parent.pin.erase)).toBeEnabled();
    expect(key(en.parent.pin.submit)).toBeEnabled();
    fireEvent.click(key(en.parent.pin.erase));
    expect(key("7")).toBeEnabled();
  });

  it("ignores keys with Ctrl, Alt or Meta (browser shortcuts)", () => {
    renderWithGate(<PinPad />, fakeGate({ stage: "pin" }));
    fireEvent.keyDown(document.body, { key: "1", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "2", altKey: true });
    fireEvent.keyDown(document.body, { key: "3", metaKey: true });
    expect(dots()).toHaveAttribute("data-count", "0");
  });

  it("stops listening to the keyboard once closed", () => {
    const { unmount } = renderWithGate(<PinPad />, fakeGate({ stage: "pin" }));
    unmount();
    const spy = vi.spyOn(Event.prototype, "preventDefault");
    fireEvent.keyDown(document.body, { key: "1" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("cancels back to the board", () => {
    const gate = fakeGate({ stage: "pin" });
    renderWithGate(<PinPad />, gate);
    fireEvent.click(key(en.parent.pin.cancel));
    expect(gate.close).toHaveBeenCalledTimes(1);
  });

  it("is translated", () => {
    renderWithGate(<PinPad />, fakeGate({ stage: "pin" }));
    act(() => {
      applyLocale("de");
    });
    expect(
      screen.getByRole("dialog", { name: de.parent.pin.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(de.parent.pin.prompt)).toBeInTheDocument();
    expect(key(de.parent.pin.cancel)).toBeInTheDocument();
  });
});
