import { useTranslation } from "react-i18next";

import { Emoji } from "./Emoji";

export type ErrorCardVariant = "error" | "unauthorized";

export interface ErrorCardProps {
  /**
   * `error`: soft error card ("Gleich geht's weiter") with a retry button.
   * `unauthorized`: the calm variant for an access link that is no longer valid; a parent
   * has to set up a new one, so there is nothing to retry and no alarm colour.
   */
  variant: ErrorCardVariant;
  /** Big friendly line for children. */
  title: string;
  /** One sentence for parents. Never a raw error message. */
  parentLine: string;
  /** Short error code ({@link errorCode}), shown small below the card. */
  code: string;
  /** Retry at once (reset the boundary or refetch); omit to hide the button. */
  onRetry?: (() => void) | undefined;
  /** Live-region role of the card; `undefined` keeps it silent (e.g. a repeat failure). */
  role?: "alert" | "status" | undefined;
  /** Test hook on the card's `<main>`. */
  "data-testid"?: string;
  /** What failed (`data-error` on the card's `<main>`), for tests and styling hooks. */
  dataError?: string;
}

/**
 * Full-screen friendly error state (design hand-off: EmptyState / Error): 🧸, a calm title
 * for children, one line for parents, a "reload now" button of at least 64px and a short
 * error code. No red surfaces, no warning icons, no raw error text, and no fixed retry
 * seconds (the caller's backoff decides when it tries again). Presentational: the caller
 * owns the retry logic.
 */
export function ErrorCard({
  variant,
  title,
  parentLine,
  code,
  onRetry,
  role,
  "data-testid": testId,
  dataError,
}: ErrorCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const surface =
    variant === "error"
      ? "bg-soft-error"
      : "bg-surface-raised inset-ring-border inset-ring-2";
  return (
    <main
      role={role}
      data-testid={testId}
      data-error={dataError}
      data-variant={variant}
      className="bg-surface text-text p-page gap-gutter flex h-full flex-col items-center justify-center text-center"
    >
      <div
        className={`${surface} rounded-column p-page gap-gutter flex w-full max-w-[36rem] flex-col items-center`}
      >
        <Emoji emoji="🧸" className="text-[5rem]" />
        <h1 className="text-title">{title}</h1>
        <p className="text-body text-text-muted max-w-prose font-bold">
          {parentLine}
        </p>
        {onRetry !== undefined && (
          <button
            type="button"
            onClick={onRetry}
            className="bg-nav-active text-on-nav-active text-title rounded-pill min-h-touch min-w-touch px-page focus-visible:outline-text font-black focus-visible:outline-4 focus-visible:outline-offset-4"
          >
            {t("error.retry")}
          </button>
        )}
      </div>
      <p data-testid="error-code" className="text-caption text-text-muted">
        {t("error.code", { code })}
      </p>
    </main>
  );
}
