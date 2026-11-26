import type { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MIA } from "../components/fixtures.test-utils";
import { createApiClient } from "../data/apiClient";
import { createQueryClient } from "../data/queryClient";
import {
  agendaFixture,
  configFixture,
  createFakeFetch,
  createMemoryStorage,
  dataWrapper,
  type FakeFetch,
  TEST_TOKEN,
} from "../data/testing.test-utils";
import en from "../i18n/locales/en.json";
import { ParentGateProvider, ParentLayer } from "../parent";
import { PARENT_HOLD_MS } from "../parent/ParentEntry";
import { PARENT_IDLE_LOCK_MS } from "../parent/parentGate";
import { Board } from "./Board";

let fake: FakeFetch;
let clients: QueryClient[] = [];

function renderBoard(): void {
  const client = createQueryClient({ retry: false });
  clients.push(client);
  const Wrapper = dataWrapper(
    createApiClient({ fetch: fake.fetch, token: TEST_TOKEN }),
    client,
    createMemoryStorage(),
  );
  render(
    <Wrapper>
      <ParentGateProvider>
        <Board />
        <ParentLayer />
      </ParentGateProvider>
    </Wrapper>,
  );
}

function entry(): HTMLElement | null {
  return screen.queryByRole("button", { name: en.parent.entry });
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "Date",
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
    ],
  });
  vi.setSystemTime(Date.parse("2026-11-22T12:00:00+01:00"));
  fake = createFakeFetch();
  fake.setReplies("/api/agenda", { status: 200, body: agendaFixture() });
});

afterEach(() => {
  clients.forEach((client) => {
    client.clear();
  });
  clients = [];
  vi.useRealTimers();
});

async function ready(): Promise<void> {
  await vi.waitFor(() => {
    expect(screen.getAllByTestId("day-column")).toHaveLength(4);
  });
}

describe("Board with the parent gate (ADR-0013)", () => {
  it("has no parent entry when the editor is off", async () => {
    fake.setReplies("/api/config", {
      status: 200,
      body: configFixture({ children: [MIA] }),
    });
    renderBoard();
    await ready();
    expect(entry()).toBeNull();
  });

  it("shows the entry in the rail when the editor is on; holding it opens the PIN pad", async () => {
    fake.setReplies("/api/config", {
      status: 200,
      body: { ...configFixture({ children: [MIA] }), editor: true },
    });
    renderBoard();
    await ready();
    const button = entry();
    expect(button).not.toBeNull();
    if (button === null) return;
    expect(screen.getByTestId("nav-rail")).toContainElement(button);
    fireEvent.pointerDown(button, { button: 0 });
    act(() => {
      vi.advanceTimersByTime(PARENT_HOLD_MS);
    });
    expect(
      screen.getByRole("dialog", { name: en.parent.pin.title }),
    ).toBeInTheDocument();
  });

  function openWithEnter(button: HTMLElement): void {
    button.focus();
    fireEvent.keyDown(button, { key: "Enter" });
    act(() => {
      vi.advanceTimersByTime(PARENT_HOLD_MS);
    });
    fireEvent.keyUp(screen.getByRole("dialog"), { key: "Enter" });
  }

  it("returns focus to the entry after Escape or Cancel, not after an auto-lock", async () => {
    fake.setReplies("/api/config", {
      status: 200,
      body: { ...configFixture({ children: [MIA] }), editor: true },
    });
    renderBoard();
    await ready();
    const button = entry();
    if (button === null) throw new Error("no entry");

    openWithEnter(button);
    const dialog = screen.getByRole("dialog", { name: en.parent.pin.title });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();

    openWithEnter(button);
    fireEvent.click(screen.getByRole("button", { name: en.parent.pin.cancel }));
    expect(button).toHaveFocus();

    openWithEnter(button);
    // jsdom has no `inert`, so the entry may keep focus: drop it to see the auto-lock
    // does not move focus back.
    button.blur();
    act(() => {
      vi.advanceTimersByTime(PARENT_IDLE_LOCK_MS);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).not.toHaveFocus();
  });

  it("closes the gate when the editor is switched off meanwhile", async () => {
    fake.setReplies("/api/config", {
      status: 200,
      body: { ...configFixture({ children: [MIA] }), editor: true },
    });
    renderBoard();
    await ready();
    const button = entry();
    if (button === null) throw new Error("no entry");
    openWithEnter(button);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fake.setReplies("/api/config", {
      status: 200,
      body: configFixture({ children: [MIA] }),
    });
    await act(async () => {
      await clients[0]?.refetchQueries();
      // TanStack notifies observers on a (faked) zero timeout.
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(entry()).toBeNull();
  });

  it("pauses the week view's auto-return while the gate is open", async () => {
    fake.setReplies("/api/config", {
      status: 200,
      body: {
        ...configFixture({ children: [MIA], autoReturnSeconds: 30 }),
        editor: true,
      },
    });
    renderBoard();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: en.board.week }));
    expect(screen.getByTestId("week-board")).toBeInTheDocument();

    const button = entry();
    if (button === null) throw new Error("no entry");
    fireEvent.pointerDown(button, { button: 0 });
    act(() => {
      vi.advanceTimersByTime(PARENT_HOLD_MS);
    });
    fireEvent.pointerUp(button);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Well past autoReturnSeconds (but under the gate's idle lock): still the week.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByTestId("week-board")).toBeInTheDocument();

    // Closing the gate restarts the countdown from zero.
    fireEvent.click(screen.getByRole("button", { name: en.parent.pin.cancel }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(screen.getByTestId("week-board")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.queryByTestId("week-board")).not.toBeInTheDocument();
  });
});
