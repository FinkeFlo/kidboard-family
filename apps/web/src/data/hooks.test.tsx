import type { QueryClient } from "@tanstack/react-query";
import { onlineManager } from "@tanstack/react-query";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyLocale, i18n } from "../i18n";
import { type ApiClient, createApiClient } from "./apiClient";
import { useApiErrorKind, useConnectionStatus } from "./connectionStatus";
import { PERSIST_STORAGE_KEY } from "./persister";
import { useAgenda } from "./queries";
import { createQueryClient, STALE_TIME_MS } from "./queryClient";
import type { KeyValueStorage } from "./storage";
import {
  agendaFixture,
  allFailedAgenda,
  configFixture,
  createFakeFetch,
  createMemoryStorage,
  dataWrapper,
  type FakeFetch,
  TEST_TOKEN,
  TODAY,
} from "./testing.test-utils";

const RANGE = { from: TODAY, days: 8 };
/** Persister throttle is 1 s; give writes room. */
const PERSIST_WAIT = { timeout: 3000 };

function useBoard(): {
  agenda: ReturnType<typeof useAgenda>;
  status: ReturnType<typeof useConnectionStatus>;
  errorKind: ReturnType<typeof useApiErrorKind>;
} {
  return {
    agenda: useAgenda(RANGE),
    status: useConnectionStatus(),
    errorKind: useApiErrorKind(),
  };
}

function storedClient(): PersistedClient | undefined {
  const raw = storage.getItem(PERSIST_STORAGE_KEY);
  return raw === null ? undefined : (JSON.parse(raw) as PersistedClient);
}

function storedTitles(): string[] {
  const agenda = storedClient()?.clientState.queries.find(
    (q) => q.queryKey[1] === "agenda",
  );
  const data = agenda?.state.data as
    ReturnType<typeof agendaFixture> | undefined;
  return data?.events.map((e) => e.title) ?? [];
}

let clients: QueryClient[] = [];
let fake: FakeFetch;
let api: ApiClient;
let storage: ReturnType<typeof createMemoryStorage>;

let onUnauthorized: ReturnType<typeof vi.fn<() => void>>;

function newClient(): QueryClient {
  const client = createQueryClient({ retry: false, onUnauthorized });
  clients.push(client);
  return client;
}

function renderBoard(
  queryClient = newClient(),
  options: { storage?: KeyValueStorage | undefined } = { storage },
): ReturnType<typeof renderHook<ReturnType<typeof useBoard>, unknown>> {
  return renderHook(useBoard, {
    wrapper: dataWrapper(api, queryClient, options.storage),
  });
}

/** First successful load, persisted to localStorage. */
async function loadAndPersist(): Promise<void> {
  const first = renderBoard();
  await waitFor(() => {
    expect(first.result.current.status).toBe("ready");
  });
  await waitFor(() => {
    expect(storedTitles()).toEqual(["Swimming"]);
  }, PERSIST_WAIT);
  first.unmount();
}

/** Makes the persisted data older than `staleTime`, as after a reload some time later. */
function ageStoredData(): void {
  const client = storedClient();
  if (client === undefined) {
    throw new Error("nothing persisted");
  }
  for (const query of client.clientState.queries) {
    query.state.dataUpdatedAt -= STALE_TIME_MS + 60_000;
  }
  storage.setItem(PERSIST_STORAGE_KEY, JSON.stringify(client));
}

beforeEach(() => {
  storage = createMemoryStorage();
  onUnauthorized = vi.fn<() => void>();
  fake = createFakeFetch();
  fake.setReplies("/api/config", { status: 200, body: configFixture() });
  fake.setReplies("/api/agenda", { status: 200, body: agendaFixture() });
  api = createApiClient({ fetch: fake.fetch, token: TEST_TOKEN });
});

afterEach(() => {
  for (const client of clients) {
    client.clear();
  }
  clients = [];
  onlineManager.setOnline(true);
  vi.useRealTimers();
  applyLocale("en");
});

