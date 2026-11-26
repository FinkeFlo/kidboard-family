import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApiClient } from "../data/apiClient";
import { ApiClientContext } from "../data/apiContext";
import {
  createFakeFetch,
  type FakeFetch,
  TEST_TOKEN,
} from "../data/testing.test-utils";
import { applyLocale } from "../i18n";
import de from "../i18n/locales/de.json";
import en from "../i18n/locales/en.json";
import { EditorScreen } from "./EditorScreen";
import { fakeGate, renderWithGate } from "./gate.test-utils";
import { IdleWarning } from "./IdleWarning";
import { PARENT_HOLD_MS, ParentEntry } from "./ParentEntry";
import {
  PARENT_IDLE_LOCK_MS,
  PARENT_IDLE_WARNING_MS,
  ParentGateContext,
  useParentGate,
} from "./parentGate";
import { ParentGateProvider } from "./ParentGateProvider";
import { PinPad } from "./PinPad";

const T0 = Date.parse("2026-11-22T11:00:00Z");

let fake: FakeFetch;

/** The pencil and, while open, the PIN pad, with the real gate provider. */
function Gate(): React.JSX.Element {
  const { stage } = useParentGate();
  return (
    <>
      <ParentEntry />
      {stage === "pin" && <PinPad />}
    </>
  );
}

function renderGate(): void {
  const api = createApiClient({ fetch: fake.fetch, token: TEST_TOKEN });
  render(
    <ApiClientContext value={api}>
      <ParentGateProvider>
        <Gate />
      </ParentGateProvider>
    </ApiClientContext>,
  );
}

function pencil(): HTMLElement {
  return screen.getByRole("button", { name: en.parent.entry });
}

function holdKey(key: string): void {
  const button = pencil();
  button.focus();
  fireEvent.keyDown(button, { key });
  act(() => {
    vi.advanceTimersByTime(PARENT_HOLD_MS);
  });
  fireEvent.keyUp(document.activeElement ?? document.body, { key });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  fake = createFakeFetch();
});
afterEach(() => {
  vi.useRealTimers();
  applyLocale("en");
});

describe("parent gate flow (provider, pencil, PIN pad)", () => {
  it.each([
    ["Enter", "Enter"],
    ["Space", " "],
  ])(
    "opens with a held %s and Escape returns the focus to the pencil",
    (_, key) => {
      renderGate();
      holdKey(key);
      const pad = screen.getByTestId("pin-pad");
      expect(pad).toHaveFocus();
      fireEvent.keyDown(pad, { key: "Escape" });
      expect(screen.queryByTestId("pin-pad")).toBeNull();
      expect(pencil()).toHaveFocus();
    },
  );

  it("after a wrong PIN typed on the keyboard, keeps typing and Escape still closes", async () => {
    fake.setReplies("/api/parent/unlock", {
      status: 403,
      body: { error: "wrong_pin", attemptsLeft: 3 },
    });
    renderGate();
    holdKey("Enter");
    for (const digit of "000000") {
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: digit,
      });
    }
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: "Enter",
      });
      await vi.runOnlyPendingTimersAsync();
    });
    expect(screen.getByTestId("pin-feedback")).toHaveTextContent(
      "Wrong PIN. 3 more tries.",
    );
    expect(screen.getByTestId("pin-dots")).toHaveAttribute("data-count", "0");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "4" });
    expect(screen.getByTestId("pin-dots")).toHaveAttribute("data-count", "1");
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(screen.queryByTestId("pin-pad")).toBeNull();
    expect(pencil()).toHaveFocus();
  });

  it("shows the idle warning on the open pad and Keep editing restarts the time", () => {
    renderGate();
    holdKey("Enter");
    expect(screen.queryByTestId("idle-warning")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(PARENT_IDLE_LOCK_MS - PARENT_IDLE_WARNING_MS);
    });
    const warning = screen.getByTestId("idle-warning");
    expect(warning).toHaveTextContent(en.parent.idle.title);
    expect(screen.getByTestId("idle-warning-region")).toHaveAttribute(
      "aria-live",
      "assertive",
    );
    fireEvent.click(screen.getByRole("button", { name: en.parent.idle.stay }));
    expect(screen.queryByTestId("idle-warning")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(PARENT_IDLE_LOCK_MS - 1000);
    });
    expect(screen.getByTestId("pin-pad")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByTestId("pin-pad")).toBeNull();
  });
});

