import { useEffect, useState } from "react";

/**
 * `true` once `active` has been continuously true for `delayMs`; `false` at once when
 * it turns false. Keeps short-lived conditions (e.g. the brief `stale` after midnight
 * while the new day is fetched) from flashing on a wall display.
 */
export function useSettled(active: boolean, delayMs: number): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!active) return undefined;
    const id = setTimeout(() => {
      setSettled(true);
    }, delayMs);
    return () => {
      clearTimeout(id);
      setSettled(false);
    };
  }, [active, delayMs]);
  return active && settled;
}
