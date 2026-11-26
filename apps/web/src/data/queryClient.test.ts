import { onlineManager, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./apiClient";
import {
  createQueryClient,
  invalidateRestoredQueries,
  MAX_RETRIES,
  PERSIST_MAX_AGE_MS,
  refreshIntervalMs,
  seedOnlineState,
  shouldRetry,
  STALE_TIME_MS,
} from "./queryClient";
import { queryKeys } from "./queryKeys";

describe("shouldRetry", () => {
  it.each(["network", "timeout", "upstream", "server"] as const)(
    "retries transient %s errors up to MAX_RETRIES",
    (kind) => {
      const error = new ApiError(kind, "/api/agenda");
      expect(shouldRetry(0, error)).toBe(true);
      expect(shouldRetry(MAX_RETRIES - 1, error)).toBe(true);
      expect(shouldRetry(MAX_RETRIES, error)).toBe(false);
    },
  );

  it.each(["unauthorized", "bad-request", "invalid-response"] as const)(
    "never retries deterministic %s errors",
    (kind) => {
      expect(shouldRetry(0, new ApiError(kind, "/api/config"))).toBe(false);
    },
  );

  it("retries other HTTP statuses only for 429 and 5xx", () => {
    expect(shouldRetry(0, new ApiError("http", "/api/agenda", 429))).toBe(true);
    expect(shouldRetry(0, new ApiError("http", "/api/agenda", 503))).toBe(true);
    expect(shouldRetry(0, new ApiError("http", "/api/agenda", 404))).toBe(
      false,
    );
    expect(shouldRetry(0, new ApiError("http", "/api/agenda", 403))).toBe(
      false,
    );
    expect(shouldRetry(0, new ApiError("http", "/api/agenda"))).toBe(false);
  });

  it("never retries unknown errors", () => {
    expect(shouldRetry(0, new Error("boom"))).toBe(false);
  });
});

describe("refreshIntervalMs", () => {
  it("converts refreshMinutes and defaults to 60 min", () => {
    expect(refreshIntervalMs(30)).toBe(30 * 60_000);
    expect(refreshIntervalMs(undefined)).toBe(60 * 60_000);
  });
});

describe("createQueryClient", () => {
  it("applies the ADR-0006 defaults", () => {
    const queries = createQueryClient().getDefaultOptions().queries;
    expect(queries?.gcTime).toBe(PERSIST_MAX_AGE_MS);
    expect(PERSIST_MAX_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(queries?.staleTime).toBe(STALE_TIME_MS);
    expect(STALE_TIME_MS).toBe(15 * 60 * 1000);
    expect(queries?.refetchOnWindowFocus).toBe(true);
    expect(queries?.refetchOnReconnect).toBe(true);
    expect(queries?.retry).toBe(shouldRetry);
  });

  it("can disable retries", () => {
    expect(
      createQueryClient({ retry: false }).getDefaultOptions().queries?.retry,
    ).toBe(false);
  });
});

describe("401 wipe", () => {
  const AGENDA_KEY = ["kidboard", "agenda", "2026-11-22", 31] as const;
  const CONFIG_KEY = ["kidboard", "config"] as const;
  const unauthorized = (): Promise<never> =>
    Promise.reject(new ApiError("unauthorized", "/api/config", 401));

  it("drops all KidBoard data, keeps foreign queries and calls onUnauthorized", async () => {
    const onUnauthorized = vi.fn();
    const client = createQueryClient({ retry: false, onUnauthorized });
    client.setQueryData(AGENDA_KEY, { events: ["Swimming"] });
    client.setQueryData(["other"], "kept");
    await client
      .query({ queryKey: CONFIG_KEY, queryFn: unauthorized })
      .catch(() => undefined);
    expect(client.getQueryData(AGENDA_KEY)).toBeUndefined();
    expect(client.getQueryState(AGENDA_KEY)?.status).toBe("error");
    expect(client.getQueryData(["other"])).toBe("kept");
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("an in-flight refetch cancelled afterwards does not bring the wiped data back", async () => {
    const client = createQueryClient({ retry: false });
    client.setQueryData(AGENDA_KEY, { events: ["Swimming"] });
    // A refetch that consumes the abort signal: when its last observer leaves (the board
    // switches to the pending agenda once the config is gone), TanStack cancels it with
    // `revert`, which would restore the state from before the fetch, i.e. the old data.
    const observer = new QueryObserver(client, {
      queryKey: AGENDA_KEY,
      staleTime: 0,
      queryFn: ({ signal }) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    });
    const unsubscribe = observer.subscribe(() => undefined);
    expect(client.getQueryState(AGENDA_KEY)?.fetchStatus).toBe("fetching");

    await client
      .query({ queryKey: CONFIG_KEY, queryFn: unauthorized })
      .catch(() => undefined);
    unsubscribe();
    await Promise.resolve();

    const state = client.getQueryState(AGENDA_KEY);
    expect(state?.data).toBeUndefined();
    expect(state?.status).toBe("error");
    expect(state?.fetchStatus).toBe("idle");
  });
});

describe("seedOnlineState", () => {
  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it("starts offline when the device boots without network", () => {
    seedOnlineState(() => false);
    expect(onlineManager.isOnline()).toBe(false);
    seedOnlineState(() => true);
    expect(onlineManager.isOnline()).toBe(true);
  });

  it("reads navigator.onLine by default", () => {
    seedOnlineState();
    expect(onlineManager.isOnline()).toBe(navigator.onLine);
  });
});

describe("invalidateRestoredQueries", () => {
  it("marks every KidBoard query outdated without fetching or touching its data", async () => {
    const client = createQueryClient({ retry: false });
    const updatedAt = Date.now() - 60_000;
    client.setQueryData(queryKeys.config(), { locale: "en" }, { updatedAt });
    const agendaKey = queryKeys.agenda({ from: "2026-11-22", days: 31 });
    client.setQueryData(agendaKey, { events: [] }, { updatedAt });
    client.setQueryData(["other"], 1, { updatedAt });
    const queryFn = vi.fn(() => Promise.resolve({ locale: "de" }));

    await invalidateRestoredQueries(client);

    const state = (key: readonly unknown[]) =>
      client.getQueryCache().find({ queryKey: key, exact: true })?.state;
    expect(state(queryKeys.config())?.isInvalidated).toBe(true);
    expect(state(agendaKey)?.isInvalidated).toBe(true);
    expect(state(["other"])?.isInvalidated).toBe(false);
    // Data and the time of the last successful fetch stay as restored.
    expect(state(queryKeys.config())?.data).toEqual({ locale: "en" });
    expect(state(agendaKey)?.dataUpdatedAt).toBe(updatedAt);
    expect(state(agendaKey)?.fetchStatus).toBe("idle");

    // A new observer (the board mounting) refetches although the data is younger than
    // staleTime.
    const observer = new QueryObserver(client, {
      queryKey: queryKeys.config(),
      queryFn,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    expect(queryFn).toHaveBeenCalledTimes(1);
    unsubscribe();
    client.clear();
  });
});
