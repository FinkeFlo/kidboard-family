// First: configures zod before any schema is constructed (see zodConfig.ts).
import "./zodConfig";
import "@fontsource-variable/nunito";
import "./styles/global.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import { App } from "./App";
import { AppShell } from "./AppShell";
import {
  consumeAccessToken,
  createApiClient,
  createQueryClient,
  DataProvider,
  forgetAccessToken,
  getLocalStorage,
  seedOnlineState,
} from "./data";
import { initI18n } from "./i18n";
import { registerServiceWorker } from "./pwa/registerServiceWorker";

// Browser language until the config arrives; `DataProvider` then applies its locale.
initI18n();

const storage = getLocalStorage();
const apiClient = createApiClient({ token: consumeAccessToken({ storage }) });
seedOnlineState();
const queryClient = createQueryClient({
  // A 401 means the token was revoked or is wrong: a new `?key=` link is needed.
  onUnauthorized: () => {
    forgetAccessToken(storage);
  },
});

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

createRoot(container).render(
  <StrictMode>
    <AppShell>
      <DataProvider
        apiClient={apiClient}
        queryClient={queryClient}
        storage={storage}
      >
        <App />
      </DataProvider>
    </AppShell>
  </StrictMode>,
);

// Only in production builds: the dev server serves no service worker (ADR-0006).
if (import.meta.env.PROD) {
  registerServiceWorker({ registerSW });
}
