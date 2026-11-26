import {
  calendarDaysBetween,
  type CalendarEvent,
  dateKeyInZone,
} from "@kidboard/shared";

/**
 * Pure model of the "How many sleeps?" countdown (T-19). No React, no timers; the
 * day of an event is always taken in the configured zone, never the device zone.
 *
 * Rules (documented in docs/ARCHITECTURE.md, "Countdown"):
 * - Candidates are events with `countdown: true` that **start** today or later, at most
 *   {@link COUNTDOWN_MAX_NIGHTS} nights ahead.
 * - Nights = calendar days from today to the start date (config zone). Today → 0 (the
 *   "today!" state, for the whole start day, also after a timed event has ended);
 *   tomorrow → 1.
 * - An event that started on an earlier day is under way, not awaited: it is skipped
 *   (a holiday that began yesterday does not show "today!" for two weeks) and the next
 *   upcoming countdown event is shown instead.
 * - Several countdown events on the nearest day share the countdown: all of them are
 *   returned, all-day ones first, then by start time, ties by title.
 */

/** The countdown looks this many nights ahead (the agenda covers today + 30 days). */
export const COUNTDOWN_MAX_NIGHTS = 30;

export interface Countdown {
  /** Start date (`YYYY-MM-DD`, config zone) of the awaited events. */
  date: string;
  /** Nights until `date`: 0 = today. */
  nights: number;
  /** The countdown events starting on `date`, in display order (at least one). */
  events: CalendarEvent[];
}

/** Start date of an event in `timeZone` (all-day starts are date keys already). */
function startDate(event: CalendarEvent, timeZone: string): string {
  return event.allDay
    ? event.start
    : dateKeyInZone(Date.parse(event.start), timeZone);
}

/** All-day events first (they shape the whole day), then timed ones by start. */
function byDisplayOrder(a: CalendarEvent, b: CalendarEvent): number {
  return (
    Number(b.allDay) - Number(a.allDay) ||
    (a.allDay ? 0 : Date.parse(a.start) - Date.parse(b.start)) ||
    a.title.localeCompare(b.title)
  );
}

/**
 * The nearest upcoming countdown among `events` seen from `today` (`YYYY-MM-DD` in
 * `timeZone`), or `undefined` if none starts within {@link COUNTDOWN_MAX_NIGHTS}
 * nights. Works on any agenda, also a midnight seed that covers fewer days (it then
 * simply knows fewer events). The input is not modified.
 */
export function buildCountdown(
  events: readonly CalendarEvent[],
  today: string,
  timeZone: string,
): Countdown | undefined {
  let nearest: { date: string; nights: number } | undefined;
  const byDate = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    if (!event.countdown) continue;
    const date = startDate(event, timeZone);
    const nights = calendarDaysBetween(today, date);
    if (nights < 0 || nights > COUNTDOWN_MAX_NIGHTS) continue;
    const sameDay = byDate.get(date);
    if (sameDay === undefined) {
      byDate.set(date, [event]);
    } else {
      sameDay.push(event);
    }
    if (nearest === undefined || nights < nearest.nights) {
      nearest = { date, nights };
    }
  }
  if (nearest === undefined) return undefined;
  const sameDay = [...(byDate.get(nearest.date) ?? [])].sort(byDisplayOrder);
  return { ...nearest, events: sameDay };
}
