import {
  type AgendaResponse,
  type CalendarEvent,
  type Meal,
  startOfZonedDayMs,
} from "@kidboard/shared";

import { compareEvents, compareMeals } from "../normalize/normalize";
import type { SourceResult } from "./loadSource";

export interface AgendaRange {
  /** `YYYY-MM-DD`, inclusive. */
  from: string;
  /** `YYYY-MM-DD`, exclusive. */
  to: string;
}

/**
 * True if `event` overlaps `[from, to)`; same rules as `expandCalendar` (zero-length
 * events count as "at" their start).
 */
function overlaps(
  event: CalendarEvent,
  range: AgendaRange,
  fromMs: number,
  toMs: number,
): boolean {
  if (event.allDay) {
    return (
      event.start < range.to &&
      (event.end > range.from ||
        (event.end <= event.start && event.start >= range.from))
    );
  }
  const startMs = Date.parse(event.start);
  const endMs = Date.parse(event.end);
  return (
    startMs < toMs &&
    (endMs > fromMs || (endMs === startMs && startMs >= fromMs))
  );
}

/**
 * Assembles the `AgendaResponse` for `range` from the per-source results (each holding
 * a larger cached window) and the HTTP status: 200 if any source is `ok` or `stale`,
 * 502 if all failed. No sources at all (no calendars configured and the editor off) is
 * an empty board, not a failure: 200.
 */
export function buildAgenda(
  results: readonly SourceResult[],
  range: AgendaRange,
  timeZone: string,
  nowMs: number,
): { body: AgendaResponse; status: 200 | 502 } {
  const fromMs = startOfZonedDayMs(range.from, timeZone);
  const toMs = startOfZonedDayMs(range.to, timeZone);
  const events: CalendarEvent[] = [];
  const meals: Meal[] = [];
  let oldestFetchMs = Number.POSITIVE_INFINITY;

  const sources: AgendaResponse["sources"] = results.map((result) => {
    if (result.status === "error") {
      return { id: result.id, status: "error" };
    }
    const { entry } = result;
    oldestFetchMs = Math.min(oldestFetchMs, Date.parse(entry.fetchedAt));
    for (const event of entry.events) {
      if (overlaps(event, range, fromMs, toMs)) {
        events.push(event);
      }
    }
    for (const meal of entry.meals) {
      if (meal.date >= range.from && meal.date < range.to) {
        meals.push(meal);
      }
    }
    return {
      id: result.id,
      status: result.status,
      fetchedAt: entry.fetchedAt,
      ...(entry.truncated ? { truncated: true } : {}),
    };
  });

  const anyData =
    results.length === 0 || results.some((r) => r.status !== "error");
  return {
    status: anyData ? 200 : 502,
    body: {
      generatedAt: new Date(
        Number.isFinite(oldestFetchMs) ? oldestFetchMs : nowMs,
      ).toISOString(),
      timeZone,
      range: { from: range.from, to: range.to },
      stale: results.some((r) => r.status === "stale"),
      sources,
      events: events.sort(compareEvents),
      meals: meals.sort(compareMeals),
    },
  };
}
