import { useTranslation } from "react-i18next";

import { ClockIcon } from "../components/TimeOfDayIcon";

/** Height of the now line in rem (`h-7`), for the column's capacity. */
export const NOW_LINE_REM = 1.75;

/**
 * The "now" line in today's column, all in the person-neutral `--color-now` ink: a clock
 * disc, a thick bar and a "now" pill. It sits between the events that have started and
 * the upcoming ones and moves only from tile to tile, never per minute. A separator named
 * with the time ("now, 15:18") for assistive tech; not a live region. The word stays for
 * parents; the clock and the bar carry it for children.
 */
export function NowLine({ time }: { time: string }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      role="separator"
      aria-label={t("day.nowLabel", { time })}
      data-testid="now-line"
      className="flex h-7 shrink-0 items-center gap-1.5"
    >
      <span
        aria-hidden="true"
        className="bg-now text-surface rounded-pill grid size-7 shrink-0 place-items-center"
      >
        <ClockIcon className="size-5" />
      </span>
      <span aria-hidden="true" className="bg-now rounded-pill h-1.5 flex-1" />
      <span
        aria-hidden="true"
        className="bg-now text-surface rounded-pill text-meta px-2.5 font-black"
      >
        {t("day.now")}
      </span>
    </div>
  );
}
