import {
  addCalendarDays,
  type AgendaResponse,
  AgendaResponseSchema,
  type CalendarEvent,
  dateKeyInZone,
} from "@kidboard/shared";
import type { QueryClient } from "@tanstack/react-query";

import type { AgendaRange } from "./apiClient";
import { isWithinMaxAge } from "./persister";
import { QUERY_ROOT, queryKindOf } from "./queryKeys";

/**
 * Seeding a new agenda range from a cached one (T-16, midnight while offline).
 *
 * At local midnight `range.from` moves to the new day, which is a new query key without
 * data. If a cached agenda (in memory or restored from storage) already covers the new
 * day, the new query starts with that agenda re-scoped to the new range, so the board
 * keeps showing the last known state (status `offline`/`stale`) instead of going empty
 * or `loading` until the fetch succeeds.
 */

/** A cached agenda and when its data was fetched. */
export interface CachedAgenda {
  data: AgendaResponse;
  dataUpdatedAt: number;
}

/**
 * True if the timed or all-day `event` overlaps the dates `[from, to)`, by the worker's
 * rules (`buildAgenda`): exclusive end, zero-length events count at their start.
 * Timed events are compared by the date of their first and last instant in `timeZone`.
 */
export function eventOverlapsDates(
  event: CalendarEvent,
  from: string,
  to: string,
  timeZone: string,
): boolean {
  if (event.allDay) {
    return (
      event.start < to &&
      (event.end > from || (event.end <= event.start && event.start >= from))
    );
  }
  const startMs = Date.parse(event.start);
  const endMs = Date.parse(event.end);
  const firstDay = dateKeyInZone(startMs, timeZone);
  // Last millisecond inside the (exclusive) end; zero-length: the start itself.
  const lastDay = dateKeyInZone(Math.max(startMs, endMs - 1), timeZone);
  return firstDay < to && lastDay >= from;
}

/**
 * `agenda` re-scoped to `range`: `range.from` must lie inside `agenda.range`, else
 * `undefined`. Events and meals outside the new range are dropped; `range.to` is the
 * earlier of the requested end and the end the cached data actually covers (it never
 * claims days it has no data for). Health fields (`stale`, `sources`, `generatedAt`)
 * are kept, so a degraded agenda stays `stale`.
 */
export function rescopeAgenda(
  agenda: AgendaResponse,
  range: AgendaRange,
): AgendaResponse | undefined {
  const from = range.from;
  if (from < agenda.range.from || from >= agenda.range.to) {
    return undefined;
  }
  const requestedTo = addCalendarDays(from, range.days);
  const to = requestedTo < agenda.range.to ? requestedTo : agenda.range.to;
  return {
    ...agenda,
    range: { from, to },
    events: agenda.events.filter((event) =>
      eventOverlapsDates(event, from, to, agenda.timeZone),
    ),
    meals: agenda.meals.filter((meal) => meal.date >= from && meal.date < to),
  };
}

/**
 * The best cached agenda to seed `range` with: among the agendas whose range covers
 * `range.from` and whose data is at most 7 days old (`isWithinMaxAge`, the persister's
 * rule, applied to in-memory data too), the most recently fetched one (ties: the one
 * reaching further).
 *
 * Seeds themselves (`dataUpdatedAt` 0) never qualify, so over several offline days
 * every new day is seeded from the last *real* response while it covers the day and
 * is younger than 7 days, never from an earlier seed.
 */
export function pickCoveringAgenda(
  candidates: readonly CachedAgenda[],
  range: AgendaRange,
  nowMs: number = Date.now(),
): CachedAgenda | undefined {
  let best: CachedAgenda | undefined;
  for (const candidate of candidates) {
    const { from, to } = candidate.data.range;
    if (
      range.from < from ||
      range.from >= to ||
      candidate.dataUpdatedAt <= 0 ||
      !isWithinMaxAge(candidate.dataUpdatedAt, nowMs)
    ) {
      continue;
    }
    if (
      best === undefined ||
      candidate.dataUpdatedAt > best.dataUpdatedAt ||
      (candidate.dataUpdatedAt === best.dataUpdatedAt &&
        to > best.data.range.to)
    ) {
      best = candidate;
    }
  }
  return best;
}

/** Agenda queries in `client` that have valid data (any age; filtered on pick). */
export function cachedAgendas(client: QueryClient): CachedAgenda[] {
  return client
    .getQueryCache()
    .findAll({ queryKey: [QUERY_ROOT, "agenda"] })
    .flatMap((query) => {
      if (queryKindOf(query.queryKey) !== "agenda") {
        return [];
      }
      const parsed = AgendaResponseSchema.safeParse(query.state.data);
      return parsed.success
        ? [{ data: parsed.data, dataUpdatedAt: query.state.dataUpdatedAt }]
        : [];
    });
}

/** Seed data for `range` from the cache of `client`, or `undefined` if none covers it. */
export function seedAgenda(
  client: QueryClient,
  range: AgendaRange,
): AgendaResponse | undefined {
  const covering = pickCoveringAgenda(cachedAgendas(client), range);
  return covering === undefined
    ? undefined
    : rescopeAgenda(covering.data, range);
}