describe("IdleWarning", () => {
  it("renders only the empty live region without a warning", () => {
    renderWithGate(<IdleWarning />, fakeGate({ stage: "editor" }));
    expect(screen.getByTestId("idle-warning-region")).toBeEmptyDOMElement();
  });

  it("is a calm banner with a large Keep editing button, translated", () => {
    const gate = fakeGate({
      stage: "editor",
      idleWarning: true,
      idleSecondsLeft: 30,
    });
    renderWithGate(<IdleWarning />, gate);
    expect(screen.getByTestId("idle-warning")).toHaveTextContent(
      "Without input the parent area locks in 30 seconds.",
    );
    expect(screen.getByTestId("idle-warning").innerHTML).not.toMatch(
      /animate-/,
    );
    const button = screen.getByRole("button", { name: en.parent.idle.stay });
    expect(button).toHaveClass("min-h-touch");
    fireEvent.click(button);
    expect(gate.stayActive).toHaveBeenCalledTimes(1);
    act(() => {
      applyLocale("de");
    });
    expect(screen.getByTestId("idle-warning")).toHaveTextContent(
      de.parent.idle.title,
    );
    expect(
      screen.getByRole("button", { name: de.parent.idle.stay }),
    ).toBeInTheDocument();
  });

  it("counts the real seconds down visibly but announces one static sentence", () => {
    const gate = fakeGate({
      stage: "editor",
      idleWarning: true,
      idleSecondsLeft: 30,
    });
    const { rerender } = renderWithGate(<IdleWarning />, gate);
    const countdown = (): HTMLElement => {
      const element = screen
        .getByTestId("idle-warning")
        .querySelector<HTMLElement>("[aria-hidden='true']");
      if (element === null) throw new Error("no visible countdown");
      return element;
    };
    const announced = (): string =>
      screen.getByTestId("idle-warning").querySelector(".sr-only")
        ?.textContent ?? "";
    const before = announced();
    expect(before).toBe(
      "Locking soon. Without input the parent area locks in about 30 seconds. Choose Keep editing to stay.",
    );
    expect(countdown()).toHaveTextContent("in 30 seconds");
    rerender(
      <ParentGateContext value={{ ...gate, idleSecondsLeft: 1 }}>
        <IdleWarning />
      </ParentGateContext>,
    );
    expect(countdown()).toHaveTextContent("in 1 second.");
    // The announced sentence did not change, so the live region says nothing new.
    expect(announced()).toBe(before);
    // The ticking text is hidden from assistive tech.
    expect(countdown()).toHaveAttribute("aria-hidden", "true");
  });

  it("returns the focus to where it was when the warning goes away", () => {
    const gate = fakeGate({
      stage: "editor",
      idleWarning: true,
      idleSecondsLeft: 20,
    });
    const view = (g: typeof gate): React.JSX.Element => (
      <ParentGateContext value={g}>
        <div role="dialog" aria-label="host" tabIndex={-1}>
          <input aria-label="name" />
          <IdleWarning />
        </div>
      </ParentGateContext>
    );
    const { rerender } = render(view(gate));
    const input = screen.getByRole("textbox", { name: "name" });
    input.focus();
    // The button takes the focus when pressed, then the banner is gone (any input
    // restarts the idle time).
    screen.getByRole("button", { name: en.parent.idle.stay }).focus();
    rerender(view({ ...gate, idleWarning: false, idleSecondsLeft: 0 }));
    expect(input).toHaveFocus();
  });

  it("falls back to the dialog around the banner when nothing had the focus", () => {
    const gate = fakeGate({
      stage: "editor",
      idleWarning: true,
      idleSecondsLeft: 20,
    });
    const view = (g: typeof gate): React.JSX.Element => (
      <ParentGateContext value={g}>
        <div role="dialog" aria-label="host" tabIndex={-1}>
          <IdleWarning />
        </div>
      </ParentGateContext>
    );
    const { rerender } = render(view(gate));
    screen.getByRole("button", { name: en.parent.idle.stay }).focus();
    rerender(view({ ...gate, idleWarning: false, idleSecondsLeft: 0 }));
    expect(screen.getByRole("dialog", { name: "host" })).toHaveFocus();
  });

  it("leaves the focus alone when it moved elsewhere on its own", () => {
    const gate = fakeGate({
      stage: "editor",
      idleWarning: true,
      idleSecondsLeft: 20,
    });
    const view = (g: typeof gate): React.JSX.Element => (
      <ParentGateContext value={g}>
        <div role="dialog" aria-label="host" tabIndex={-1}>
          <input aria-label="first" />
          <input aria-label="second" />
          <IdleWarning />
        </div>
      </ParentGateContext>
    );
    const { rerender } = render(view(gate));
    screen.getByRole("textbox", { name: "first" }).focus();
    screen.getByRole("textbox", { name: "second" }).focus();
    rerender(view({ ...gate, idleWarning: false, idleSecondsLeft: 0 }));
    expect(screen.getByRole("textbox", { name: "second" })).toHaveFocus();
  });
});

describe("one idle banner at a time", () => {
  it("the editor screen drops its banner while a re-lock PIN pad is open, and the pad's sits beside its card", () => {
    const gate = fakeGate({
      stage: "editor",
      idleWarning: true,
      idleSecondsLeft: 12,
    });
    const { rerender } = renderWithGate(
      <EditorScreen>
        <p>{"form"}</p>
      </EditorScreen>,
      gate,
    );
    expect(screen.getAllByTestId("idle-warning")).toHaveLength(1);
    expect(
      screen.getByRole("dialog", { name: en.parent.editor.title }),
    ).toContainElement(screen.getByTestId("idle-warning"));
    rerender(
      <ParentGateContext value={gate}>
        <EditorScreen>
          <PinPad />
        </EditorScreen>
      </ParentGateContext>,
    );
    const banners = screen.getAllByTestId("idle-warning");
    expect(banners).toHaveLength(1);
    const pad = screen.getByTestId("pin-pad");
    expect(pad).toContainElement(banners[0] as HTMLElement);
    // In the flow of the pad, not fixed over its buttons.
    expect(banners[0]).not.toHaveClass("fixed");
    const cancel = screen.getByRole("button", { name: en.parent.pin.cancel });
    expect(banners[0]).not.toContainElement(cancel);

    // Closing the pad brings the editor's own banner back.
    rerender(
      <ParentGateContext value={gate}>
        <EditorScreen>
          <p>{"form"}</p>
        </EditorScreen>
      </ParentGateContext>,
    );
    expect(screen.getAllByTestId("idle-warning")).toHaveLength(1);
    expect(screen.getByTestId("idle-warning")).toHaveClass("fixed");
  });
});
