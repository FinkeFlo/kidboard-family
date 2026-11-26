import {
  addCalendarDays,
  AgendaResponseSchema,
  isDateKey,
} from "@kidboard/shared";
import {
  notifyManager,
  onlineManager,
  type Query,
  type QueryClient,
  useIsRestoring,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";

import { ApiError, type ApiErrorKind } from "./apiClient";
import { queryKindOf } from "./queryKeys";

const AgendaHealthSchema = AgendaResponseSchema.pick({
  stale: true,
  sources: true,
});

const AgendaCoverageSchema = AgendaResponseSchema.pick({ range: true });

/**
 * - `loading`: restoring the persisted cache, or the first fetch is still running.
 * - `ready`: data shown is current.
 * - `offline`: the device is offline (data shown, if any, is the last known state).
 * - `stale`: data shown, but the last refresh failed, or the worker served last-good
 *   data (`AgendaResponse.stale`) or no data at all for at least one calendar
 *   (`sources[].status === "error"`), or the agenda is a midnight seed / covers fewer
 *   days than requested ({@link isAgendaIncomplete}).
 * - `error`: a needed query has no data at all and its fetch failed.
 */
export type ConnectionStatus =
  "loading" | "ready" | "offline" | "stale" | "error";

/** What {@link deriveConnectionStatus} needs to know about one query. */
export interface QueryHealth {
  hasData: boolean;
  /** Last fetch attempt failed (`status === "error"`). */
  isError: boolean;
  /** Agenda incomplete: worker-stale, or some source failed (`status: "error"`). */
  dataStale: boolean;
}

export interface ConnectionInput {
  /** `PersistQueryClientProvider` is still restoring. */
  restoring: boolean;
  /** `onlineManager.isOnline()` (driven by `online`/`offline` events). */
  online: boolean;
  /** Health of the KidBoard queries currently in use (with observers). */
  queries: readonly QueryHealth[];
}

/**
 * Pure status rule, first match wins:
 * 1. restoring, or no query in use → `loading`
 * 2. some query without data: any of those failed → `error`; offline → `offline`;
 *    else `loading`
 * 3. offline → `offline`
 * 4. any failed refetch, worker-stale data or failed source → `stale`
 * 5. otherwise → `ready`
 */
export function deriveConnectionStatus(
  input: ConnectionInput,
): ConnectionStatus {
  if (input.restoring || input.queries.length === 0) {
    return "loading";
  }
  const missing = input.queries.filter((q) => !q.hasData);
  if (missing.length > 0) {
    if (missing.some((q) => q.isError)) {
      return "error";
    }
    return input.online ? "loading" : "offline";
  }
  if (!input.online) {
    return "offline";
  }
  if (input.queries.some((q) => q.isError || q.dataStale)) {
    return "stale";
  }
  return "ready";
}

/** True if an agenda is incomplete: served from last-good or with failed sources. */
export function isAgendaDegraded(data: unknown): boolean {
  const parsed = AgendaHealthSchema.safeParse(data);
  return (
    parsed.success &&
    (parsed.data.stale || parsed.data.sources.some((s) => s.status === "error"))
  );
}

/**
 * True if the agenda data of an agenda query is not a complete, real response for its
 * key (`[…, from, days]`):
 * - it was seeded from another range at midnight (`dataUpdatedAt === 0`, see
 *   `useAgenda`): the last known state, not a response for this range, or
 * - it covers fewer days than requested (`range.to < from + days`), e.g. a seed from a
 *   cached range that ends earlier.
 * Either way the board shows `stale` (never `ready`) until the real fetch lands.
 */
export function isAgendaIncomplete(
  queryKey: readonly unknown[],
  data: unknown,
  dataUpdatedAt: number,
): boolean {
  if (data === undefined) {
    return false;
  }
  if (dataUpdatedAt === 0) {
    return true;
  }
  const from = queryKey[2];
  const days = queryKey[3];
  const parsed = AgendaCoverageSchema.safeParse(data);
  if (
    !parsed.success ||
    typeof from !== "string" ||
    typeof days !== "number" ||
    !isDateKey(from) ||
    !Number.isInteger(days)
  ) {
    return false;
  }
  return parsed.data.range.to < addCalendarDays(from, days);
}

/**
 * Health of a cached query, `undefined` if it is not a KidBoard query in use. The weather
 * (T-49) never counts: it is optional, and its failures only hide the weather, so it
 * never turns the board `stale`/`error` nor sets {@link useApiErrorKind}.
 */
export function queryHealth(query: Query): QueryHealth | undefined {
  const kind = queryKindOf(query.queryKey);
  if (
    kind === undefined ||
    kind === "weather" ||
    query.getObserversCount() === 0
  ) {
    return undefined;
  }
  return {
    hasData: query.state.data !== undefined,
    isError: query.state.status === "error",
    dataStale:
      kind === "agenda" &&
      (isAgendaDegraded(query.state.data) ||
        isAgendaIncomplete(
          query.queryKey,
          query.state.data,
          query.state.dataUpdatedAt,
        )),
  };
}

function snapshot(client: QueryClient, restoring: boolean): ConnectionStatus {
  const queries = client
    .getQueryCache()
    .getAll()
    .flatMap((query) => {
      const health = queryHealth(query);
      return health === undefined ? [] : [health];
    });
  return deriveConnectionStatus({
    restoring,
    online: onlineManager.isOnline(),
    queries,
  });
}

/**
 * Connection status over all KidBoard queries currently in use (config and the
 * mounted agenda range), see {@link deriveConnectionStatus}. Re-renders only when the
 * derived status changes.
 */
export function useConnectionStatus(): ConnectionStatus {
  const client = useQueryClient();
  const restoring = useIsRestoring();
  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) => {
      // Cache events can fire synchronously while another component renders (a query
      // is built in render); `batchCalls` defers them like TanStack's own hooks do.
      const onChange = notifyManager.batchCalls(onStoreChange);
      const unsubscribeCache = client.getQueryCache().subscribe(onChange);
      const unsubscribeOnline = onlineManager.subscribe(onChange);
      return () => {
        unsubscribeCache();
        unsubscribeOnline();
      };
    },
    [client],
  );
  const getSnapshot = useCallback(
    (): ConnectionStatus => snapshot(client, restoring),
    [client, restoring],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function errorKindSnapshot(client: QueryClient): ApiErrorKind | undefined {
  const kinds = client
    .getQueryCache()
    .getAll()
    .flatMap((query) =>
      queryHealth(query)?.isError === true &&
      query.state.error instanceof ApiError
        ? [query.state.error.kind]
        : [],
    );
  return kinds.includes("unauthorized") ? "unauthorized" : kinds[0];
}

/**
 * Kind of the last failure of a KidBoard query in use (`unauthorized` wins), or
 * `undefined`. Lets the UI tell "access revoked" apart from an outage.
 */
export function useApiErrorKind(): ApiErrorKind | undefined {
  const client = useQueryClient();
  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) =>
      client.getQueryCache().subscribe(notifyManager.batchCalls(onStoreChange)),
    [client],
  );
  const getSnapshot = useCallback(
    (): ApiErrorKind | undefined => errorKindSnapshot(client),
    [client],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
