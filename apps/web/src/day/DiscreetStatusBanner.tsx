import { ConnectedStatusBanner } from "../components/StatusBanner";
import { useApiErrorKind, useConnectionStatus } from "../data";
import { useSettled } from "./useSettled";

/**
 * How long `stale` must persist before the banner shows. Online, the status is `stale`
 * for a moment at every midnight (the new day is seeded from the cache until its fetch
 * lands); that must not flash. Offline, errors and `unauthorized` show at once.
 */
export const STALE_BANNER_DELAY_MS = 5000;

/**
 * {@link ConnectedStatusBanner} with the transient `stale` state debounced. `time` is when
 * the shown data was fetched, formatted ("14:02"), for "Offline · Stand von 14:02".
 */
export function DiscreetStatusBanner({
  time,
}: {
  time?: string | undefined;
} = {}): React.JSX.Element | null {
  const status = useConnectionStatus();
  const errorKind = useApiErrorKind();
  const staleOnly = status === "stale" && errorKind !== "unauthorized";
  const settled = useSettled(staleOnly, STALE_BANNER_DELAY_MS);
  if (staleOnly && !settled) return null;
  return <ConnectedStatusBanner time={time} />;
}
