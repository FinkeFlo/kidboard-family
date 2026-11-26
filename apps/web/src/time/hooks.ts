import { todayInZone } from "@kidboard/shared";
import { useCallback, useSyncExternalStore } from "react";

import { startOfMinute } from "./clock";
import { minuteClock } from "./minuteClock";

/*
 * Before the config has loaded there is no time zone. These hooks do not guess one
 * (a default such as `Europe/Berlin` would show, and fetch, the wrong day for a family
 * elsewhere and then jump): they take `timeZone: string | undefined` and return
 * `undefined` until it is known. Views gate on that and render their loading state;
 * the config is restored from the persisted cache at startup, so in practice the gate
 * only applies to the very first visit (see ARCHITECTURE.md "Clock & day rollover").
 */

const minuteSnapshot = (): number => startOfMinute(Date.now());

/**
 * Current time (epoch ms), floored to the minute. Re-renders at every minute
 * boundary and when the page becomes visible again (see `createMinuteClock`); the
 * value is always recomputed from `Date.now()`.
 */
export function useNow(): number {
  return useSyncExternalStore(
    minuteClock.subscribe,
    minuteSnapshot,
    minuteSnapshot,
  );
}

/**
 * Today's date key (`YYYY-MM-DD`) in `timeZone`, or `undefined` while the zone is not
 * known (config not loaded). Changes exactly at local midnight of `timeZone`, whatever
 * the device zone, also across DST nights, and right after a tab that slept across
 * midnight becomes visible. Re-renders only when the date changes.
 */
export function useToday(timeZone: string | undefined): string | undefined {
  const snapshot = useCallback(
    (): string | undefined =>
      timeZone === undefined ? undefined : todayInZone(Date.now(), timeZone),
    [timeZone],
  );
  return useSyncExternalStore(minuteClock.subscribe, snapshot, snapshot);
}
