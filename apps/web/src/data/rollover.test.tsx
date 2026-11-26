import type { AgendaResponse, CalendarEvent } from "@kidboard/shared";
import { onlineManager, type QueryClient } from "@tanstack/react-query";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ApiClient, createApiClient } from "./apiClient";
import {
  type ConnectionStatus,
  useApiErrorKind,
  useConnectionStatus,
} from "./connectionStatus";
import { PERSIST_STORAGE_KEY } from "./persister";
import { useTodayAgenda } from "./queries";
import { createQueryClient, PERSIST_MAX_AGE_MS } from "./queryClient";
import {
  agendaFixture,
  configFixture,
  createFakeFetch,
  createMemoryStorage,
  dataWrapper,
  type FakeFetch,
  TEST_TOKEN,
} from "./testing.test-utils";

/*
 * Day rollover of the data layer (T-16). Only `Date` is faked (advancing with real
 * time, so the persister's throttle keeps working); timers stay real so TanStack, the
 * persister and `waitFor` run normally. Midnight is reached by setting the wall clock
 * and waking the minute clock with `visibilitychange`; the minute-boundary timer
 * itself is covered with fully fake timers in `time/hooks.test.tsx`.
 */

const at = (iso: string): number => Date.parse(iso);
/** Persister throttle is 1 s. */
const PERSIST_WAIT = { timeout: 3000 };

function timed(id: string, start: string, end: string): CalendarEvent {
  return {
    id,
    sourceId: "family",
    title: id,
    icon: "📅",
    iconIsFallback: true,
    childIds: [],
    allDay: false,
    start,
    end,
    countdown: false,
  };
}

/** Agenda the worker would send for `[from, from + 31)` (`AGENDA_DAYS`). */
function agendaFrom(from: string, to: string, title: string): AgendaResponse {
  return agendaFixture({
    range: { from, to },
    events: [
      timed(
        `${title}-early`,
        "2026-11-22T10:00:00+01:00",
        "2026-11-22T11:00:00+01:00",
      ),
      timed(title, "2026-11-23T09:00:00+01:00", "2026-11-23T10:00:00+01:00"),
    ].filter((e) => e.end.slice(0, 10) >= from),
  });
}

const DAY1 = agendaFrom("2026-11-22", "2026-12-23", "Swimming");
const DAY2 = agendaFrom("2026-11-23", "2026-12-24", "Football");

interface Board {
  today: string | undefined;
  timeZone: string | undefined;
  agenda: ReturnType<typeof useTodayAgenda>["agenda"];
  status: ConnectionStatus;
  errorKind: ReturnType<typeof useApiErrorKind>;
}

let clients: QueryClient[] = [];
let fake: FakeFetch;
let api: ApiClient;
let storage: ReturnType<typeof createMemoryStorage>;
let renders: Board[];

function renderBoard(): ReturnType<typeof renderHook<Board, unknown>> {
  const client = createQueryClient({ retry: false });
  clients.push(client);
  return renderHook(
    (): Board => {
      const { today, timeZone, agenda } = useTodayAgenda();
      const board = {
        today,
        timeZone,
        agenda,
        status: useConnectionStatus(),
        errorKind: useApiErrorKind(),
      };
      renders.push(board);
      return board;
    },
    { wrapper: dataWrapper(api, client, storage) },
  );
}

function agendaUrls(): string[] {
  return fake.calls
    .map((c) => c.url)
    .filter((url) => url.startsWith("/api/agenda"));
}

function storedAgendaFroms(): string[] {
  const raw = storage.getItem(PERSIST_STORAGE_KEY);
  if (raw === null) {
    return [];
  }
  return (JSON.parse(raw) as PersistedClient).clientState.queries
    .filter((q) => q.queryKey[1] === "agenda")
    .map((q) => String(q.queryKey[2]));
}

/** Renders the board at 23:59 Berlin and waits until day 1 is ready. */
async function readyBeforeMidnight(): Promise<
  ReturnType<typeof renderHook<Board, unknown>>
> {
  vi.setSystemTime(at("2026-11-22T22:59:00Z"));
  const board = renderBoard();
  await waitFor(() => {
    expect(board.result.current.status).toBe("ready");
  });
  expect(board.result.current.today).toBe("2026-11-22");
  return board;
}

