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

import { BEN, MIA } from "../components/fixtures.test-utils";
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
  weatherFixture,
} from "../data/testing.test-utils";
import { Board } from "./Board";

/*
 * Weather on the board (T-49): chips on every overview column and in the week headers,
 * today's clothing row (tomorrow's from eveningStart), the attribution in the rail; any
 * failure hides all of it without a word. Only `Date` is faked (advancing with real
 * time); the minute clock is woken with `visibilitychange`.
 */

const at = (iso: string): number => Date.parse(iso);
const AGENDA = agendaFixture({
  range: { from: "2026-11-22", to: "2026-12-23" },
});

let fake: FakeFetch;
let clients: QueryClient[] = [];

function renderBoard(
  storage: ReturnType<typeof createMemoryStorage> = createMemoryStorage(),
): ReturnType<typeof render> {
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

function setWeather(on: boolean): void {
  fake.setReplies("/api/config", {
    status: 200,
    body: { ...configFixture({ children: [MIA, BEN] }), weather: on },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  fake = createFakeFetch();
  setWeather(true);
  fake.setReplies("/api/agenda", { status: 200, body: AGENDA });
  fake.setReplies("/api/weather", { status: 200, body: weatherFixture() });
});

afterEach(() => {
  for (const client of clients) client.clear();
  clients = [];
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Board: weather", () => {
  it("shows a chip on every overview column, today's clothes and the attribution", async () => {
    vi.setSystemTime(at("2026-11-22T09:00:00+01:00"));
    renderBoard();
    await screen.findByTestId("board-ready");
    const columns = screen.getAllByTestId("day-column");
    await waitFor(() => {
      expect(screen.getAllByTestId("weather-chip")).toHaveLength(4);
    });
    const [today, tomorrow] = columns;
    if (today === undefined || tomorrow === undefined) throw new Error("cols");
    expect(
      within(today).getByRole("img", {
        name: "Mostly sunny, now 8 degrees, high 12 degrees",
      }),
    ).toBeInTheDocument();
    expect(
      within(tomorrow).getByRole("img", { name: "Rain, high 7 degrees" }),
    ).toBeInTheDocument();
    // Today's clothes, only in today's column.
    expect(
      within(today).getByRole("list", { name: "Wear today: jacket" }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("clothing-row")).toHaveLength(1);
    expect(screen.getByTestId("weather-attribution")).toHaveTextContent(
      "Weather: Open-Meteo.com",
    );
    // A weather chip is no status: the board is calm.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("switches to tomorrow's weather and clothes at eveningStart; today's chip says 'now' only", async () => {
    fake.setReplies("/api/weather", {
      status: 200,
      body: weatherFixture({ fetchedAt: "2026-11-22T16:30:00+01:00" }),
    });
    vi.setSystemTime(at("2026-11-22T16:59:00+01:00"));
    renderBoard();
    await screen.findByRole("list", { name: "Wear today: jacket" });
    const today = screen.getAllByTestId("day-column")[0];
    if (today === undefined) throw new Error("no column");
    expect(
      within(today).getByRole("img", {
        name: "Mostly sunny, now 8 degrees, high 12 degrees",
      }),
    ).toBeInTheDocument();
    act(() => {
      vi.setSystemTime(at("2026-11-22T17:00:00+01:00"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const row = await screen.findByRole("list", {
      name: "Tomorrow: Rain, high 7 degrees. Wear: umbrella, rain boots, jacket, warm hat, and gloves",
    });
    expect(row.closest("[data-testid=clothing-row]")).toHaveAttribute(
      "data-when",
      "tomorrow",
    );
    expect(screen.getByTestId("clothing-forecast")).toHaveTextContent("🌧️7°");
    expect(screen.queryByTestId("clothing-day")).toBeNull();
    // Today's chip: thermometer and "now", no day icon after eveningStart.
    const chip = within(today).getByRole("img", { name: "Now 8 degrees" });
    expect(chip).toHaveTextContent("🌡️8°");
    expect(within(today).queryByText("🌤️")).toBeNull();
  });

  it("puts the icon and high in the week headers, named in the heading", async () => {
    vi.setSystemTime(at("2026-11-22T09:00:00+01:00"));
    renderBoard();
    await screen.findByTestId("board-ready");
    await waitFor(() => {
      expect(screen.getAllByTestId("weather-chip")).toHaveLength(4);
    });
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(screen.getAllByTestId("day-column")).toHaveLength(7);
    // Seven forecast days: a decorative chip in each header, the name in the heading.
    const chips = screen.getAllByTestId("weather-chip");
    expect(chips).toHaveLength(7);
    for (const chip of chips)
      expect(chip).toHaveAttribute("aria-hidden", "true");
    expect(
      screen.getByRole("heading", { name: "Monday, Rain, high 7 degrees" }),
    ).toBeInTheDocument();
    // Today too shows its high (not "now") in the week.
    expect(
      screen.getByRole("heading", {
        name: "Sunday, Mostly sunny, high 12 degrees",
      }),
    ).toBeInTheDocument();
    expect(chips[0]).toHaveTextContent("🌤️12°");
    expect(screen.queryByTestId("clothing-row")).toBeNull();
  });

  it("keeps the persisted forecast offline, but hides it on an error status", async () => {
    vi.setSystemTime(at("2026-11-22T09:00:00+01:00"));
    const storage = createMemoryStorage();
    const first = renderBoard(storage);
    await waitFor(() => {
      expect(screen.getAllByTestId("weather-chip")).toHaveLength(4);
    });
    await waitFor(
      () => {
        // The forecast itself, not only its pending query.
        expect(storage.getItem(PERSIST_STORAGE_KEY) ?? "").toContain(
          '"fetchedAt":"2026-11-22T08:00:00+01:00"',
        );
      },
      { timeout: 3000 },
    );
    first.unmount();

    // Next start: the weather request gets no answer (offline). The restored forecast
    // stays, also once the request has failed.
    fake.setReplies("/api/weather", "network-error");
    const before = fake.count("/api/weather");
    const second = renderBoard(storage);
    await waitFor(() => {
      expect(fake.count("/api/weather")).toBeGreaterThan(before);
    });
    await waitFor(() => {
      expect(screen.getAllByTestId("weather-chip")).toHaveLength(4);
    });
    // Let the rejected request settle into the query's error state.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.getAllByTestId("weather-chip")).toHaveLength(4);
    expect(
      screen.getByRole("list", { name: "Wear today: jacket" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("weather-attribution")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    second.unmount();

    // Next start: the worker answers 503. The restored forecast is hidden.
    fake.setReplies("/api/weather", {
      status: 503,
      body: { error: "weather_unavailable" },
    });
    const third = fake.count("/api/weather");
    renderBoard(storage);
    await screen.findByTestId("board-ready");
    await waitFor(() => {
      expect(fake.count("/api/weather")).toBeGreaterThan(third);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("weather-chip")).toBeNull();
    });
    expect(screen.queryByTestId("clothing-row")).toBeNull();
    expect(screen.queryByTestId("weather-attribution")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("hides everything quietly when the weather request fails", async () => {
    fake.setReplies("/api/weather", {
      status: 503,
      body: { error: "weather_unavailable" },
    });
    vi.setSystemTime(at("2026-11-22T09:00:00+01:00"));
    renderBoard();
    await screen.findByTestId("board-ready");
    await waitFor(() => {
      expect(fake.count("/api/weather")).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId("weather-chip")).toBeNull();
    expect(screen.queryByTestId("clothing-row")).toBeNull();
    expect(screen.queryByTestId("weather-attribution")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByTestId("event-tile").length).toBeGreaterThan(0);
  });

  it("hides a forecast older than 24 hours", async () => {
    fake.setReplies("/api/weather", {
      status: 200,
      body: weatherFixture({ fetchedAt: "2026-11-21T08:00:00+01:00" }),
    });
    vi.setSystemTime(at("2026-11-22T09:00:00+01:00"));
    renderBoard();
    await screen.findByTestId("board-ready");
    await waitFor(() => {
      expect(fake.count("/api/weather")).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId("weather-chip")).toBeNull();
    expect(screen.queryByTestId("weather-attribution")).toBeNull();
  });

  it("never asks for the weather while it is off", async () => {
    setWeather(false);
    vi.setSystemTime(at("2026-11-22T09:00:00+01:00"));
    renderBoard();
    await screen.findByTestId("board-ready");
    expect(fake.count("/api/weather")).toBe(0);
    expect(screen.queryByTestId("weather-chip")).toBeNull();
    expect(screen.queryByTestId("weather-attribution")).toBeNull();
  });
});
