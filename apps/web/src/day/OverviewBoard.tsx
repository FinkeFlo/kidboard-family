import type { Child } from "@kidboard/shared";

import type { FormatContext } from "../i18n/format";
import type { BoardWeather } from "../weather/buildBoardWeather";
import type { BringReminder } from "./buildBringReminder";
import type { OverviewModel } from "./buildOverviewModel";
import { DayColumn } from "./DayColumn";

export interface OverviewBoardProps {
  model: OverviewModel;
  childList: readonly Child[];
  format: FormatContext;
  /** Current time, formatted, for the now line's accessible name. */
  nowTime: string;
  /** The 🎒 area for today's column (T-36); not shown in the other columns. */
  bring?: BringReminder | undefined;
  /** Weather chips per day and today's clothing row (T-49); absent when weather is off. */
  weather?: BoardWeather | undefined;
}

/**
 * The main screen (below the shared board frame): today plus the next three days as
 * columns, today about twice as wide; only today's column carries the 🎒 area. Purely
 * presentational.
 */
export function OverviewBoard({
  model,
  childList,
  format,
  nowTime,
  bring,
  weather,
}: OverviewBoardProps): React.JSX.Element {
  return (
    <div
      data-testid="overview"
      className="gap-gutter grid min-h-0 flex-1 grid-cols-[2fr_1fr_1fr_1fr] grid-rows-[minmax(0,1fr)]"
    >
      {model.days.map((day) => (
        <DayColumn
          key={day.date}
          day={day}
          childList={childList}
          format={format}
          nowTime={nowTime}
          reminder={day.isToday ? bring : undefined}
          weather={weather?.days.get(day.date)}
          todayChip={day.isToday ? weather?.todayChip : undefined}
          clothing={day.isToday ? weather?.clothing : undefined}
        />
      ))}
    </div>
  );
}