describe("useAgenda + useConnectionStatus", () => {
  it("first load: loading → ready with validated data", async () => {
    const { result } = renderBoard();
    expect(result.current.status).toBe("loading");

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.agenda.data?.events[0]?.title).toBe("Swimming");
    expect(fake.count("/api/config")).toBe(1);
    expect(fake.count("/api/agenda")).toBe(1);
  });

  it("stays loading while the first fetch is pending", async () => {
    fake.setReplies("/api/agenda", "hang");
    const { result } = renderBoard();
    await waitFor(() => {
      expect(fake.count("/api/agenda")).toBe(1);
    });
    expect(result.current.status).toBe("loading");
  });

  it("refetch replaces the data and stays ready", async () => {
    const queryClient = newClient();
    const { result } = renderBoard(queryClient);
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    fake.setReplies("/api/agenda", {
      status: 200,
      body: agendaFixture({}, "Football"),
    });
    await act(() => queryClient.invalidateQueries());

    await waitFor(() => {
      expect(result.current.agenda.data?.events[0]?.title).toBe("Football");
    });
    expect(result.current.status).toBe("ready");
    expect(fake.count("/api/agenda")).toBe(2);
  });

  it("refetches every config.refreshMinutes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    fake.setReplies("/api/config", {
      status: 200,
      body: configFixture({ refreshMinutes: 5 }),
    });
    const { result } = renderBoard();
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    const before = fake.count("/api/agenda");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60_000);
    });
    expect(fake.count("/api/agenda")).toBe(before);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await waitFor(() => {
      expect(fake.count("/api/agenda")).toBe(before + 1);
    });
  });

  it("reports stale when the worker served last-good data", async () => {
    fake.setReplies("/api/agenda", {
      status: 200,
      body: agendaFixture({
        stale: true,
        sources: [
          {
            id: "family",
            status: "stale",
            fetchedAt: "2026-11-21T08:00:00+01:00",
          },
        ],
      }),
    });
    const { result } = renderBoard();
    await waitFor(() => {
      expect(result.current.status).toBe("stale");
    });
    expect(result.current.agenda.data?.events).toHaveLength(1);
  });

  it("offline with persisted data: restores it without fetching", async () => {
    await loadAndPersist();
    const fetchesBefore = fake.calls.length;
    act(() => {
      onlineManager.setOnline(false);
    });

    const { result } = renderBoard();
    expect(result.current.status).toBe("loading"); // restoring

    await waitFor(() => {
      expect(result.current.status).toBe("offline");
    });
    expect(result.current.agenda.data?.events[0]?.title).toBe("Swimming");
    expect(fake.calls.length).toBe(fetchesBefore);
  });

  it("restored data younger than staleTime is still refetched once after a page load", async () => {
    await loadAndPersist();
    const fetchesBefore = fake.calls.length;
    fake.setReplies("/api/agenda", {
      status: 200,
      body: agendaFixture({}, "Football"),
    });

    const { result } = renderBoard();
    await waitFor(() => {
      expect(result.current.agenda.data?.events[0]?.title).toBe("Football");
    });
    expect(result.current.status).toBe("ready");
    const paths = fake.calls
      .slice(fetchesBefore)
      .map((call) => new URL(call.url, "http://x").pathname);
    // Once per query, not more (the restored data only got marked outdated).
    expect(paths.sort()).toEqual(["/api/agenda", "/api/config"]);
  });

  it("reload while the API is unreachable: keeps the last good data and time, reports stale", async () => {
    await loadAndPersist();
    const persistedAt = storedClient()?.clientState.queries.find(
      (q) => q.queryKey[1] === "agenda",
    )?.state.dataUpdatedAt;
    expect(persistedAt).toBeGreaterThan(0);
    const fetchesBefore = fake.calls.length;
    // Data younger than staleTime, as right after a first load; the API is gone.
    fake.setReplies("/api/config", "network-error");
    fake.setReplies("/api/agenda", "network-error");

    const { result } = renderBoard();
    await waitFor(() => {
      expect(result.current.status).toBe("stale");
    });
    expect(fake.calls.length).toBeGreaterThan(fetchesBefore);
    expect(result.current.errorKind).toBe("network");
    expect(result.current.agenda.data?.events[0]?.title).toBe("Swimming");
    // "Stand" stays the last successful fetch, not the failed attempt or render time.
    expect(result.current.agenda.dataUpdatedAt).toBe(persistedAt);
    // The failure never replaces the persisted last-good agenda.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(storedTitles()).toEqual(["Swimming"]);
  });

  it("offline without persisted data reports offline", async () => {
    act(() => {
      onlineManager.setOnline(false);
    });
    const { result } = renderBoard();
    await waitFor(() => {
      expect(result.current.status).toBe("offline");
    });
    expect(result.current.agenda.data).toBeUndefined();
    expect(fake.calls).toHaveLength(0);
  });

  it("back online: refetches and becomes ready", async () => {
    await loadAndPersist();
    ageStoredData();
    act(() => {
      onlineManager.setOnline(false);
    });
    const { result } = renderBoard();
    await waitFor(() => {
      expect(result.current.status).toBe("offline");
    });

    fake.setReplies("/api/agenda", {
      status: 200,
      body: agendaFixture({}, "Football"),
    });
    act(() => {
      onlineManager.setOnline(true);
    });

    await waitFor(() => {
      expect(result.current.agenda.data?.events[0]?.title).toBe("Football");
    });
    expect(result.current.status).toBe("ready");
  });

  it("schema-invalid refetch: error kept as stale, persisted data not wiped", async () => {
    await loadAndPersist();
    ageStoredData();
    fake.setReplies("/api/agenda", {
      status: 200,
      body: { ...agendaFixture(), events: [{ id: "broken" }] },
    });

    const { result } = renderBoard();
    await waitFor(() => {
      expect(result.current.status).toBe("stale");
    });
    expect(result.current.agenda.error).toMatchObject({
      kind: "invalid-response",
    });
    expect(result.current.agenda.data?.events[0]?.title).toBe("Swimming");

    // The cache is written again after the failure: the last-good data must survive it.
    const failedAt = result.current.agenda.errorUpdatedAt;
    expect(failedAt).toBeGreaterThan(0);
    // Throttled writes carry the latest state and run at most 1 s apart: after 1.2 s
    // the write triggered by the error has landed.
    await act(() => new Promise((resolve) => setTimeout(resolve, 1200)));
    expect(storedClient()?.timestamp ?? 0).toBeGreaterThanOrEqual(failedAt);
    expect(storedTitles()).toEqual(["Swimming"]);
  });

  it("200 with a failed source (stale: false) reports stale", async () => {
    fake.setReplies("/api/agenda", {
      status: 200,
      body: agendaFixture({
        stale: false,
        sources: [
          {
            id: "family",
            status: "ok",
            fetchedAt: "2026-11-22T08:00:00+01:00",
          },
          { id: "meals", status: "error" },
        ],
      }),
    });
    const { result } = renderBoard();
    await waitFor(() => {
      expect(result.current.status).toBe("stale");
    });
    expect(result.current.errorKind).toBeUndefined();
  });

  it("401 with persisted data: wipes the data, reports error and unauthorized", async () => {
    await loadAndPersist();
    ageStoredData();
    fake.setReplies("/api/config", {
      status: 401,
      body: {
        error: "unauthorized",
        message: "A valid access token is required",
      },
    });
    fake.setReplies("/api/agenda", {
      status: 401,
      body: {
        error: "unauthorized",
        message: "A valid access token is required",
      },
    });

    const { result } = renderBoard();
    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.errorKind).toBe("unauthorized");
    expect(result.current.agenda.data).toBeUndefined();
    expect(onUnauthorized).toHaveBeenCalled();

    // The throttled write after the wipe leaves no calendar data in storage.
    await act(() => new Promise((resolve) => setTimeout(resolve, 1200)));
    expect(storedClient()?.clientState.queries ?? []).toEqual([]);
  });

  it("401 on only one endpoint still wipes every KidBoard query", async () => {
    await loadAndPersist();
    ageStoredData();
    fake.setReplies("/api/agenda", {
      status: 401,
      body: {
        error: "unauthorized",
        message: "A valid access token is required",
      },
    });

    const { result } = renderBoard();
    await waitFor(() => {
      expect(result.current.errorKind).toBe("unauthorized");
    });
    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.agenda.data).toBeUndefined();
    await act(() => new Promise((resolve) => setTimeout(resolve, 1200)));
    expect(storedTitles()).toEqual([]);
  });

  it("schema-invalid first load without persisted data is an error", async () => {
    fake.setReplies("/api/agenda", { status: 200, body: { nope: true } });
    const { result } = renderBoard();
    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.agenda.data).toBeUndefined();
  });

  it("502 with persisted data: keeps showing it as stale", async () => {
    await loadAndPersist();
    ageStoredData();
    fake.setReplies("/api/agenda", { status: 502, body: allFailedAgenda() });

    const { result } = renderBoard();
    await waitFor(() => {
      expect(result.current.status).toBe("stale");
    });
    expect(result.current.agenda.error).toMatchObject({ kind: "upstream" });
    expect(result.current.errorKind).toBe("upstream");
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(result.current.agenda.data?.events[0]?.title).toBe("Swimming");
  });

  it("502 without persisted data is an error", async () => {
    fake.setReplies("/api/agenda", { status: 502, body: allFailedAgenda() });
    const { result } = renderBoard();
    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.agenda.data).toBeUndefined();
  });

  it("a failing config without data is an error even if the agenda loads", async () => {
    fake.setReplies("/api/config", { status: 500, body: { error: "x" } });
    const { result } = renderBoard();
    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
  });

  it("never writes the access token into the persisted cache", async () => {
    await loadAndPersist();
    const raw = storage.getItem(PERSIST_STORAGE_KEY) ?? "";
    expect(raw).not.toBe("");
    expect(raw).not.toContain(TEST_TOKEN);
  });

  it("works without storage (nothing persisted, data still loads)", async () => {
    const { result } = renderBoard(newClient(), { storage: undefined });
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(storage.data.size).toBe(0);
  });

  it("discards a corrupt persisted cache and loads fresh data", async () => {
    storage.setItem(PERSIST_STORAGE_KEY, "{corrupt");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const { result } = renderBoard();
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.agenda.data?.events[0]?.title).toBe("Swimming");
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });

  it("applies the config locale to i18n", async () => {
    fake.setReplies("/api/config", {
      status: 200,
      body: configFixture({ locale: "de" }),
    });
    const { result } = renderBoard();
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    await waitFor(() => {
      expect(i18n.language).toBe("de");
    });
    expect(document.documentElement.lang).toBe("de");
  });
});
