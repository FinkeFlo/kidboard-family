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

import {
  eventFixture,
  mealFixture,
  MIA,
} from "../components/fixtures.test-utils";
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
import { STALE_BANNER_DELAY_MS } from "../day/DiscreetStatusBanner";
import { applyLocale } from "../i18n";
import de from "../i18n/locales/de.json";
import en from "../i18n/locales/en.json";
import { Board } from "./Board";

/** The stale pill for data fetched at 12:00 (the faked clock). */
const STALE_TEXT = en.status.stale.replace("{{time}}", "12:00 PM");

let fake: FakeFetch;
let clients: QueryClient[] = [];

function renderDay(): void {
  const client = createQueryClient({ retry: false });
  clients.push(client);
  const Wrapper = dataWrapper(
    createApiClient({ fetch: fake.fetch, token: TEST_TOKEN }),
    client,
    createMemoryStorage(),
  );
  render(
    <Wrapper>
      <Board />
    </Wrapper>,
  );
}

const config = configFixture({ children: [MIA] });

beforeEach(() => {
  // Sunday 2026-11-22, 12:00 in Berlin; only `Date` is faked so TanStack keeps running.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-11-22T12:00:00+01:00"));
  fake = createFakeFetch();
  fake.setReplies("/api/config", { status: 200, body: config });
});

afterEach(() => {
  clients.forEach((client) => {
    client.clear();
  });
  clients = [];
  applyLocale("en");
  onlineManager.setOnline(true);
  vi.useRealTimers();
});

