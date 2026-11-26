import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Board } from "../board/Board";
import { createApiClient } from "../data/apiClient";
import { createQueryClient } from "../data/queryClient";
import {
  agendaFixture,
  configFixture,
  createFakeFetch,
  createMemoryStorage,
  dataWrapper,
  TEST_TOKEN,
} from "../data/testing.test-utils";
import en from "../i18n/locales/en.json";
import {
  AppErrorBoundary,
  AUTO_RESET_BASE_MS,
  AUTO_RESET_MAX_MS,
  AUTO_RESET_STABLE_MS,
} from "./AppErrorBoundary";

let shouldThrow = true;

function Bomb(): React.JSX.Element {
  if (shouldThrow) {
    throw new Error("boom <b>not html</b>");
  }
  return <p>recovered</p>;
}

describe("AppErrorBoundary", () => {
  beforeEach(() => {
    shouldThrow = true;
    // React logs caught errors; keep the test output clean.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children when nothing throws", () => {
    shouldThrow = false;
    render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    );
    expect(screen.getByText("recovered")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the friendly error card: 🧸, title, parent line, retry and a short code", () => {
    render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    );
    const card = screen.getByRole("alert");
    expect(card).toHaveAttribute("data-variant", "error");
    expect(card).toHaveTextContent("🧸");
    expect(
      screen.getByRole("heading", { name: en.error.title }),
    ).toBeInTheDocument();
    expect(card).toHaveTextContent(en.error.hint);
    expect(screen.getByTestId("error-code")).toHaveTextContent(
      "Error code for parents: KB-UI",
    );
    // A child-sized target (>= 64px via the touch token).
    expect(screen.getByRole("button", { name: en.error.retry })).toHaveClass(
      "min-h-touch",
      "min-w-touch",
    );
  });

  it("never shows the raw error message, and no fixed retry seconds", () => {
    render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    );
    const card = screen.getByRole("alert");
    expect(card).not.toHaveTextContent("boom");
    expect(card).not.toHaveTextContent("not html");
    expect(card.textContent).not.toMatch(/\d+\s*(s|sec|seconds|Sekunden)\b/u);
  });

  it("retries rendering when the button is pressed", async () => {
    render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    );
    shouldThrow = false;
    await userEvent.click(screen.getByRole("button", { name: en.error.retry }));
    expect(screen.getByText("recovered")).toBeInTheDocument();
  });
});

describe("AppErrorBoundary auto reset", () => {
  beforeEach(() => {
    shouldThrow = true;
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Advances time and lets React flush the reset. */
  function advance(ms: number): void {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  it("recovers by itself after the base delay", () => {
    render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    shouldThrow = false;
    advance(AUTO_RESET_BASE_MS - 1);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    advance(1);
    expect(screen.getByText("recovered")).toBeInTheDocument();
  });

  it("remounts into the day view when the failure was transient", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(Date.parse("2026-11-22T12:00:00+01:00"));
    const fake = createFakeFetch();
    fake.setReplies("/api/config", { status: 200, body: configFixture() });
    fake.setReplies("/api/agenda", { status: 200, body: agendaFixture() });
    const Wrapper = dataWrapper(
      createApiClient({ fetch: fake.fetch, token: TEST_TOKEN }),
      createQueryClient({ retry: false }),
      createMemoryStorage(),
    );
    function Flaky(): React.JSX.Element {
      if (shouldThrow) throw new Error("transient");
      return <Board />;
    }
    render(
      <AppErrorBoundary>
        <Wrapper>
          <Flaky />
        </Wrapper>
      </AppErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    shouldThrow = false;
    advance(AUTO_RESET_BASE_MS);
    expect(screen.queryByTestId("error-fallback")).not.toBeInTheDocument();
    // Real timers for `findBy*`, but the clock stays on the fixture day, so the test
    // does not depend on the real date (it failed after midnight in Berlin).
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-11-22T12:00:00+01:00"));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Sunday" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Swimming")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("doubles the delay per failed retry and caps it", () => {
    render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    );
    // Still failing: 5s, 10s, 20s, ... until the cap.
    let delay = AUTO_RESET_BASE_MS;
    const seen: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      advance(delay - 1);
      expect(screen.getByTestId("error-fallback")).toBeInTheDocument();
      const before = vi.getTimerCount();
      advance(1); // reset fires, Bomb throws again, new fallback + timer
      expect(before).toBe(1);
      expect(vi.getTimerCount()).toBe(1);
      seen.push(delay);
      delay = Math.min(delay * 2, AUTO_RESET_MAX_MS);
    }
    expect(seen.slice(0, 3)).toEqual([5_000, 10_000, 20_000]);
    expect(Math.max(...seen)).toBe(AUTO_RESET_MAX_MS);
    // At the cap the delay stays at the cap.
    advance(AUTO_RESET_MAX_MS - 1);
    expect(screen.getByTestId("error-fallback")).toBeInTheDocument();
    shouldThrow = false;
    advance(1);
    expect(screen.getByText("recovered")).toBeInTheDocument();
  });

  it("starts over at the base delay after a stable period", () => {
    let failOnMount = true;
    const handle: { breakNow?: () => void } = {};
    function Flaky(): React.JSX.Element {
      const [broken, setBroken] = useState(false);
      useEffect(() => {
        handle.breakNow = () => {
          setBroken(true);
        };
      }, []);
      if (failOnMount || broken) throw new Error("flaky");
      return <p>recovered</p>;
    }
    render(
      <AppErrorBoundary>
        <Flaky />
      </AppErrorBoundary>,
    );
    advance(AUTO_RESET_BASE_MS); // retry 1 fails again: next delay is doubled
    failOnMount = false;
    advance(AUTO_RESET_BASE_MS * 2);
    expect(screen.getByText("recovered")).toBeInTheDocument();
    // Stable for the whole period, then it breaks again.
    advance(AUTO_RESET_STABLE_MS);
    act(() => {
      handle.breakNow?.();
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    advance(AUTO_RESET_BASE_MS - 1);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    advance(1); // base delay, not 4x
    expect(screen.getByText("recovered")).toBeInTheDocument();
  });

  it("announces an incident once, not on every failed automatic retry", () => {
    render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBe(
      screen.getByTestId("error-fallback"),
    );
    advance(AUTO_RESET_BASE_MS); // retry fails: a fresh fallback, but silent
    expect(screen.getByTestId("error-fallback")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Still the main landmark with the friendly text for anyone who looks.
    expect(screen.getByRole("main")).toHaveTextContent(en.error.title);
    advance(AUTO_RESET_BASE_MS * 2); // and stays silent on the next one
    expect(screen.getByTestId("error-fallback")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps announcing the fallback while it stays up (re-renders do not silence it)", () => {
    const { rerender } = render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    );
    rerender(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    );
    advance(AUTO_RESET_BASE_MS - 1);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("clears the timer on unmount", () => {
    const { unmount } = render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    );
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the manual retry button working and cancels the pending timer", () => {
    render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    );
    shouldThrow = false;
    const retry = screen.getByRole("button", { name: en.error.retry });
    act(() => {
      retry.click();
    });
    expect(screen.getByText("recovered")).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });
});
