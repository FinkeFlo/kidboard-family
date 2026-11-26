import { msUntilNextMinute } from "./clock";

/** Subscription to minute boundaries, see {@link createMinuteClock}. */
export interface MinuteClock {
  /** Registers `listener`; returns the unsubscribe function. */
  readonly subscribe: (listener: () => void) => () => void;
}

/** Event source for "the page may have slept" signals. */
type EventSource = Pick<
  EventTarget,
  "addEventListener" | "removeEventListener"
>;

export interface MinuteClockEnv {
  /** Wall clock (epoch ms); default `Date.now`, looked up per call. */
  now?: () => number;
  /** `document` (for `visibilitychange`); `undefined` outside the browser. */
  document?: (EventSource & Pick<Document, "visibilityState">) | undefined;
  /** `window` (for `pageshow` after the back/forward cache); `undefined` outside it. */
  window?: EventSource | undefined;
}

/**
 * Notifies its listeners at every minute boundary and whenever the page becomes
 * visible again. Consumers read the time themselves (`Date.now()`), so the clock never
 * accumulates intervals:
 *
 * - One `setTimeout` chain for all listeners, each delay computed afresh from
 *   `now()` to the next minute boundary. A timer that fires late (throttled
 *   background tab, busy main thread) or early, or a system clock jump, is corrected
 *   at the next firing at the latest (≤ 60 s).
 * - `visibilitychange` (to `visible`) and `pageshow` notify at once and restart the
 *   chain: a tab that slept across midnight shows the new day as soon as it wakes.
 * - The timer and the event listeners only exist while there are listeners.
 *
 * Timer functions are looked up on `globalThis` per call, so fake timers installed
 * after module load are honoured.
 */
export function createMinuteClock(env: MinuteClockEnv = {}): MinuteClock {
  const now = env.now ?? ((): number => Date.now());
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const notify = (): void => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const schedule = (): void => {
    if (timer !== undefined) {
      globalThis.clearTimeout(timer);
    }
    timer = globalThis.setTimeout(() => {
      timer = undefined;
      notify();
      if (listeners.size > 0) {
        schedule();
      }
    }, msUntilNextMinute(now()));
  };

  const wake = (): void => {
    if (
      env.document !== undefined &&
      env.document.visibilityState !== "visible"
    ) {
      return;
    }
    notify();
    if (listeners.size > 0) {
      schedule();
    }
  };

  const start = (): void => {
    env.document?.addEventListener("visibilitychange", wake);
    env.window?.addEventListener("pageshow", wake);
    schedule();
  };

  const stop = (): void => {
    env.document?.removeEventListener("visibilitychange", wake);
    env.window?.removeEventListener("pageshow", wake);
    if (timer !== undefined) {
      globalThis.clearTimeout(timer);
      timer = undefined;
    }
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      if (listeners.size === 1) {
        start();
      }
      return () => {
        if (listeners.delete(listener) && listeners.size === 0) {
          stop();
        }
      };
    },
  };
}

/** The app-wide minute clock (one timer for all `useNow`/`useToday` consumers). */
export const minuteClock: MinuteClock = createMinuteClock({
  document: typeof document === "undefined" ? undefined : document,
  window: typeof window === "undefined" ? undefined : window,
});
