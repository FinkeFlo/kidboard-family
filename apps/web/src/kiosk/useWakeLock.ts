import { useEffect } from "react";

/** First retry after a rejected request; doubles up to {@link WAKE_LOCK_RETRY_MAX_MS}. */
export const WAKE_LOCK_RETRY_BASE_MS = 10_000;
export const WAKE_LOCK_RETRY_MAX_MS = 120_000;

/**
 * Keeps the screen on (Screen Wake Lock API) while the page is visible. The browser
 * releases the lock whenever the page is hidden, and the system may also release it
 * while the page stays visible (power saver, ...). A kiosk almost never sees a
 * `visibilitychange`, so the lock is re-requested from the `release` event itself, on
 * `visibilitychange` and on `focus`. A rejected request (low battery, policy, ...) is
 * retried by one timer with a bounded, doubling delay (no hot loop); a missing API is a
 * silent no-op.
 */
export function useWakeLock(): void {
  useEffect(() => {
    // `navigator.wakeLock` is missing in older browsers and on insecure origins; the
    // DOM typings declare it as always present, hence the widened type.
    const wakeLock = (navigator as { wakeLock?: WakeLock }).wakeLock;
    if (typeof wakeLock?.request !== "function") return undefined;

    const life = { disposed: false };
    // A call, so the check after `await` is not narrowed to the value before it.
    const isDisposed = (): boolean => life.disposed;
    let sentinel: WakeLockSentinel | undefined;
    let pending = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = WAKE_LOCK_RETRY_BASE_MS;

    const clearRetry = (): void => {
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
    };

    const acquire = async (): Promise<void> => {
      if (isDisposed() || pending || sentinel !== undefined) return;
      if (document.visibilityState !== "visible") return;
      clearRetry();
      pending = true;
      try {
        const next = await wakeLock.request("screen");
        if (isDisposed()) {
          await next.release().catch(() => undefined);
          return;
        }
        retryDelay = WAKE_LOCK_RETRY_BASE_MS;
        next.addEventListener("release", onRelease, { once: true });
        sentinel = next;
      } catch {
        // NotAllowedError (low battery, policy, no permission): the board works
        // without it; one bounded timer tries again.
        if (!isDisposed()) {
          retryTimer = setTimeout(() => {
            retryTimer = undefined;
            void acquire();
          }, retryDelay);
          retryDelay = Math.min(retryDelay * 2, WAKE_LOCK_RETRY_MAX_MS);
        }
      } finally {
        pending = false;
      }
    };

    function onRelease(): void {
      // Released by the system: drop it and ask again right away if still visible.
      sentinel = undefined;
      void acquire();
    }

    const trigger = (): void => {
      void acquire();
    };

    document.addEventListener("visibilitychange", trigger);
    window.addEventListener("focus", trigger);
    void acquire();

    return () => {
      life.disposed = true;
      clearRetry();
      document.removeEventListener("visibilitychange", trigger);
      window.removeEventListener("focus", trigger);
      const held = sentinel;
      sentinel = undefined;
      if (held !== undefined) {
        held.removeEventListener("release", onRelease);
        void held.release().catch(() => undefined);
      }
    };
  }, []);
}
