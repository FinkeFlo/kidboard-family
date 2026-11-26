import { useEffect, useRef } from "react";

/** Input that counts as "someone is using the board". */
const ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "touchstart",
  "keydown",
] as const;

/**
 * Calls `onReturn` once after `seconds` without pointer, touch or keyboard activity while
 * `enabled`. Every activity restarts the countdown; disabling (or unmounting) cancels it.
 * Enabling counts as activity, so the countdown starts when the view is opened.
 */
export function useAutoReturn(
  enabled: boolean,
  seconds: number,
  onReturn: () => void,
): void {
  // Latest callback without restarting the countdown when its identity changes.
  const callback = useRef(onReturn);
  useEffect(() => {
    callback.current = onReturn;
  }, [onReturn]);

  useEffect(() => {
    if (!enabled) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const restart = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        callback.current();
      }, seconds * 1000);
    };
    restart();
    for (const name of ACTIVITY_EVENTS) {
      document.addEventListener(name, restart, {
        capture: true,
        passive: true,
      });
    }
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      for (const name of ACTIVITY_EVENTS) {
        document.removeEventListener(name, restart, { capture: true });
      }
    };
  }, [enabled, seconds]);
}
