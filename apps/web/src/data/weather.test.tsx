import { onlineManager, type QueryClient } from "@tanstack/react-query";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, createApiClient } from "./apiClient";
import { useApiErrorKind, useConnectionStatus } from "./connectionStatus";
import {
  deserializePersistedClient,
  PERSIST_BUSTER,
  PERSIST_STORAGE_KEY,
  serializePersistedClient,
} from "./persister";
import { useAgenda, useWeather, WEATHER_REFRESH_MS } from "./queries";
import { createQueryClient } from "./queryClient";
import { queryKeys, queryKindOf } from "./queryKeys";
import {
  agendaFixture,
  configFixture,
  createFakeFetch,
  createMemoryStorage,
  dataWrapper,
  type FakeFetch,
  TEST_TOKEN,
  TODAY,
  weatherFixture,
} from "./testing.test-utils";

/*
 * The weather query (T-49): only with `config.weather`, persisted like the agenda, and
 * never part of the connection status: a weather failure shows nothing on the board.
 */

const PERSIST_WAIT = { timeout: 3000 };

let fake: FakeFetch;
let storage: ReturnType<typeof createMemoryStorage>;
let clients: QueryClient[] = [];
let onUnauthorized: ReturnType<typeof vi.fn<() => void>>;

function useBoard(enabled: boolean): {
  weather: ReturnType<typeof useWeather>;
  status: ReturnType<typeof useConnectionStatus>;
  errorKind: ReturnType<typeof useApiErrorKind>;
} {
  useAgenda({ from: TODAY, days: 8 });
  return {
    weather: useWeather(enabled),
    status: useConnectionStatus(),
    errorKind: useApiErrorKind(),
  };
}

function renderBoard(
  enabled: boolean,
): ReturnType<typeof renderHook<ReturnType<typeof useBoard>, boolean>> {
  const client = createQueryClient({ retry: false, onUnauthorized });
  clients.push(client);
  return renderHook(useBoard, {
    initialProps: enabled,
    wrapper: dataWrapper(
      createApiClient({ fetch: fake.fetch, token: TEST_TOKEN }),
      client,
      storage,
    ),
  });
}

beforeEach(() => {
  storage = createMemoryStorage();
  onUnauthorized = vi.fn<() => void>();
  fake = createFakeFetch();
  fake.setReplies("/api/config", {
    status: 200,
    body: { ...configFixture(), weather: true },
  });
  fake.setReplies("/api/agenda", { status: 200, body: agendaFixture() });
  fake.setReplies("/api/weather", { status: 200, body: weatherFixture() });
});

afterEach(() => {
  for (const client of clients) client.clear();
  clients = [];
  onlineManager.setOnline(true);
});

describe("weather query", () => {
  it("has its own key kind, refreshed every 30 minutes", () => {
    expect(queryKindOf(queryKeys.weather())).toBe("weather");
    expect(queryKindOf(["kidboard", "weather", "x"])).toBeUndefined();
    expect(WEATHER_REFRESH_MS).toBe(30 * 60_000);
  });

  it("never asks the API while weather is off", async () => {
    const { result } = renderBoard(false);
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(fake.count("/api/weather")).toBe(0);
    expect(result.current.weather.data).toBeUndefined();
  });

  it("loads the forecast with the access token while weather is on", async () => {
    const { result } = renderBoard(true);
    await waitFor(() => {
      expect(result.current.weather.data).toEqual(weatherFixture());
    });
    const call = fake.calls.find((c) => c.url.endsWith("/api/weather"));
    expect(new Headers(call?.init?.headers).get("Authorization")).toBe(
      `Bearer ${TEST_TOKEN}`,
    );
  });

  it.each([
    ["404 weather_off", { status: 404, body: { error: "weather_off" } }],
    ["503", { status: 503, body: { error: "weather_unavailable" } }],
    ["an invalid body", { status: 200, body: { days: "nope" } }],
  ] as const)(
    "keeps the board ready on %s (no banner, no error kind)",
    async (_name, reply) => {
      fake.setReplies("/api/weather", reply);
      const { result } = renderBoard(true);
      await waitFor(() => {
        expect(result.current.weather.isError).toBe(true);
      });
      expect(result.current.weather.error).toBeInstanceOf(ApiError);
      expect(result.current.status).toBe("ready");
      expect(result.current.errorKind).toBeUndefined();
      expect(onUnauthorized).not.toHaveBeenCalled();
    },
  );

  it("keeps the board ready when the weather request fails on the network", async () => {
    fake.setReplies("/api/weather", "network-error");
    const { result } = renderBoard(true);
    await waitFor(() => {
      expect(result.current.weather.isError).toBe(true);
    });
    expect(result.current.status).toBe("ready");
    expect(result.current.errorKind).toBeUndefined();
  });

  it("is persisted for offline and restored on the next start", async () => {
    const first = renderBoard(true);
    await waitFor(() => {
      expect(first.result.current.weather.data).toBeDefined();
    });
    await waitFor(() => {
      const raw = storage.getItem(PERSIST_STORAGE_KEY);
      const stored =
        raw === null ? undefined : (JSON.parse(raw) as PersistedClient);
      expect(
        stored?.clientState.queries.some((q) => q.queryKey[1] === "weather"),
      ).toBe(true);
    }, PERSIST_WAIT);
    first.unmount();

    // Next start without network: the restored forecast is there.
    fake.setReplies("/api/weather", "network-error");
    const second = renderBoard(true);
    await waitFor(() => {
      expect(second.result.current.weather.data).toEqual(weatherFixture());
    });
  });
});

describe("weather persistence", () => {
  const base = {
    queryKey: queryKeys.weather(),
    queryHash: JSON.stringify(queryKeys.weather()),
    dehydratedAt: Date.now(),
  };
  const stateOf = (
    data: unknown,
  ): PersistedClient["clientState"]["queries"][number]["state"] => ({
    data,
    dataUpdateCount: 1,
    dataUpdatedAt: Date.now(),
    error: null,
    errorUpdateCount: 0,
    errorUpdatedAt: 0,
    fetchFailureCount: 0,
    fetchFailureReason: null,
    fetchMeta: null,
    isInvalidated: false,
    status: "success",
    fetchStatus: "idle",
  });
  const persisted = (data: unknown): PersistedClient => ({
    timestamp: Date.now(),
    buster: PERSIST_BUSTER,
    clientState: {
      queries: [{ ...base, state: stateOf(data) }],
      mutations: [],
    },
  });

  it("restores a valid forecast", () => {
    const restored = deserializePersistedClient(
      serializePersistedClient(persisted(weatherFixture())),
    );
    expect(restored.clientState.queries[0]?.state.data).toEqual(
      weatherFixture(),
    );
  });

  it("drops a stored forecast that no longer matches the schema", () => {
    const restored = deserializePersistedClient(
      serializePersistedClient(
        persisted({ ...weatherFixture(), unit: "kelvin" }),
      ),
    );
    expect(restored.clientState.queries).toHaveLength(0);
  });
});
