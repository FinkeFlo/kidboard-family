import { createContext, useContext } from "react";

import type { ApiClient } from "./apiClient";

/** The app's {@link ApiClient}; provided by `DataProvider`. */
export const ApiClientContext = createContext<ApiClient | null>(null);

/** The {@link ApiClient} from context; throws outside `DataProvider` (programming error). */
export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (client === null) {
    throw new Error("useApiClient must be used inside <DataProvider>");
  }
  return client;
}
