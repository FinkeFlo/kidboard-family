import {
  addCalendarDays,
  type AgendaResponse,
  type Meal,
} from "@kidboard/shared";

import {
  buildDayModel,
  type DayEvent,
  type DayModelConfig,
} from "./buildDayModel";

/** Today plus the next three days. */
export const OVERVIEW_DAYS = 4;

export interface OverviewDay {
  /** Date key (`YYYY-MM-DD`) in the configured zone. */
  date: string;
  isToday: boolean;
  /** All-day events covering the date (banner at the top of the column). */
  allDay: DayEvent[];
  /** Timed events in time order (carried-over ones first), across all times of day. */
  events: DayEvent[];
  /** The day's meals ordered breakfast, lunch, dinner, unspecified. */
  meals: Meal[];
  /**
   * Today only: where the "now" line sits in `events`, i.e. the number of events that
   * have already started (0: above the first, `events.length`: below the last).
   * `null` on other days.
   */
  nowIndex: number | null;
  /** Today only: events under way right now (may be several). Empty on other days. */
  current: DayEvent[];
  /** Today only: the next event that has not started yet, else `null`. */
  next: DayEvent | null;
  /** No event, all-day event or meal on the date. */
  isEmpty: boolean;
}

export interface OverviewModel {
  /** Always `OVERVIEW_DAYS` entries; the first is today. */
  days: OverviewDay[];
}

/**
 * Builds the four-day overview. Every day goes through `buildDayModel`, so day view,
 * week view and countdown agree on what belongs to a date. `today` is a date key in
 * `config.timeZone` (the caller's clock), `now` the epoch ms of the same instant.
 */
export function buildOverviewModel(
  agenda: Pick<AgendaResponse, "events" | "meals">,
  config: DayModelConfig,
  today: string,
  now: number,
): OverviewModel {
  const days = Array.from(
    { length: OVERVIEW_DAYS },
    (_, offset): OverviewDay => {
      const date = addCalendarDays(today, offset);
      const isToday = offset === 0;
      const model = buildDayModel(agenda, config, date, now);
      const events = model.bands.flatMap((band) => band.events);
      return {
        date,
        isToday,
        allDay: model.allDay,
        events,
        meals: model.meals,
        nowIndex: isToday
          ? events.filter((item) => Date.parse(item.event.start) <= now).length
          : null,
        current: isToday
          ? events.filter((item) => item.status === "current")
          : [],
        next: isToday
          ? (events.find((item) => Date.parse(item.event.start) > now) ?? null)
          : null,
        isEmpty: model.isEmpty,
      };
    },
  );
  return { days };
}
