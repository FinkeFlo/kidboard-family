import type { RegisterSWOptions } from "vite-plugin-pwa/types";

/** How often the kiosk looks for a new service worker (no navigations happen there). */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface RegisterServiceWorkerDeps {
  /** `registerSW` from `virtual:pwa-register` (injected for tests). */
  readonly registerSW: (options: RegisterSWOptions) => unknown;
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
  readonly isOnline?: () => boolean;
  readonly intervalMs?: number;
  readonly onError?: (error: unknown) => void;
}

/**
 * Register the service worker and check for updates every hour.
 *
 * `registerType: 'autoUpdate'` makes a new worker skip waiting and claim the page, and
 * `virtual:pwa-register` then reloads the page by itself: no user interaction is needed
 * on the kiosk. Browsers only look for a new `sw.js` on navigations (and roughly daily),
 * a wall tablet never navigates, so we poll. The check is skipped while offline or while
 * a worker is installing, and `sw.js` is probed first so a failing server does not make
 * `registration.update()` reject (pattern from the vite-plugin-pwa docs).
 */
export function registerServiceWorker(deps: RegisterServiceWorkerDeps): void {
  const fetchScript = deps.fetch ?? ((url, init) => fetch(url, init));
  const isOnline = deps.isOnline ?? (() => navigator.onLine);
  const intervalMs = deps.intervalMs ?? UPDATE_CHECK_INTERVAL_MS;
  const onError =
    deps.onError ??
    ((error: unknown) => {
      console.warn("Service worker update check failed", error);
    });

  const checkForUpdate = async (
    swUrl: string,
    registration: ServiceWorkerRegistration,
  ): Promise<void> => {
    if (registration.installing || !isOnline()) {
      return;
    }
    const response = await fetchScript(swUrl, {
      cache: "no-store",
      headers: { cache: "no-store", "cache-control": "no-cache" },
    });
    if (response.status === 200) {
      await registration.update();
    }
  };

  deps.registerSW({
    immediate: true,
    onRegisteredSW(swUrl, registration) {
      if (!registration) {
        return;
      }
      setInterval(() => {
        checkForUpdate(swUrl, registration).catch(onError);
      }, intervalMs);
    },
    onRegisterError(error: unknown) {
      console.warn("Service worker registration failed", error);
    },
  });
}
