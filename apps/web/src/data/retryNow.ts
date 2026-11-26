import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { QUERY_ROOT } from "./queryKeys";

/**
 * Refetches every active KidBoard query at once (config and the mounted agenda range),
 * e.g. for the error card's "reload now" button. A running fetch or a pending automatic
 * retry is replaced by a fresh attempt (`cancelRefetch`). The pending agenda placeholder
 * (`skipToken`) is disabled and never fetches; it turns into the real agenda query once
 * the config is there. Failures surface through the queries as usual (no rejection).
 */
export function retryNow(client: QueryClient): Promise<void> {
  return client.refetchQueries({ queryKey: [QUERY_ROOT], type: "active" });
}

/** {@link retryNow} bound to the current query client. */
export function useRetryNow(): () => void {
  const client = useQueryClient();
  return useCallback(() => {
    void retryNow(client);
  }, [client]);
}
