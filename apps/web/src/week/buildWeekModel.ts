import {
  addCalendarDays,
  type AgendaResponse,
  type Meal,
} from "@kidboard/shared";

import {
  buildDayModel,
  type DayEvent,
  type DayModelConfig,
} from "../day/buildDayModel";

/**
 * Pure model of the week view: `WEEK_DAYS` consecutive calendar days from `from` (today,
 * in the config zone), each built with {@link buildDayModel} so that day and week agree on
 * which events and meals belong to a day.
 */

export const WEEK_DAYS = 7;

export interface WeekDay {
  /** `YYYY-MM-DD` in the config zone. */
  date: string;
  isToday: boolean;
  /** Saturday or Sunday. */
  isWeekend: boolean;
  /**
   * All events of the day, most important first ({@link rankByImportance}). How many get
   * a tile is decided by the available space, not here (`fitWeekColumn`).
   */
  events: DayEvent[];
  /** Meals ordered breakfast, lunch, dinner, unspecified. */
  meals: Meal[];
}

/** Day of the week of a calendar date (0 = Sunday); pure calendar math, no time zone. */
export function isWeekendDate(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Ranks a day's events by importance for the tile budget of a week column (what is
 * dropped first when space is short):
 * 0. events that are already over (only today has them) go last: the column answers
 *    "what is still to come?", and a past event may only fill a slot nothing else wants,
 * 1. countdown events (the child is waiting for them),
 * 2. all-day events (they shape the whole day),
 * 3. timed events by start time (the earliest first; a continuing multi-day event counts
 *    as starting at the beginning of the day, i.e. first),
 * ties by title, then feed order. The input is not modified.
 *
 * Receding is done by ranking, not by dimming: faded icons would break WCAG AA contrast.
 */
export function rankByImportance(events: readonly DayEvent[]): DayEvent[] {
  const tier = ({ event }: DayEvent): number =>
    event.countdown ? 0 : event.allDay ? 1 : 2;
  const over = ({ status }: DayEvent): number => (status === "past" ? 1 : 0);
  const startMs = ({ event, continues }: DayEvent): number =>
    event.allDay || continues ? 0 : Date.parse(event.start);
  return [...events].sort(
    (a, b) =>
      over(a) - over(b) ||
      tier(a) - tier(b) ||
      startMs(a) - startMs(b) ||
      a.event.title.localeCompare(b.event.title),
  );
}

/**
 * Display order of the tiles in a column: all-day events first, then timed ones by start
 * (an event continuing from an earlier day counts as starting at the beginning of the
 * day), ties by title. Unlike the ranking this ignores countdown and "over".
 */
export function chronological(events: readonly DayEvent[]): DayEvent[] {
  const startMs = ({ event, continues }: DayEvent): number =>
    event.allDay || continues ? 0 : Date.parse(event.start);
  return [...events].sort(
    (a, b) =>
      Number(b.event.allDay) - Number(a.event.allDay) ||
      startMs(a) - startMs(b) ||
      a.event.title.localeCompare(b.event.title),
  );
}

export function buildWeekModel(
  agenda: Pick<AgendaResponse, "events" | "meals">,
  config: DayModelConfig,
  from: string,
  now: number,
): WeekDay[] {
  return Array.from({ length: WEEK_DAYS }, (_, offset): WeekDay => {
    const date = addCalendarDays(from, offset);
    const day = buildDayModel(agenda, config, date, now);
    return {
      date,
      isToday: offset === 0,
      isWeekend: isWeekendDate(date),
      events: rankByImportance([
        ...day.allDay,
        ...day.bands.flatMap((band) => band.events),
      ]),
      meals: day.meals,
    };
  });
}