describe("Board", () => {
  it("shows the loading skeleton until the config is there", () => {
    fake.setReplies("/api/config", "hang");
    renderDay();
    expect(screen.getByRole("status")).toHaveTextContent(en.day.loading);
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    // A calm skeleton of the overview: four columns (today first) next to the rail,
    // nothing spinning or pulsing.
    expect(screen.getAllByTestId("skeleton-column")).toHaveLength(4);
    expect(screen.getByRole("main").innerHTML).not.toMatch(/animate-|spin/u);
    // No agenda request with a guessed zone while the config is missing.
    expect(fake.count("/api/agenda")).toBe(0);
  });

  it("renders header, four day columns with all-day banner, now line and meals", async () => {
    fake.setReplies("/api/agenda", {
      status: 200,
      body: agendaFixture({
        events: [
          eventFixture({
            id: "trip",
            title: "School trip",
            allDay: true,
            start: "2026-11-22",
            end: "2026-11-23",
          }),
          eventFixture({
            id: "swim",
            title: "Swimming",
            start: "2026-11-22T09:00:00+01:00",
            end: "2026-11-22T10:00:00+01:00",
            childIds: ["mia"],
          }),
          eventFixture({
            id: "piano",
            title: "Piano",
            start: "2026-11-22T11:30:00+01:00",
            end: "2026-11-22T12:30:00+01:00",
          }),
          eventFixture({
            id: "bath",
            title: "Bath time",
            start: "2026-11-22T18:00:00+01:00",
            end: "2026-11-22T18:30:00+01:00",
          }),
          eventFixture({
            id: "zoo",
            title: "Zoo",
            start: "2026-11-25T10:00:00+01:00",
            end: "2026-11-25T11:00:00+01:00",
          }),
        ],
        meals: [
          mealFixture({ id: "m2", slot: "dinner", title: "Soup" }),
          mealFixture({ id: "m1", slot: "lunch", title: "Pasta" }),
        ],
      }),
    });
    renderDay();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Sunday" }),
    ).toBeInTheDocument();
    expect(screen.getByText("November 22")).toBeInTheDocument();

    const columns = screen.getAllByTestId("day-column");
    expect(columns.map((c) => c.dataset["date"])).toEqual([
      "2026-11-22",
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
    ]);
    const today = columns[0] as HTMLElement;
    expect(today).toHaveAttribute("aria-current", "date");
    expect(
      within(today).getByRole("heading", { level: 2, name: en.day.today }),
    ).toBeVisible();
    expect(
      within(columns[3] as HTMLElement).getByRole("heading", {
        level: 2,
        name: "Wednesday",
      }),
    ).toBeVisible();

    // Events top to bottom; started ones above the now line, the next one emphasised.
    const tiles = within(today)
      .getAllByTestId("event-tile")
      .filter((tile) => tile.dataset["allDay"] === "false");
    expect(tiles.map((tile) => tile.dataset["status"])).toEqual([
      "past",
      "current",
      "upcoming",
    ]);
    expect(tiles.map((tile) => tile.dataset["next"])).toEqual([
      "false",
      "false",
      "true",
    ]);
    const now = within(today).getByRole("separator", { name: "now, 12:00 PM" });
    expect(
      now.compareDocumentPosition(tiles[1] as HTMLElement) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
    expect(
      now.compareDocumentPosition(tiles[2] as HTMLElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Only today has a now line.
    expect(screen.getAllByRole("separator")).toHaveLength(1);

    // The all-day event is a banner at the top, with its own icon and no clock time.
    const banner = within(today).getByTestId("all-day");
    const trip = within(banner).getByRole("article", {
      name: "School trip, All day, For everyone",
    });
    expect(trip).toHaveAttribute("data-all-day", "true");
    expect(within(trip).getByTestId("all-day-icon")).toBeInTheDocument();
    expect(within(trip).queryByText("🌞")).toBeNull();

    // Meals as named plates: breakfast place empty, lunch, dinner.
    const meals = within(today).getByRole("list", { name: en.day.meals });
    expect(
      within(meals)
        .getAllByRole("img")
        .map((plate) => plate.getAttribute("aria-label")),
    ).toEqual(["Lunch: Pasta", "Dinner: Soup"]);
    expect(
      within(columns[1] as HTMLElement).queryByRole("list", {
        name: en.day.meals,
      }),
    ).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the empty-day state without events and meals", async () => {
    fake.setReplies("/api/agenda", {
      status: 200,
      body: agendaFixture({ events: [], meals: [] }),
    });
    renderDay();
    expect(
      await screen.findByRole("heading", { name: en.day.empty.title }),
    ).toBeVisible();
    expect(screen.getAllByTestId("day-column")).toHaveLength(4);
    // The empty note sits inside today's column.
    expect(screen.getAllByTestId("day-column")[0]).toContainElement(
      screen.getByTestId("day-empty"),
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Sunday",
    );
  });

  it("keeps the meals below the empty note when only meals exist", async () => {
    fake.setReplies("/api/agenda", {
      status: 200,
      body: agendaFixture({ events: [], meals: [mealFixture()] }),
    });
    renderDay();
    expect(
      await screen.findByRole("img", { name: "Lunch: Pasta" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("day-empty")).toBeInTheDocument();
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  describe("without configured calendars (ADR-0014: app entries only)", () => {
    beforeEach(() => {
      fake.setReplies("/api/config", {
        status: 200,
        body: configFixture({ children: [MIA], calendars: [] }),
      });
    });

    it("shows the normal empty state, not an error, when there are no sources at all", async () => {
      fake.setReplies("/api/agenda", {
        status: 200,
        body: agendaFixture({ sources: [], events: [], meals: [] }),
      });
      renderDay();
      expect(
        await screen.findByRole("heading", { name: en.day.empty.title }),
      ).toBeVisible();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText(STALE_TEXT)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: en.board.week }));
      expect(screen.getAllByTestId("day-column")).toHaveLength(7);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("shows app events and app meals in the day and the week view", async () => {
      fake.setReplies("/api/agenda", {
        status: 200,
        body: agendaFixture({
          sources: [
            {
              id: "app-events",
              status: "ok",
              fetchedAt: "2026-11-22T08:00:00+01:00",
            },
            {
              id: "app-meals",
              status: "ok",
              fetchedAt: "2026-11-22T08:00:00+01:00",
            },
          ],
          events: [eventFixture({ sourceId: "app-events" })],
          meals: [
            mealFixture({ sourceId: "app-meals" }),
            mealFixture({
              id: "m2",
              sourceId: "app-meals",
              date: "2026-11-24",
              title: "Soup",
            }),
          ],
        }),
      });
      renderDay();
      expect(
        await screen.findByRole("article", { name: /^Swimming, 2:30 PM/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("img", { name: "Lunch: Pasta" }),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("day-empty")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: en.board.week }));
      expect(
        screen.getByRole("img", { name: "Lunch: Soup" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  it("shows the 'Stand' time of the agenda in the rail, not as a live region", async () => {
    fake.setReplies("/api/agenda", { status: 200, body: agendaFixture() });
    renderDay();
    const updated = await screen.findByTestId("updated-at");
    expect(updated).toHaveTextContent("Updated 12:00 PM");
    expect(updated.closest("[aria-live], [role=status]")).toBeNull();
    expect(screen.getByTestId("nav-rail")).toContainElement(updated);
    expect(screen.getByRole("navigation", { name: en.board.navLabel })).toBe(
      screen.getByTestId("nav-rail"),
    );
  });

  it("follows the config locale and zone", async () => {
    fake.setReplies("/api/config", {
      status: 200,
      body: configFixture({ locale: "de" }),
    });
    fake.setReplies("/api/agenda", {
      status: 200,
      body: agendaFixture({ events: [], meals: [] }),
    });
    renderDay();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Sonntag" }),
    ).toBeInTheDocument();
    expect(screen.getByText("22. November")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Heute" }),
    ).toBeInTheDocument();
    expect(screen.getByText(de.day.empty.title)).toBeVisible();
  });

  it("explains an access link that is no longer valid, calm and without jargon", async () => {
    fake.setReplies("/api/config", { status: 401, body: {} });
    renderDay();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-error", "unauthorized");
    expect(alert).toHaveAttribute("data-variant", "unauthorized");
    expect(alert).toHaveTextContent(en.day.error.unauthorized.title);
    expect(alert).toHaveTextContent(en.day.error.unauthorized.hint);
    expect(alert).toHaveTextContent("needs a new access link");
    expect(alert).toHaveTextContent("no longer valid");
    // No URL syntax or technical wording on the card; the docs explain `?key=`.
    expect(alert.textContent).not.toMatch(/\?key|key=|token|expired/iu);
    expect(screen.getByTestId("error-code")).toHaveTextContent("KB-401");
    // Nothing to retry: only a parent opening the link again helps.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("explains offline without any saved plan (no 'last known plan' claim)", async () => {
    onlineManager.setOnline(false);
    renderDay();
    const status = (await screen.findByText(en.day.error.offline)).closest(
      "[data-error]",
    );
    expect(status).toHaveAttribute("data-error", "offline");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveTextContent(en.error.title);
    expect(status).toHaveTextContent(en.day.error.offline);
    expect(status).not.toHaveTextContent("as of");
    expect(screen.getByTestId("error-code")).toHaveTextContent("KB-OFF");
    expect(screen.queryByTestId("day-column")).not.toBeInTheDocument();
  });

  it("shows the error state when the agenda fails and nothing is cached", async () => {
    fake.setReplies("/api/agenda", {
      status: 502,
      body: { error: "upstream" },
    });
    renderDay();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-error", "failed");
    expect(alert).toHaveAttribute("data-variant", "error");
    expect(alert).toHaveTextContent(en.error.title);
    expect(alert).toHaveTextContent(en.day.error.failed);
    expect(screen.getByTestId("error-code")).toHaveTextContent(
      "Error code for parents: KB-502",
    );
    // Never the raw technical message ("/api/agenda: upstream (HTTP 502)").
    expect(alert).not.toHaveTextContent("/api/agenda");
    expect(alert).not.toHaveTextContent("HTTP");
    expect(screen.queryByTestId("day-column")).not.toBeInTheDocument();
  });

  it("refetches at once when 'reload now' is pressed on the error card", async () => {
    fake.setReplies("/api/agenda", {
      status: 502,
      body: { error: "upstream" },
    });
    renderDay();
    await screen.findByRole("alert");
    const before = fake.count("/api/agenda");
    fake.setReplies("/api/agenda", { status: 200, body: agendaFixture() });
    fireEvent.click(screen.getByRole("button", { name: en.error.retry }));
    expect(await screen.findAllByTestId("day-column")).toHaveLength(4);
    expect(fake.count("/api/agenda")).toBe(before + 1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps showing the board for worker-stale data", async () => {
    fake.setReplies("/api/agenda", {
      status: 200,
      body: agendaFixture({ stale: true }),
    });
    renderDay();
    await waitFor(() => {
      expect(screen.getAllByTestId("day-column")).toHaveLength(4);
    });
    // Stale data is shown; the banner is debounced (see DiscreetStatusBanner.test).
    expect(screen.queryByTestId("day-empty")).not.toBeInTheDocument();
  });

  it("shows the stale banner once stale data has persisted for the delay", async () => {
    // Timers must be faked before render so the debounce timer is the fake one.
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(Date.parse("2026-11-22T12:00:00+01:00"));
    fake.setReplies("/api/agenda", {
      status: 200,
      body: agendaFixture({ stale: true }),
    });
    renderDay();
    // `vi.waitFor` advances the fake timers while polling (the fetch resolves via I/O).
    await vi.waitFor(() => {
      expect(screen.getAllByTestId("day-column")).toHaveLength(4);
    });
    expect(screen.queryByText(STALE_TEXT)).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STALE_BANNER_DELAY_MS);
    });
    expect(screen.getByRole("status")).toHaveTextContent(STALE_TEXT);
  });

  describe("burn-in shift and banner slot (T-22)", () => {
    afterEach(() => {
      window.history.replaceState(null, "", "/");
    });

    it("moves only the inner wrapper, not <main>, as pinned by ?burnin", async () => {
      window.history.replaceState(null, "", "/?burnin=5");
      fake.setReplies("/api/agenda", { status: 200, body: agendaFixture() });
      renderDay();
      const shift = await screen.findByTestId("burn-in-shift");
      expect(shift).toHaveAttribute("data-burn-in-x", "-1");
      expect(shift).toHaveAttribute("data-burn-in-y", "1");
      expect(shift.style.transform).toBe(
        "translate(calc(var(--spacing-burn-in) * -1), calc(var(--spacing-burn-in) * 1))",
      );
      const main = screen.getByRole("main");
      expect(main.style.transform).toBe("");
      expect(main).toContainElement(shift);
      expect(shift).toContainElement(screen.getByRole("banner"));
    });

    it("shows the status banner outside the header and the rail, so the toggle keeps its place", async () => {
      fake.setReplies("/api/agenda", {
        status: 200,
        body: agendaFixture({ stale: true }),
      });
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      vi.setSystemTime(Date.parse("2026-11-22T12:00:00+01:00"));
      renderDay();
      await vi.waitFor(() => {
        expect(screen.getAllByTestId("day-column")).toHaveLength(4);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STALE_BANNER_DELAY_MS);
      });
      const banner = screen.getByRole("status");
      expect(banner).toHaveTextContent(STALE_TEXT);
      expect(screen.getByRole("banner")).not.toContainElement(banner);
      expect(screen.getByTestId("nav-rail")).not.toContainElement(banner);
      expect(screen.getByTestId("burn-in-shift")).not.toContainElement(banner);
      expect(screen.getByRole("main")).toContainElement(banner);
    });
  });

  describe("day / week toggle", () => {
    const agenda = (): void => {
      fake.setReplies("/api/agenda", {
        status: 200,
        body: agendaFixture({
          events: [
            eventFixture({ id: "today", title: "Swimming" }),
            eventFixture({
              id: "tue",
              title: "Dentist",
              icon: "🦷",
              start: "2026-11-24T09:00:00+01:00",
              end: "2026-11-24T10:00:00+01:00",
            }),
          ],
          meals: [
            mealFixture({ id: "tue-m", date: "2026-11-24", title: "Soup" }),
          ],
        }),
      });
    };

    it("starts on the day view and switches to the week with the shared header", async () => {
      agenda();
      renderDay();
      expect(await screen.findAllByTestId("day-column")).toHaveLength(4);
      expect(screen.queryByTestId("week-board")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: en.board.week }));
      expect(screen.getByTestId("week-board")).toBeInTheDocument();
      expect(screen.queryByTestId("overview")).not.toBeInTheDocument();
      expect(screen.getAllByTestId("day-column")).toHaveLength(7);
      // Header (date and legend) and toggle stay.
      expect(
        screen.getByRole("heading", { level: 1, name: "Sunday" }),
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole("banner")).getByText("November 22"),
      ).toBeInTheDocument();
      expect(screen.getByRole("list", { name: en.legend.label })).toBeVisible();
      expect(
        screen.getByRole("button", { name: en.board.week }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(
        screen.getByRole("article", { name: /^Dentist, 9:00 AM/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("img", { name: "Lunch: Soup" }),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: en.board.day }));
      expect(screen.getAllByTestId("day-column")).toHaveLength(4);
    });

    it("returns to the day view after autoReturnSeconds of inactivity, not before", async () => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      vi.setSystemTime(Date.parse("2026-11-22T12:00:00+01:00"));
      fake.setReplies("/api/config", {
        status: 200,
        body: configFixture({ children: [MIA], autoReturnSeconds: 30 }),
      });
      agenda();
      renderDay();
      await vi.waitFor(() => {
        expect(screen.getAllByTestId("day-column")).toHaveLength(4);
      });
      fireEvent.click(screen.getByRole("button", { name: en.board.week }));
      expect(screen.getByTestId("week-board")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(29_000);
      });
      // Touch resets the countdown.
      fireEvent.pointerDown(screen.getByTestId("week-board"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(29_000);
      });
      expect(screen.getByTestId("week-board")).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(screen.queryByTestId("week-board")).not.toBeInTheDocument();
      expect(screen.getAllByTestId("day-column")).toHaveLength(4);
    });
  });

  describe("countdown (T-19)", () => {
    it("requests 31 days and shows the countdown compact on the day view, full on the week view", async () => {
      fake.setReplies("/api/agenda", {
        status: 200,
        body: agendaFixture({
          range: { from: "2026-11-22", to: "2026-12-23" },
          events: [
            // Beyond the week, 26 nights ahead (not in any week column).
            eventFixture({
              id: "xmas",
              title: "Christmas",
              icon: "🎄",
              allDay: true,
              start: "2026-12-18",
              end: "2026-12-19",
              countdown: true,
            }),
            // Under way since yesterday: not awaited any more.
            eventFixture({
              id: "holiday",
              title: "Holiday",
              icon: "🏖️",
              allDay: true,
              start: "2026-11-21",
              end: "2026-11-25",
              countdown: true,
            }),
          ],
        }),
      });
      renderDay();
      const compact = await screen.findByRole("region", {
        name: en.countdown.label,
      });
      expect(fake.calls.map((c) => c.url)).toContain(
        "/api/agenda?from=2026-11-22&days=31",
      );
      expect(compact).toHaveAttribute("data-nights", "26");
      expect(compact).toHaveTextContent("26 more sleeps until Christmas");
      expect(within(compact).getByTestId("countdown-grouped")).toBeTruthy();
      expect(within(compact).getByTestId("countdown-count")).toHaveTextContent(
        "26 ×",
      );
      // The countdown lives in the header, next to the date.
      expect(compact.closest("header")).not.toBeNull();

      fireEvent.click(screen.getByRole("button", { name: en.board.week }));
      const full = screen.getByRole("region", { name: en.countdown.label });
      // The same pill (one size) on the week view.
      expect(full.className).toBe(compact.className);
      expect(full).toHaveTextContent("26 more sleeps until Christmas");
    });

    it("shows no countdown without an upcoming countdown event", async () => {
      fake.setReplies("/api/agenda", {
        status: 200,
        body: agendaFixture({
          events: [eventFixture({ id: "swim", title: "Swimming" })],
        }),
      });
      renderDay();
      expect(await screen.findAllByTestId("day-column")).toHaveLength(4);
      expect(
        screen.queryByRole("region", { name: en.countdown.label }),
      ).not.toBeInTheDocument();
    });
  });
});
