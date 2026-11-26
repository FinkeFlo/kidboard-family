import type { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { type ReactNode, useEffect, useMemo } from "react";

import { applyLocale } from "../i18n";
import type { ApiClient } from "./apiClient";
import { ApiClientContext } from "./apiContext";
import { createPersistOptions } from "./persister";
import { useConfig } from "./queries";
import { invalidateRestoredQueries } from "./queryClient";
import type { KeyValueStorage } from "./storage";

export interface DataProviderProps {
  apiClient: ApiClient;
  queryClient: QueryClient;
  /** Storage for the persisted cache; `undefined` disables persistence. */
  storage: KeyValueStorage | undefined;
  children?: ReactNode;
}

/** Applies the config `locale` (T-12) whenever the config (restored or fetched) changes. */
function ConfigLocaleSync(): null {
  const locale = useConfig().data?.locale;
  useEffect(() => {
    if (locale !== undefined) {
      applyLocale(locale);
    }
  }, [locale]);
  return null;
}

/**
 * Data layer root (ADR-0006): TanStack Query with the localStorage persister, the API
 * client in context, and the config locale applied to i18n. After restoring, every
 * KidBoard query is refetched once ({@link invalidateRestoredQueries}). The config query is
 * always mounted here, so it is part of the connection status from the start.
 */
export function DataProvider({
  apiClient,
  queryClient,
  storage,
  children,
}: DataProviderProps): React.JSX.Element {
  const persistOptions = useMemo(
    () => createPersistOptions(storage),
    [storage],
  );
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
      // A page load always asks the API once, whatever the age of the restored data.
      onSuccess={() => invalidateRestoredQueries(queryClient)}
    >
      <ApiClientContext value={apiClient}>
        <ConfigLocaleSync />
        {children}
      </ApiClientContext>
    </PersistQueryClientProvider>
  );
}