/** Sets the wall clock to Berlin midnight and wakes the minute clock. */
function reachMidnight(): void {
  vi.setSystemTime(at("2026-11-22T23:00:00Z"));
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/** {@link reachMidnight}, then waits for the new day; returns the render mark. */
async function passMidnight(
  board: ReturnType<typeof renderHook<Board, unknown>>,
): Promise<number> {
  const mark = renders.length;
  reachMidnight();
  await waitFor(() => {
    expect(board.result.current.today).toBe("2026-11-23");
  });
  return mark;
}

/** Every render after `mark` that already shows the new day. */
function rendersOfNewDay(mark: number): Board[] {
  return renders.slice(mark).filter((r) => r.today === "2026-11-23");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  storage = createMemoryStorage();
  renders = [];
  fake = createFakeFetch();
  fake.setReplies("/api/config", { status: 200, body: configFixture() });
  fake.setReplies(
    "/api/agenda",
    { status: 200, body: DAY1 },
    { status: 200, body: DAY2 },
  );
  api = createApiClient({ fetch: fake.fetch, token: TEST_TOKEN });
});

afterEach(() => {
  for (const client of clients) {
    client.clear();
  }
  clients = [];
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("midnight rollover", () => {
  it("online: fetches the new range at midnight, never showing loading or empty", async () => {
    const board = await readyBeforeMidnight();
    expect(agendaUrls()).toEqual(["/api/agenda?from=2026-11-22&days=31"]);

    const mark = await passMidnight(board);
    await waitFor(() => {
      expect(board.result.current.agenda.data?.range.from).toBe("2026-11-23");
      expect(board.result.current.agenda.isFetching).toBe(false);
    });
    expect(agendaUrls()).toEqual([
      "/api/agenda?from=2026-11-22&days=31",
      "/api/agenda?from=2026-11-23&days=31",
    ]);
    expect(
      board.result.current.agenda.data?.events.map((e) => e.title),
    ).toEqual(["Football"]);
    expect(board.result.current.status).toBe("ready");
    const newDay = rendersOfNewDay(mark);
    expect(newDay.length).toBeGreaterThan(0);
    expect(newDay.every((r) => r.agenda.data !== undefined)).toBe(true);
    expect(newDay.map((r) => r.status)).not.toContain("loading");
  });

  it("online with a slow fetch: a partial seed is stale until the full range lands", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = fake.fetch;
    // The post-midnight request hangs until released, then answers with day 2.
    api = createApiClient({
      fetch: async (input, init) => {
        const url = typeof input === "string" ? input : "";
        if (url.includes("from=2026-11-23")) {
          await gate;
        }
        return fetchImpl(input, init);
      },
      token: TEST_TOKEN,
    });
    const board = await readyBeforeMidnight();
    const mark = await passMidnight(board);
    await waitFor(() => {
      expect(agendaUrls()).toHaveLength(1); // the hanging one is not counted yet
      expect(board.result.current.agenda.isFetching).toBe(true);
    });
    const shown = board.result.current;
    expect(shown.agenda.data?.range).toEqual({
      from: "2026-11-23",
      to: "2026-12-23",
    });
    expect(shown.status).toBe("stale");
    // The very first render of the new day still carries the old status: the status
    // counts queries with observers, and the new query's observer subscribes in an
    // effect right after that render, which re-renders at once. From then on the
    // partial seed is never `ready`.
    const [first, ...whileFetching] = rendersOfNewDay(mark);
    expect(first?.agenda.data?.range.from).toBe("2026-11-23");
    expect(whileFetching.length).toBeGreaterThan(0);
    expect(whileFetching.map((r) => r.status)).not.toContain("ready");
    expect(whileFetching.map((r) => r.status)).not.toContain("loading");

    release?.();
    await waitFor(() => {
      expect(board.result.current.agenda.data?.range.to).toBe("2026-12-24");
    });
    await waitFor(() => {
      expect(board.result.current.status).toBe("ready");
    });
    expect(
      board.result.current.agenda.data?.events.map((e) => e.title),
    ).toEqual(["Football"]);
  });

  it("offline: the new day is seeded from the cached agenda and stays offline", async () => {
    const board = await readyBeforeMidnight();
    act(() => {
      onlineManager.setOnline(false);
    });
    await waitFor(() => {
      expect(board.result.current.status).toBe("offline");
    });

    const mark = await passMidnight(board);
    const { agenda, status } = board.result.current;
    expect(status).toBe("offline");
    expect(agenda.data?.range).toEqual({
      from: "2026-11-23",
      to: "2026-12-23",
    });
    // Only what overlaps the new range is left.
    expect(agenda.data?.events.map((e) => e.title)).toEqual(["Swimming"]);
    expect(agendaUrls()).toHaveLength(1);
    const newDay = rendersOfNewDay(mark);
    expect(newDay.every((r) => r.agenda.data !== undefined)).toBe(true);
    expect(newDay.map((r) => r.status)).toEqual(newDay.map(() => "offline"));

    // Back online: the new range is fetched and replaces the seed.
    act(() => {
      onlineManager.setOnline(true);
    });
    await waitFor(() => {
      expect(
        board.result.current.agenda.data?.events.map((e) => e.title),
      ).toEqual(["Football"]);
    });
    expect(board.result.current.status).toBe("ready");
    expect(agendaUrls()[1]).toBe("/api/agenda?from=2026-11-23&days=31");
  });

  it("502 right after midnight: keeps the seed and reports stale", async () => {
    fake.setReplies(
      "/api/agenda",
      { status: 200, body: DAY1 },
      {
        status: 502,
        body: agendaFixture({
          range: { from: "2026-11-23", to: "2026-12-24" },
          sources: [{ id: "family", status: "error" }],
          events: [],
        }),
      },
    );
    const board = await readyBeforeMidnight();
    const mark = await passMidnight(board);
    await waitFor(() => {
      expect(board.result.current.status).toBe("stale");
    });
    expect(board.result.current.errorKind).toBe("upstream");
    expect(board.result.current.agenda.data?.range.from).toBe("2026-11-23");
    expect(
      board.result.current.agenda.data?.events.map((e) => e.title),
    ).toEqual(["Swimming"]);
    const newDay = rendersOfNewDay(mark);
    expect(newDay.every((r) => r.agenda.data !== undefined)).toBe(true);
    expect(newDay.map((r) => r.status)).not.toContain("loading");
    expect(newDay.map((r) => r.status)).not.toContain("error");
  });

  it("the seed is never persisted; the real agenda stays in storage", async () => {
    const board = await readyBeforeMidnight();
    await waitFor(() => {
      expect(storedAgendaFroms()).toEqual(["2026-11-22"]);
    }, PERSIST_WAIT);
    act(() => {
      onlineManager.setOnline(false);
    });
    await passMidnight(board);
    expect(board.result.current.agenda.data?.range.from).toBe("2026-11-23");
    // Let the throttled write run with the seeded query in the cache.
    await act(() => new Promise((resolve) => setTimeout(resolve, 1200)));
    expect(storedAgendaFroms()).toEqual(["2026-11-22"]);
  });

  it("401 after midnight wipes the seed like any agenda data", async () => {
    fake.setReplies(
      "/api/agenda",
      { status: 200, body: DAY1 },
      {
        status: 401,
        body: {
          error: "unauthorized",
          message: "A valid access token is required",
        },
      },
    );
    const board = await readyBeforeMidnight();
    reachMidnight();
    await waitFor(() => {
      expect(board.result.current.status).toBe("error");
    });
    // The new range was requested (seeded meanwhile) and answered with 401.
    expect(agendaUrls()[1]).toBe("/api/agenda?from=2026-11-23&days=31");
    expect(board.result.current.errorKind).toBe("unauthorized");
    expect(board.result.current.agenda.data).toBeUndefined();
    await act(() => new Promise((resolve) => setTimeout(resolve, 1200)));
    expect(storedAgendaFroms()).toEqual([]);
  });
});

describe("reload on a later day", () => {
  /** Day 1 loaded and persisted at 10:00 Berlin, then the app is closed. */
  async function persistDay1(): Promise<void> {
    vi.setSystemTime(at("2026-11-22T09:00:00Z"));
    const first = renderBoard();
    // `ready`, or `stale` when the fixture covers fewer days than requested.
    await waitFor(() => {
      expect(["ready", "stale"]).toContain(first.result.current.status);
    });
    await waitFor(() => {
      expect(storedAgendaFroms()).toEqual(["2026-11-22"]);
    }, PERSIST_WAIT);
    first.unmount();
    renders = [];
  }

  it("offline the next morning: restored cache seeds the new day", async () => {
    await persistDay1();
    const fetchesBefore = fake.calls.length;
    vi.setSystemTime(at("2026-11-23T06:00:00Z"));
    act(() => {
      onlineManager.setOnline(false);
    });

    const board = renderBoard();
    await waitFor(() => {
      expect(board.result.current.status).toBe("offline");
    });
    expect(board.result.current.today).toBe("2026-11-23");
    expect(board.result.current.agenda.data?.range.from).toBe("2026-11-23");
    expect(
      board.result.current.agenda.data?.events.map((e) => e.title),
    ).toEqual(["Swimming"]);
    expect(fake.calls.length).toBe(fetchesBefore);
    // Once restored, the board never showed an empty agenda.
    const afterRestore = renders.slice(
      renders.findIndex((r) => r.status !== "loading"),
    );
    expect(afterRestore.every((r) => r.agenda.data !== undefined)).toBe(true);
  });

  it("offline after the cached range: nothing to seed, offline without data", async () => {
    // A partial last-good range (worker served an old entry): it ends on the 25th.
    fake.setReplies("/api/agenda", {
      status: 200,
      body: agendaFrom("2026-11-22", "2026-11-25", "Swimming"),
    });
    await persistDay1();
    vi.setSystemTime(at("2026-11-26T06:00:00Z"));
    act(() => {
      onlineManager.setOnline(false);
    });
    const board = renderBoard();
    await waitFor(() => {
      expect(board.result.current.status).toBe("offline");
    });
    expect(board.result.current.today).toBe("2026-11-26");
    expect(board.result.current.agenda.data).toBeUndefined();
  });

  it("data older than 7 days is dropped: no zone, no seed, offline without data", async () => {
    await persistDay1();
    vi.setSystemTime(at("2026-11-22T09:00:00Z") + PERSIST_MAX_AGE_MS + 60_000);
    act(() => {
      onlineManager.setOnline(false);
    });
    const board = renderBoard();
    await waitFor(() => {
      expect(board.result.current.status).toBe("offline");
    });
    // The config is as old as the agenda, so the zone is unknown again (gate).
    expect(board.result.current.today).toBeUndefined();
    expect(board.result.current.agenda.data).toBeUndefined();
  });
});

describe("before the config has loaded", () => {
  it("requests no agenda and stays loading (no guessed zone)", async () => {
    fake.setReplies("/api/config", "hang");
    vi.setSystemTime(at("2026-11-22T12:00:00Z"));
    const board = renderBoard();
    await waitFor(() => {
      expect(fake.count("/api/config")).toBe(1);
    });
    expect(board.result.current.today).toBeUndefined();
    expect(board.result.current.timeZone).toBeUndefined();
    expect(board.result.current.agenda.data).toBeUndefined();
    expect(board.result.current.status).toBe("loading");
    expect(agendaUrls()).toEqual([]);
  });

  it("offline on the first visit reports offline, not loading", async () => {
    vi.setSystemTime(at("2026-11-22T12:00:00Z"));
    act(() => {
      onlineManager.setOnline(false);
    });
    const board = renderBoard();
    await waitFor(() => {
      expect(board.result.current.status).toBe("offline");
    });
    expect(board.result.current.today).toBeUndefined();
    expect(fake.calls).toHaveLength(0);
  });

  it("then derives today in the config zone, like the worker window", async () => {
    // 20:00Z is still the 22nd in Berlin (the schema default) but the 23rd in Tokyo.
    vi.setSystemTime(at("2026-11-22T20:00:00Z"));
    fake.setReplies("/api/config", {
      status: 200,
      body: configFixture({ timeZone: "Asia/Tokyo" }),
    });
    fake.setReplies("/api/agenda", {
      status: 200,
      body: agendaFixture({
        timeZone: "Asia/Tokyo",
        range: { from: "2026-11-23", to: "2026-12-24" },
      }),
    });
    const board = renderBoard();
    await waitFor(() => {
      expect(board.result.current.status).toBe("ready");
    });
    expect(board.result.current.today).toBe("2026-11-23");
    expect(agendaUrls()).toEqual(["/api/agenda?from=2026-11-23&days=31"]);
  });
});
