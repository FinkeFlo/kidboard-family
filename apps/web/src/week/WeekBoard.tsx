import type { CalendarEvent, Child } from "@kidboard/shared";
import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import { ChildAvatar } from "../components/ChildAvatar";
import { resolveTileTint, tileTintStyle } from "../components/childTint";
import { Emoji } from "../components/Emoji";
import { childrenOf, EventTile, showsBring } from "../components/EventTile";
import {
  MoreLater,
  PastStrip,
  WEEK_STRIP_ICONS_MAX,
} from "../day/ColumnSummaries";
import { useContentHeight } from "../day/useContentHeight";
import {
  type FormatContext,
  formatDayMonthShort,
  formatWeekday,
} from "../i18n/format";
import type { BoardWeather, DayWeather } from "../weather/buildBoardWeather";
import { WeatherChip, weatherName } from "../weather/WeatherChip";
import { chronological, type WeekDay } from "./buildWeekModel";
import { MealRows } from "./MealRows";
import { fitWeekColumn } from "./weekCapacity";

/** 🌙 counts sleeps and nothing else (merge rule 1); one per night still to sleep. */
const MOON = "🌙";

/** The day the countdown waits for, as far as the week columns need it. */
export interface WeekCountdown {
  /** Start date (`YYYY-MM-DD`, config zone) of the awaited events. */
  date: string;
  /** The awaited events; the first one's icon marks the target day's header. */
  events: readonly CalendarEvent[];
}

