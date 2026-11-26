import { useWakeLock } from "./useWakeLock";

/**
 * Kiosk side effects that must outlive a render crash. Rendered beside (not inside) the
 * app's error boundary: while the fallback shows (its backoff reaches minutes), the
 * screen must stay on, or the tablet sleeps and a later reset cannot take the lock again
 * from a hidden page. Renders nothing.
 */
export function KioskEffects(): null {
  useWakeLock();
  return null;
}
