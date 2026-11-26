import type { Child } from "@kidboard/shared";
import { useTranslation } from "react-i18next";

import { resolveChildTint } from "../components/childTint";
import { Emoji } from "../components/Emoji";
import { ErrorCard } from "../components/ErrorCard";
import { errorCode } from "../components/errorCode";
import { CheckIcon } from "../components/TimeOfDayIcon";
import { type ApiErrorKind, useRetryNow } from "../data";

/** Tile placeholders per skeleton column: today first, then the next three days. */
const SKELETON_TILES = [3, 2, 2, 1] as const;

/** One placeholder column: a heading bar, `tiles` tile blocks and the meal strip. */
function SkeletonColumn({
  tiles,
  today,
}: {
  tiles: number;
  today: boolean;
}): React.JSX.Element {
  // Today is raised with the ring and sunken blocks; the other days the other way round.
  const column = today
    ? "bg-surface-raised ring-today-ring shadow-raised ring-[5px]"
    : "bg-surface-sunken";
  const heading = today ? "bg-surface-sunken" : "bg-border";
  const block = today ? "bg-surface-sunken" : "bg-surface-raised";
  const height = today ? "h-tile" : "h-tile-compact";
  return (
    <div
      data-testid="skeleton-column"
      className={`${column} rounded-column flex min-h-0 min-w-0 flex-col gap-2.5 overflow-hidden p-3.5`}
    >
      <div className={`${heading} rounded-chip h-6 w-1/2 shrink-0`} />
      {Array.from({ length: tiles }, (_, n) => (
        <div key={n} className={`${block} rounded-tile ${height} shrink-0`} />
      ))}
      <div className={`${block} rounded-tile mt-auto h-16 shrink-0`} />
    </div>
  );
}

/**
 * Calm skeleton while nothing is known yet: the overview's header, four columns (today
 * raised and widest) and the rail, in surface tokens, plus "Der Tag wird geholt …" with
 * a sun in the bottom strip. No spinner and no animation at all (nothing moves, so it is
 * calm and reduced motion has nothing to reduce). Same frame paddings as `BoardFrame`
 * (its bottom strip is the touch height plus the burn-in room), so the board replaces it
 * without a jump.
 */
export function DayLoading(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <main
      aria-busy="true"
      data-testid="board-loading"
      className="bg-surface text-text p-gutter flex h-full flex-col pb-0"
    >
      <div aria-hidden="true" className="gap-gutter flex min-h-0 flex-1">
        <div className="gap-gutter flex min-w-0 flex-1 flex-col">
          <div className="gap-gutter flex h-20 shrink-0 items-center justify-between">
            <div className="bg-surface-sunken rounded-column h-14 w-1/4" />
            <div className="bg-surface-sunken rounded-pill h-12 w-1/4" />
          </div>
          <div
            data-testid="skeleton-columns"
            className="gap-gutter grid min-h-0 flex-1 grid-cols-[2fr_1fr_1fr_1fr] grid-rows-[minmax(0,1fr)]"
          >
            {SKELETON_TILES.map((tiles, index) => (
              <SkeletonColumn key={index} tiles={tiles} today={index === 0} />
            ))}
          </div>
        </div>
        <div className="w-nav flex shrink-0 flex-col gap-3">
          <div className="bg-surface-sunken rounded-nav h-30" />
          <div className="bg-surface-sunken rounded-nav h-30" />
        </div>
      </div>
      <p
        role="status"
        className="h-touch mt-burn-in text-title text-text-muted flex shrink-0 items-center justify-center gap-3"
      >
        <Emoji emoji="☀️" className="text-heading" />
        {t("day.loading")}
      </p>
    </main>
  );
}

/**
 * Today with nothing planned (design hand-off: EmptyState): two discs in the children's
 * tints, a sun disc, 🧸 and 🪁, "Heute ist nichts geplant" and "Zeit zum Spielen". Sits
 * inside today's column; the meals stay visible below. Decorative except for the text.
 */
