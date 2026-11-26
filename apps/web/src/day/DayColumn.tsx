import type { Child } from "@kidboard/shared";
import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import { EventTile, showsBring } from "../components/EventTile";
import {
  type FormatContext,
  formatDayMonth,
  formatDayMonthShort,
  formatWeekday,
} from "../i18n/format";
import type {
  ClothingRowModel,
  DayWeather,
  TodayChipModel,
} from "../weather/buildBoardWeather";
import { TodayWeatherHead } from "../weather/TodayWeatherHead";
import { WeatherChip } from "../weather/WeatherChip";
import { AllDayBanner } from "./AllDayBanner";
import { BringArea, bringAreaRows } from "./BringArea";
import type { BringReminder } from "./buildBringReminder";
import type { DayEvent } from "./buildDayModel";
import type { OverviewDay } from "./buildOverviewModel";
import {
  COLUMN_GAP_REM,
  fitColumn,
  freeRem,
  listMinRem,
} from "./columnCapacity";
import { MoreLater, PastStrip } from "./ColumnSummaries";
import { DayDone, DayEmpty, DayFree, DONE_MIN_REM } from "./DayStates";
import { MealPlates } from "./MealPlates";
import { NOW_LINE_REM, NowLine } from "./NowLine";
import { useContentHeight } from "./useContentHeight";

/** The list's vertical padding (`pt-2 pb-1.5`) and the gap to the 🎒 area (`gap-2.5`). */
const LIST_PAD_REM = 0.5 + 0.375;
const BODY_GAP_REM = 0.625;

export interface DayColumnProps {
  day: OverviewDay;
  childList: readonly Child[];
  format: FormatContext;
  /** Current time, formatted, for the now line's name (today only). */
  nowTime: string;
  /**
   * Today only: the 🎒 area (T-36), between the event list and the meal plates. Shown
   * when it has something to pack; ignored on the other days.
   */
  reminder?: BringReminder | undefined;
  /** The day's weather chip (T-49), when the forecast has the day (not today, see below). */
  weather?: DayWeather | undefined;
  /** Today only: today's chip (the day's weather, from eveningStart "now" only). */
  todayChip?: TodayChipModel | undefined;
  /** Today only: what to wear (today, or tomorrow from eveningStart); ignored otherwise. */
  clothing?: ClothingRowModel | undefined;
}

/**
 * One day of the overview: header, all-day banner, the timed events top to bottom
 * (today: past ones, now line, upcoming ones) and the meal plates at the bottom. How many
 * tiles fit is measured from the list's height (`fitColumn` + `columnLayout`): if the
 * whole day does not fit at the largest size, all past events fold into the "vorbei"
 * strip, then the tiles shrink step by step, and only then the latest are summed up in
 * "+N"; nothing is hidden silently and nothing scrolls. The current event (else the
 * next one) gets a larger tile while space allows. When every event of today is over,
 * the free space below shows "All done" ({@link DayDone}); another day without anything
 * planned shows a quiet placeholder ({@link DayFree}). Today's column can carry the 🎒
 * area ({@link BringArea}) below the list: one row per child while the column's space
 * allows (it may take what the list does not need for its minimum, `listMinRem`); its
 * height is fixed by its row count and it sits outside the `flex-1` list, so the measured
 * list is shorter by it and the tiles fold, shrink and sum up around it.
 */