function WeekColumn({
  day,
  childList,
  format,
  countdown,
  weather,
  weatherRow,
}: {
  day: WeekDay;
  childList: readonly Child[];
  format: FormatContext;
  countdown: WeekCountdown | undefined;
  weather: DayWeather | undefined;
  /** The board shows weather: every column keeps the weather line. */
  weatherRow: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const headingId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const measured = useContentHeight(listRef);
  const fit = fitWeekColumn(
    day.events,
    measured === null ? null : measured.height / measured.rem,
    // Tiles with bring chips are taller (a chip row of their own).
    day.events.filter((item) => showsBring(item.event, item.status)),
  );
  const shown = chronological(fit.visible);
  // The strip lists the finished events oldest first.
  const past = chronological(fit.past).map((item) => item.event);

  // The countdown day: the awaited event's icon in its header and a ring in the countdown
  // colour (person-neutral, like the moons). Only when the awaited event belongs to one
  // child, the column also wears that child's tint and the header shows the child's
  // badge; shared or nobody's events keep the day's own surface. Every day before it
  // shows one moon in its header (the night after it is still to sleep); the days after
  // it keep an empty slot, so all dates stay on one line.
  const target = countdown !== undefined && countdown.date === day.date;
  // Guarded: an empty `events` list (never built today, but the type allows it) leaves
  // the day unmarked instead of crashing the board.
  const awaited = target ? countdown.events[0] : undefined;
  const owners = awaited === undefined ? [] : childrenOf(awaited, childList);
  const owner = owners.length === 1 ? owners[0] : undefined;
  const tint = owner === undefined ? undefined : resolveTileTint([owner]);
  const moon = countdown !== undefined && day.date < countdown.date;

  // Weekend columns keep their own surface (T-18); today is raised like in the overview;
  // a one-child countdown day's inline tint wins over all of them.
  const surface =
    tint !== undefined
      ? "text-text"
      : day.isWeekend
        ? "bg-surface-weekend text-text"
        : day.isToday
          ? "bg-surface-raised text-text"
          : "bg-surface-sunken text-text";
  const ring = day.isToday
    ? "ring-today-ring shadow-raised ring-[5px]"
    : awaited !== undefined
      ? "ring-band-evening-accent shadow-raised ring-4"
      : "";
  const label = day.isWeekend ? "text-band-morning-accent" : "text-text";
  return (
    <section
      aria-labelledby={headingId}
      aria-current={day.isToday ? "date" : undefined}
      data-testid="day-column"
      data-date={day.date}
      data-weekend={day.isWeekend}
      data-today={day.isToday}
      data-countdown-day={target}
      data-size={fit.size}
      style={tint === undefined ? undefined : tileTintStyle(tint)}
      className={`${surface} ${ring} rounded-column flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden p-3`}
    >
      <div className="shrink-0">
        {/* Weather first, on a line of its own (seven columns leave no room beside the
            weekday or the date), kept in every column while the board shows weather so
            the lists start level. The weekday sits between it and the moons on the date
            line, so a chip never stacks on a 🌙 (they would read as night and day).
            Decorative: the heading names the weather (the daily high, as every day). */}
        {weatherRow && (
          <div data-testid="week-weather" className="flex h-8 items-center">
            {weather !== undefined && (
              <WeatherChip day={weather} size="week" decorative />
            )}
          </div>
        )}
        <h2
          id={headingId}
          aria-label={
            weather === undefined
              ? undefined
              : t("weather.heading", {
                  day: formatWeekday(day.date, format),
                  weather: weatherName(t, weather, { current: false }),
                })
          }
          className={`${label} text-tile font-extrabold break-words hyphens-auto`}
        >
          {formatWeekday(day.date, format)}
        </h2>
        <div
          className={`flex ${weatherRow ? "h-7" : "h-8"} items-center justify-between gap-1`}
        >
          <p className="text-caption text-text-muted min-w-0 truncate font-bold">
            {formatDayMonthShort(day.date, format)}
          </p>
          {/* Decorative: the countdown pill says the same in words. */}
          <span
            aria-hidden="true"
            data-testid="column-slot"
            className="flex shrink-0 items-center"
          >
            {moon && (
              <span data-testid="column-moon">
                <Emoji emoji={MOON} className="text-title" />
              </span>
            )}
            {awaited !== undefined && (
              <span
                data-testid="column-target"
                className="flex items-center gap-0.5"
              >
                <Emoji emoji={awaited.icon} className="text-title" />
                {owner !== undefined && (
                  <ChildAvatar
                    decorative
                    child={owner}
                    className="text-caption size-6"
                  />
                )}
              </span>
            )}
          </span>
        </div>
      </div>
      <ul
        ref={listRef}
        data-testid="column-events"
        className="@container -mx-1.5 flex min-h-0 flex-1 basis-0 flex-col gap-2 overflow-hidden px-1.5 pt-2 pb-1.5"
      >
        {past.length > 0 && (
          <li className="min-w-0 shrink-0">
            <PastStrip
              variant="week"
              items={past}
              icons={past.slice(0, WEEK_STRIP_ICONS_MAX)}
              hidden={Math.max(0, past.length - WEEK_STRIP_ICONS_MAX)}
            />
          </li>
        )}
        {shown.map((item) => (
          <li key={item.event.id} className="min-w-0">
            <EventTile
              event={item.event}
              childList={childList}
              format={format}
              status={item.status}
              continues={item.continues}
              timeOfDay={item.timeOfDay}
              size={fit.size}
            />
          </li>
        ))}
        {fit.hidden.length > 0 && (
          <MoreLater
            variant="week"
            items={chronological(fit.hidden).map((item) => item.event)}
          />
        )}
      </ul>
      <MealRows meals={day.meals} />
    </section>
  );
}

export interface WeekBoardProps {
  days: readonly WeekDay[];
  /** Configured children; `event.childIds` are looked up here (unknown ids skipped). */
  childList: readonly Child[];
  format: FormatContext;
  /** The awaited countdown: marks its day and puts a moon in the earlier headers. */
  countdown?: WeekCountdown | undefined;
  /** Weather chips per day (T-49), for the days inside the forecast. */
  weather?: BoardWeather | undefined;
}

/**
 * Seven day columns side by side (today first) in the overview's tile language: tinted
 * tiles with child badges, a title (where the column is wide enough) and a time-of-day symbol, meals as a
 * three-row list. How many tiles fit is measured per column (`fitWeekColumn`): finished
 * events fold into the "done" strip first, then the tiles shrink, and only then the least
 * important upcoming events become "+N" with their small icons. Presentational.
 */
export function WeekBoard({
  days,
  childList,
  format,
  countdown,
  weather,
}: WeekBoardProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t("week.label")}
      data-testid="week-board"
      className="gap-gutter grid min-h-0 flex-1 grid-cols-7 grid-rows-[minmax(0,1fr)]"
    >
      {days.map((day) => (
        <WeekColumn
          key={day.date}
          day={day}
          childList={childList}
          format={format}
          countdown={countdown}
          weather={weather?.days.get(day.date)}
          weatherRow={weather !== undefined && weather.days.size > 0}
        />
      ))}
    </div>
  );
}
