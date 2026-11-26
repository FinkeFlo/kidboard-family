import { onlineManager, type QueryClient } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BEN, eventFixture, MIA } from "../components/fixtures.test-utils";
import { createApiClient } from "../data/apiClient";
import { PERSIST_STORAGE_KEY } from "../data/persister";
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
import { Board } from "./Board";

/*
 * The 🎒 area on the board (T-36): built from the minute clock, so it switches at
 * eveningStart, at midnight (useToday) and at each event's start without a reload, also
 * offline on persisted data. Only `Date` is faked (advancing with real time, so TanStack
 * and the persister's throttle keep working); the minute clock is woken with
 * `visibilitychange`, as after a tablet wakes up (its timer is covered in time/).
 */

const at = (iso: string): number => Date.parse(iso);

const AGENDA = agendaFixture({
  range: { from: "2026-11-22", to: "2026-12-23" },
  events: [
    eventFixture({
      id: "piano",
      title: "Piano",
      start: "2026-11-22T16:00:00+01:00",
      end: "2026-11-22T17:00:00+01:00",
      childIds: ["mia"],
      bring: ["🎼"],
    }),
    eventFixture({
      id: "swim",
      title: "Swimming",
      start: "2026-11-23T07:30:00+01:00",
      end: "2026-11-23T08:30:00+01:00",
      childIds: ["mia"],
      bring: ["🩱", "🧴"],
    }),
    eventFixture({
      id: "football",
      title: "Football",
      start: "2026-11-23T15:00:00+01:00",
      end: "2026-11-23T16:00:00+01:00",
      childIds: ["ben"],
      bring: ["👟"],
    }),
  ],
});

let fake: FakeFetch;
let clients: QueryClient[] = [];
let storage: ReturnType<typeof createMemoryStorage>;

function renderBoard(): ReturnType<typeof render> {
  const client = createQueryClient({ retry: false });
  clients.push(client);
  const Wrapper = dataWrapper(
    createApiClient({ fetch: fake.fetch, token: TEST_TOKEN }),
    client,
    storage,
  );
  return render(
    <Wrapper>
      <Board />
    </Wrapper>,
  );
}

/** Sets the wall clock and wakes the minute clock. */
function wakeAt(iso: string): void {
  vi.setSystemTime(at(iso));
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

const area = (): HTMLElement | null => screen.queryByTestId("bring-area");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  storage = createMemoryStorage();
  fake = createFakeFetch();
  fake.setReplies("/api/config", {
    status: 200,
    body: configFixture({ children: [MIA, BEN] }),
  });
  fake.setReplies("/api/agenda", { status: 200, body: AGENDA });
});

afterEach(() => {
  for (const client of clients) client.clear();
  clients = [];
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Board: the 🎒 area", () => {
  it("appears at eveningStart in today's column only, not in the week view", async () => {
    vi.setSystemTime(at("2026-11-22T16:59:00+01:00"));
    renderBoard();
    await screen.findByTestId("board-ready");
    // One minute before eveningStart: today's only bring event (Piano, 16:00) has started.
    expect(screen.getAllByTestId("day-column")).toHaveLength(4);
    expect(area()).toBeNull();

    wakeAt("2026-11-22T17:00:00+01:00");
    const region = await screen.findByRole("region", {
      name: "Pack for tomorrow: Mia 🩱 🧴 and Ben 👟",
    });
    const columns = screen.getAllByTestId("day-column");
    expect(columns[0]?.contains(region)).toBe(true);
    expect(screen.getAllByTestId("bring-area")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(screen.getByTestId("week-board")).toBeInTheDocument();
    expect(area()).toBeNull();
  });

  it("before eveningStart shows today's not yet started events", async () => {
    vi.setSystemTime(at("2026-11-22T15:59:00+01:00"));
    renderBoard();
    expect(
      await screen.findByRole("region", { name: "Today bring: Mia 🎼" }),
    ).toBeInTheDocument();
    wakeAt("2026-11-22T16:00:00+01:00");
    await waitFor(() => {
      expect(area()).toBeNull();
    });
  });

  it("offline with persisted data: switches from tomorrow to today at midnight, then empties", async () => {
    // A first visit in the evening persists config and agenda.
    vi.setSystemTime(at("2026-11-22T19:40:00+01:00"));
    const first = renderBoard();
    await screen.findByRole("region", {
      name: "Pack for tomorrow: Mia 🩱 🧴 and Ben 👟",
    });
    await waitFor(
      () => {
        expect(storage.getItem(PERSIST_STORAGE_KEY)).toContain("🩱");
      },
      { timeout: 3000 },
    );
    first.unmount();
    for (const client of clients) client.clear();

    // Restart offline shortly before midnight: everything comes from storage.
    act(() => {
      onlineManager.setOnline(false);
    });
    const requests = fake.calls.length;
    vi.setSystemTime(at("2026-11-22T23:59:00+01:00"));
    renderBoard();
    await screen.findByRole("region", {
      name: "Pack for tomorrow: Mia 🩱 🧴 and Ben 👟",
    });
    expect(screen.getAllByTestId("day-column")[0]).toHaveAttribute(
      "data-date",
      "2026-11-22",
    );

    // Midnight: the new day is seeded from the cached agenda, no reload, no request.
    wakeAt("2026-11-23T00:00:00+01:00");
    await screen.findByRole("region", {
      name: "Today bring: Mia 🩱 🧴 and Ben 👟",
    });
    const today = screen.getAllByTestId("day-column")[0] as HTMLElement;
    expect(today).toHaveAttribute("data-date", "2026-11-23");
    expect(within(today).getByTestId("bring-area")).toHaveAttribute(
      "data-when",
      "today",
    );

    // Each event's icons leave at its start; nothing left, no area.
    wakeAt("2026-11-23T07:30:00+01:00");
    await screen.findByRole("region", { name: "Today bring: Ben 👟" });
    wakeAt("2026-11-23T15:00:00+01:00");
    await waitFor(() => {
      expect(area()).toBeNull();
    });
    expect(fake.calls.length).toBe(requests);
  });
});
