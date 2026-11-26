import { onlineManager, QueryCache, QueryClient } from "@tanstack/react-query";

import { ApiError, type ApiErrorKind } from "./apiClient";
import { queryKindOf } from "./queryKeys";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** ADR-0006: persisted data (and the in-memory cache) is kept 7 days. */
export const PERSIST_MAX_AGE_MS = 7 * DAY_MS;
/** ADR-0006: data counts as fresh for 15 min (no refetch on focus before that). */
export const STALE_TIME_MS = 15 * MINUTE_MS;
/** Refetch interval until the config (`refreshMinutes`) is known. */
export const DEFAULT_REFRESH_MINUTES = 60;
/** Retries after the first failed attempt, for transient errors only. */
export const MAX_RETRIES = 2;

const TRANSIENT_KINDS: ReadonlySet<ApiErrorKind> = new Set([
  "network",
  "timeout",
  "upstream",
  "server",
]);

/**
 * Retry policy: transient failures (network, timeout, 5xx, 429) are retried up to
 * {@link MAX_RETRIES} times with TanStack's default backoff. 400/401, other 4xx and
 * schema-invalid responses are deterministic, so they fail at once.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES || !(error instanceof ApiError)) {
    return false;
  }
  if (error.kind === "http") {
    return (
      error.status !== undefined &&
      (error.status === 429 || error.status >= 500)
    );
  }
  return TRANSIENT_KINDS.has(error.kind);
}

/**
 * Seeds TanStack's `onlineManager` from `navigator.onLine`. It assumes "online" until
 * the first `online`/`offline` event, so a tablet booting without Wi-Fi would show
 * `loading` instead of `offline`.
 */
export function seedOnlineState(
  isOnline: () => boolean = () => navigator.onLine,
): void {
  onlineManager.setOnline(isOnline());
}

/**
 * Revoked or wrong access token (401): calendar data must not stay visible on a
 * device that lost access. Every KidBoard query drops its data and takes the error,
 * so the status becomes `error` and the persister writes an empty cache.
 *
 * In-flight fetches of those queries are cancelled first, without `revert`: TanStack
 * cancels a fetch with `revert` when its last observer leaves (here: the wiped config
 * turns the board's agenda into the pending query), and reverting restores the state
 * from before the fetch, i.e. the data just wiped, which the persister would then
 * write back to storage (found by the T-23 e2e test).
 */
function wipeOnUnauthorized(client: QueryClient, error: ApiError): void {
  for (const query of client.getQueryCache().getAll()) {
    if (queryKindOf(query.queryKey) !== undefined) {
      // `silent`: no revert and no extra error dispatch; the state is set right below.
      void query.cancel({ silent: true });
      query.setState({
        fetchStatus: "idle",
        data: undefined,
        dataUpdatedAt: 0,
        dataUpdateCount: 0,
        status: "error",
        error,
        errorUpdatedAt: Date.now(),
      });
    }
  }
}

/**
 * Runs once after the persisted cache was restored, i.e. on every page load: marks every
 * KidBoard query as outdated (TanStack `invalidate`, no refetch yet), so each one fetches
 * as soon as its observer subscribes, even when its restored data is younger than
 * `staleTime`. Without it a reload within 15 min of the last fetch would show the
 * restored data as `ready` without ever asking the API, so a reload while the API is
 * unreachable would look current (UI/UX test, T-27a). The restored `dataUpdatedAt` stays
 * (it is the last successful fetch: "Stand"); a failing refetch keeps the data and turns
 * the status `stale` (offline: the fetch waits for the network, the status is `offline`).
 */
export function invalidateRestoredQueries(client: QueryClient): Promise<void> {
  return client.invalidateQueries({
    predicate: (query) => queryKindOf(query.queryKey) !== undefined,
    refetchType: "none",
  });
}

/** `refreshMinutes` (config) → refetch interval in ms. */
export function refreshIntervalMs(refreshMinutes: number | undefined): number {
  return (refreshMinutes ?? DEFAULT_REFRESH_MINUTES) * MINUTE_MS;
}

export interface CreateQueryClientOptions {
  /** Disable retries (tests). */
  retry?: false;
  /** Called after a 401 wiped the data (e.g. to forget the stored token). */
  onUnauthorized?: () => void;
}

/**
 * QueryClient per ADR-0006: `gcTime` = persistence `maxAge` (7 d, so restored data is
 * not collected early), `staleTime` 15 min, refetch on focus (`visibilitychange`) and
 * reconnect (`online`). `refetchInterval` is set per query from `refreshMinutes`.
 */
export function createQueryClient(
  options: CreateQueryClientOptions = {},
): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      // Runs after the query has stored the error (query-core dispatches first).
      onError: (error) => {
        if (error instanceof ApiError && error.kind === "unauthorized") {
          wipeOnUnauthorized(client, error);
          options.onUnauthorized?.();
        }
      },
    }),
    defaultOptions: {
      queries: {
        gcTime: PERSIST_MAX_AGE_MS,
        staleTime: STALE_TIME_MS,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: options.retry ?? shouldRetry,
      },
    },
  });
  return client;
}
