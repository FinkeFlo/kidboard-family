import { useTranslation } from "react-i18next";

import {
  type ApiErrorKind,
  type ConnectionStatus,
  useApiErrorKind,
  useConnectionStatus,
} from "../data";

export interface StatusBannerProps {
  status: ConnectionStatus;
  errorKind?: ApiErrorKind | undefined;
  /**
   * When the shown data was last fetched successfully, already formatted ("14:02"), for
   * "Offline · Stand von 14:02"; `undefined` when unknown (e.g. a midnight seed): the pill
   * says less.
   */
  time?: string | undefined;
}

/** Cloud, crossed out when offline. Decorative (`currentColor`, the text says it all). */
function CloudIcon({ crossed }: { crossed: boolean }): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      data-testid={crossed ? "cloud-off-icon" : "cloud-icon"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5 shrink-0"
    >
      <path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 9.1 4.5 4.5 0 0 0 7 18Z" />
      {crossed && <path d="M3 3l18 18" />}
    </svg>
  );
}

/**
 * Notice pill in the board's bottom strip for offline, stale and error states; nothing
 * while loading or ready. "Offline · Stand von 14:02", "Aktualisieren klappt nicht · Stand
 * von 14:02" (the last refresh failed, `errorKind` set) or "Vielleicht nicht aktuell · Stand
 * von 14:02" (the worker served last-good data): the board stays fully visible, the pill
 * only says how old the shown data is (`time`: the last successful fetch). Always the
 * calm notice colours (no red): offline and stale are polite (`status`), an error and an
 * expired link (`unauthorized`, which wins in every state: a parent has to open the link
 * again) are `alert`s. No blinking.
 */
export function StatusBanner({
  status,
  errorKind,
  time,
}: StatusBannerProps): React.JSX.Element | null {
  const { t } = useTranslation();
  let message: string;
  let alert = false;
  if (errorKind === "unauthorized") {
    message = t("status.unauthorized");
    alert = true;
  } else if (status === "error") {
    message = t("status.error");
    alert = true;
  } else if (status === "offline") {
    message =
      time === undefined
        ? t("status.offlineNoTime")
        : t("status.offline", { time });
  } else if (status === "stale" && errorKind !== undefined) {
    // The last refresh itself failed (no network to the API, 5xx, …): say so plainly.
    message =
      time === undefined
        ? t("status.cantUpdateNoTime")
        : t("status.cantUpdate", { time });
  } else if (status === "stale") {
    message =
      time === undefined
        ? t("status.staleNoTime")
        : t("status.stale", { time });
  } else {
    return null;
  }
  const kind = errorKind === "unauthorized" ? "unauthorized" : status;
  return (
    <p
      role={alert ? "alert" : "status"}
      data-status={kind}
      className="bg-notice text-on-notice text-caption rounded-pill shadow-card inline-flex max-w-full items-center gap-2 px-5 py-2 font-bold"
    >
      <CloudIcon crossed={kind === "offline"} />
      <span className="min-w-0">{message}</span>
    </p>
  );
}

/** {@link StatusBanner} wired to the data layer's connection status. */
export function ConnectedStatusBanner({
  time,
}: {
  time?: string | undefined;
}): React.JSX.Element | null {
  return (
    <StatusBanner
      status={useConnectionStatus()}
      errorKind={useApiErrorKind()}
      time={time}
    />
  );
}