export function DayColumn({
  day,
  childList,
  format,
  nowTime,
  reminder,
  weather,
  todayChip,
  clothing,
}: DayColumnProps): React.JSX.Element {
  const { t } = useTranslation();
  const headingId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const measured = useContentHeight(listRef);
  // List and 🎒 area together: their sum does not depend on how many rows the area draws.
  const bodyRef = useRef<HTMLDivElement>(null);
  const body = useContentHeight(bodyRef);
  const showNow = day.isToday && day.events.length > 0;
  const todayClothing = day.isToday ? clothing : undefined;
  const todayWeatherChip = day.isToday ? todayChip : undefined;
  const todayWeather =
    day.isToday &&
    (todayWeatherChip !== undefined || todayClothing !== undefined);
  // "Now" stands out: the current events, else the next one, get a larger tile.
  const prominent =
    day.current.length > 0 ? day.current : day.next === null ? [] : [day.next];
  const heightRem = measured === null ? null : measured.height / measured.rem;
  const reservedRem = showNow ? NOW_LINE_REM + COLUMN_GAP_REM : 0;
  const bring =
    day.isToday && reminder !== undefined && reminder.groups.length > 0
      ? reminder
      : undefined;
  const bringRows =
    bring === undefined
      ? 0
      : bringAreaRows(
          bring.groups.length,
          body === null
            ? null
            : body.height / body.rem -
                BODY_GAP_REM -
                LIST_PAD_REM -
                listMinRem(reservedRem),
          bring.when,
        );
  // Tiles with bring chips: taller where the chips need a row of their own.
  const withBring = day.events.filter((item) =>
    showsBring(item.event, item.status),
  );
  const plan = fitColumn(
    day.events,
    day.isToday,
    heightRem,
    reservedRem,
    prominent,
    withBring,
  );
  const { layout } = plan;
  const started = new Set(day.events.slice(0, day.nowIndex ?? 0));
  const before = layout.visible.filter((item) => started.has(item));
  const after = layout.visible.filter((item) => !started.has(item));
  const hiddenLater = layout.later;
  const empty = day.events.length === 0 && day.allDay.length === 0;
  // Every timed event of today is over: "All done" in the free space, if it fits there.
  const free = freeRem(plan, heightRem, reservedRem, prominent, withBring);
  const allDone =
    day.isToday &&
    day.events.length > 0 &&
    day.events.every((item) => item.status === "past") &&
    (free === null || free >= DONE_MIN_REM);

  const tile = (item: DayEvent): React.JSX.Element => (
    <li key={item.event.id} className="min-w-0">
      <EventTile
        event={item.event}
        childList={childList}
        format={format}
        status={item.status}
        continues={item.continues}
        timeOfDay={item.timeOfDay}
        size={plan.size}
        next={day.next === item}
        prominent={plan.prominent && prominent.includes(item)}
      />
    </li>
  );

  return (
    <section
      aria-labelledby={headingId}
      aria-current={day.isToday ? "date" : undefined}
      data-testid="day-column"
      data-date={day.date}
      data-today={day.isToday}
      data-size={plan.size}
      className={`${
        day.isToday
          ? "bg-surface-raised ring-today-ring shadow-raised ring-[5px]"
          : "bg-surface-sunken"
      } text-text rounded-column flex min-h-0 min-w-0 flex-col gap-2.5 overflow-hidden p-3.5`}
    >
      {/* Today's weekday and date are in the board header already (no repeat here). The
          weather sits at the end of today's heading row (clothing pill, then the chip; one
          line, the icons sized to fit) and of the other days' date line, whose date is
          then the short one ("23. Nov." / "Nov 23") and never cut by the chip. */}
      <div className="shrink-0">
        <div
          className={
            todayWeather ? "flex items-center justify-between gap-1" : undefined
          }
        >
          <h2
            id={headingId}
            className={`${day.isToday ? "text-heading" : "text-title"} ${
              todayWeather ? "shrink-0" : "min-w-0"
            } truncate`}
          >
            {day.isToday ? t("day.today") : formatWeekday(day.date, format)}
          </h2>
          {todayWeather && (
            <TodayWeatherHead
              chip={todayWeatherChip}
              clothing={todayClothing}
            />
          )}
        </div>
        {!day.isToday &&
          (weather === undefined ? (
            <p className="text-body text-text-muted truncate">
              {formatDayMonth(day.date, format)}
            </p>
          ) : (
            <div className="flex items-center justify-between gap-1.5">
              <p
                data-testid="column-date"
                className="text-body text-text-muted min-w-0 truncate"
              >
                {formatDayMonthShort(day.date, format)}
              </p>
              <WeatherChip day={weather} size="day" />
            </div>
          ))}
      </div>
      <AllDayBanner
        items={day.allDay}
        childList={childList}
        large={day.isToday}
      />
      <div
        ref={bodyRef}
        data-testid="column-body"
        className="flex min-h-0 flex-1 basis-0 flex-col gap-2.5"
      >
        <div
          ref={listRef}
          data-testid="column-events"
          className="-mx-1.5 flex min-h-0 flex-1 basis-0 flex-col gap-2 overflow-hidden px-1.5 pt-2 pb-1.5"
        >
          {empty ? (
            day.isToday ? (
              <DayEmpty childList={childList} />
            ) : (
              <DayFree />
            )
          ) : (
            <>
              {layout.pastStrip.length > 0 && (
                <PastStrip
                  items={layout.pastStrip.map((item) => item.event)}
                  icons={layout.stripIcons.map((item) => item.event)}
                  hidden={layout.hiddenEarlier}
                />
              )}
              {before.length > 0 && (
                <ol className="flex flex-col gap-2">{before.map(tile)}</ol>
              )}
              {showNow && <NowLine time={nowTime} />}
              {(after.length > 0 || hiddenLater.length > 0) && (
                <ol className="flex flex-col gap-2">
                  {after.map(tile)}
                  {hiddenLater.length > 0 && (
                    <MoreLater items={hiddenLater.map((item) => item.event)} />
                  )}
                </ol>
              )}
              {allDone && <DayDone />}
            </>
          )}
        </div>
        {bring !== undefined && (
          <BringArea reminder={bring} format={format} maxRows={bringRows} />
        )}
      </div>
      <MealPlates meals={day.meals} today={day.isToday} />
    </section>
  );
}