export function DayEmpty({
  childList,
}: {
  childList: readonly Child[];
}): React.JSX.Element {
  const { t } = useTranslation();
  // The first two children's tints; without children the first two palette tints.
  const tints = [0, 1].map((index) =>
    resolveChildTint(childList[index] ?? `child-${String(index + 1)}`),
  );
  return (
    <div
      data-testid="day-empty"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-hidden text-center"
    >
      <div
        aria-hidden="true"
        data-testid="day-empty-art"
        // rem sizes: they scale with the fluid root, like the rest of the board.
        className="relative h-40 w-48 shrink-0"
      >
        <span
          style={{ backgroundColor: tints[0] }}
          className="rounded-pill absolute start-0 bottom-0 size-32"
        />
        <span
          style={{ backgroundColor: tints[1] }}
          className="rounded-pill absolute end-0 top-0 size-23"
        />
        {/* Decorative sun disc at 55 % (no text on it). */}
        <span className="bg-sun rounded-pill absolute start-26 bottom-1 size-12 opacity-55" />
        <span className="absolute start-0 bottom-0 flex size-32 items-center justify-center">
          <Emoji emoji="🧸" className="text-[4.5rem]" />
        </span>
        <span className="absolute end-0 top-0 flex size-23 items-center justify-center">
          <Emoji emoji="🪁" className="text-[3.25rem]" />
        </span>
      </div>
      <h3 className="text-title">{t("day.empty.title")}</h3>
      <p className="text-body text-text-muted">{t("day.empty.hint")}</p>
    </div>
  );
}

/**
 * Height in rem {@link DayDone} needs in today's list (its own height plus the list gap);
 * with less free space it is left out (the "done" strip still says it).
 */
export const DONE_MIN_REM = 8;

/**
 * Today after its last event: a large check mark on a quiet disc and "All done!", in the
 * free space below the "done" strip, so the column does not end in a void. Icon-first
 * (the check is the "done" sign of the strip, large); never a moon (merge rule 1: 🌙
 * counts sleeps). Only shown while nothing of today is still to come.
 */
export function DayDone(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      data-testid="day-done"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-hidden text-center"
    >
      <span
        aria-hidden="true"
        className="bg-surface-sunken text-text rounded-pill inset-ring-border grid size-20 shrink-0 place-items-center inset-ring-2"
      >
        <CheckIcon className="size-12" />
      </span>
      <p className="text-title">{t("day.done")}</p>
    </div>
  );
}

/**
 * Another day of the overview with nothing planned: a small kite (the playful sign of
 * {@link DayEmpty}, quieter) and "Nothing planned", so the column is not blank.
 */
export function DayFree(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      data-testid="day-free"
      className="text-text-muted flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-hidden text-center"
    >
      <span
        aria-hidden="true"
        className="bg-surface-raised rounded-pill grid size-16 shrink-0 place-items-center"
      >
        <Emoji emoji="🪁" className="text-[2.25rem]" />
      </span>
      <p className="text-meta">{t("day.free")}</p>
    </div>
  );
}

export type DayErrorKind = "unauthorized" | "offline" | "failed";

/**
 * Nothing to show and no cached state: the friendly {@link ErrorCard}. `failed` and
 * `offline`: 🧸 "Gleich geht's weiter", one line for parents and a "reload now" button
 * that refetches at once (the data layer keeps retrying on its own as well); `failed`
 * shows the API failure's code (`KB-502`, …). `unauthorized`: the calm variant ("this
 * tablet needs a new access link", no technical details; the `KB-401` code is for
 * parents), no retry, no alarm colour; the 401 wipe already forgot the token.
 */
export function DayError({
  kind,
  apiError,
}: {
  kind: DayErrorKind;
  /** Kind of the API failure behind `failed`, for the error code. */
  apiError?: ApiErrorKind | undefined;
}): React.JSX.Element {
  const { t } = useTranslation();
  const retryNow = useRetryNow();
  if (kind === "unauthorized") {
    return (
      <ErrorCard
        variant="unauthorized"
        role="alert"
        dataError={kind}
        title={t("day.error.unauthorized.title")}
        parentLine={t("day.error.unauthorized.hint")}
        code={errorCode("unauthorized")}
      />
    );
  }
  return (
    <ErrorCard
      variant="error"
      role={kind === "offline" ? "status" : "alert"}
      dataError={kind}
      title={t("error.title")}
      parentLine={
        kind === "offline" ? t("day.error.offline") : t("day.error.failed")
      }
      code={errorCode(kind === "offline" ? "offline" : apiError)}
      onRetry={retryNow}
    />
  );
}
