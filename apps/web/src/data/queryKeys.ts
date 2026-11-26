import type { AgendaRange } from "./apiClient";

/** Root of every KidBoard query key (also the persistence filter). */
export const QUERY_ROOT = "kidboard";

/**
 * Query keys. They contain only public request parameters, never the access token,
 * so nothing secret ends up in the persisted cache.
 */
export const queryKeys = {
  config: (): readonly ["kidboard", "config"] => [QUERY_ROOT, "config"],
  agenda: (
    range: AgendaRange,
  ): readonly ["kidboard", "agenda", string, number] => [
    QUERY_ROOT,
    "agenda",
    range.from,
    range.days,
  ],
  /**
   * Agenda whose range is not known yet (config or persisted cache still loading). It
   * never fetches and never has data; it exists so that the connection status counts
   * the agenda as "needed but missing" (`loading`/`offline`) during that time.
   */
  agendaPending: (): readonly ["kidboard", "agenda", "pending"] => [
    QUERY_ROOT,
    "agenda",
    "pending",
  ],
  /** `/api/weather` (T-49): one forecast per board, no parameters (the place stays on the worker). */
  weather: (): readonly ["kidboard", "weather"] => [QUERY_ROOT, "weather"],
};

export type QueryKind = "config" | "agenda" | "agendaPending" | "weather";

/** Which KidBoard query a key belongs to, `undefined` for foreign keys. */
export function queryKindOf(
  queryKey: readonly unknown[],
): QueryKind | undefined {
  if (queryKey[0] !== QUERY_ROOT) {
    return undefined;
  }
  if (queryKey[1] === "config" && queryKey.length === 2) {
    return "config";
  }
  if (
    queryKey[1] === "agenda" &&
    queryKey.length === 4 &&
    typeof queryKey[2] === "string" &&
    typeof queryKey[3] === "number"
  ) {
    return "agenda";
  }
  if (
    queryKey[1] === "agenda" &&
    queryKey.length === 3 &&
    queryKey[2] === "pending"
  ) {
    return "agendaPending";
  }
  if (queryKey[1] === "weather" && queryKey.length === 2) {
    return "weather";
  }
  return undefined;
}
