import {
  addCalendarDays,
  type AgendaResponse,
  type CalendarEvent,
  type Child,
  dateKeyInZone,
  type PublicConfig,
} from "@kidboard/shared";

import { minuteOfDay, minutesOfTime } from "../time";

/**
 * The evening-before 🎒 area (T-36, ADR-0010): what to pack for the next day, per child,
 * until the event has started. Pure: every instant is read in `config.timeZone`, never in
 * the device zone.
 */

/** The one icon that leads the area; used nowhere else in the UI (merge rule 1). */
export const BRING_BAG = "🎒";

/**
 * `tomorrow`: from `bands.eveningStart` until midnight, the bring lists of tomorrow's
 * events; `today`: from midnight until `bands.eveningStart`, those of today's events that
 * have not started yet.
 */
export type BringWhen = "tomorrow" | "today";

export interface BringGroup {
  /** `null`: events for everyone (no child, or only children the config does not know). */
  child: Child | null;
  /** Icons in event order, deduplicated (compared without VS16). Never empty. */
  icons: string[];
}

export interface BringReminder {
  when: BringWhen;
  /** The day the icons are for (`YYYY-MM-DD` in the config zone): tomorrow or today. */
  date: string;
  /** The neutral group first, then one per child in config order. Empty: no area. */
  groups: BringGroup[];
}

export type BringReminderConfig = Pick<
  PublicConfig,
  "timeZone" | "bands" | "children"
>;

const VS16 = /\uFE0F/gu;

/** Whether `event` still counts at `now` for the window's `date` (see {@link BringWhen}). */
function counts(
  event: CalendarEvent,
  date: string,
  when: BringWhen,
  now: number,
  minutes: number,
  config: BringReminderConfig,
): boolean {
  if (event.allDay) {
    // An all-day event belongs to the day it starts on (a multi-day one is not packed
    // again for its later days); on that day it counts until `middayStart`.
    if (event.start !== date) return false;
    return (
      when === "tomorrow" || minutes < minutesOfTime(config.bands.middayStart)
    );
  }
  const startMs = Date.parse(event.start);
  // Only events that start on the date: one that started earlier and continues into it
  // was already packed for.
  if (dateKeyInZone(startMs, config.timeZone) !== date) return false;
  return now < startMs;
}

/** All-day events first (they start with the day), then by start, title and id. */
function byStart(a: CalendarEvent, b: CalendarEvent): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  const start = a.allDay
    ? a.start.localeCompare(b.start)
    : Date.parse(a.start) - Date.parse(b.start);
  return start || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

/**
 * Builds the 🎒 area at `now` (epoch ms): from `bands.eveningStart` until midnight (wall
 * clock of `config.timeZone`) it collects the bring lists of tomorrow's events; from
 * midnight until `bands.eveningStart` those of today's events that have not started yet
 * (timed: until their start; all-day: until `bands.middayStart`). An event's icons leave
 * as soon as its time is over; `groups` is empty when nothing is left.
 *
 * Grouping: events for everyone (`childIds: []`, or only unknown children) form one
 * neutral group shown first; then one group per configured child in config order. An
 * event for several children adds its icons to each of them. Icons are deduplicated per
 * group (compared without VS16, the first spelling wins), in event order.
 */
export function buildBringReminder(
  agenda: Pick<AgendaResponse, "events">,
  config: BringReminderConfig,
  now: number,
): BringReminder {
  const today = dateKeyInZone(now, config.timeZone);
  const minutes = minuteOfDay(now, config.timeZone);
  const when: BringWhen =
    minutes >= minutesOfTime(config.bands.eveningStart) ? "tomorrow" : "today";
  const date = when === "tomorrow" ? addCalendarDays(today, 1) : today;

  const events = agenda.events
    .filter(
      (event) =>
        (event.bring?.length ?? 0) > 0 &&
        counts(event, date, when, now, minutes, config),
    )
    .sort(byStart);

  // Keyed by child id; `null` is the neutral group.
  const icons = new Map<string | null, { list: string[]; seen: Set<string> }>();
  const add = (key: string | null, list: readonly string[]): void => {
    let entry = icons.get(key);
    if (entry === undefined) {
      entry = { list: [], seen: new Set() };
      icons.set(key, entry);
    }
    for (const icon of list) {
      const plain = icon.replace(VS16, "");
      if (entry.seen.has(plain)) continue;
      entry.seen.add(plain);
      entry.list.push(icon);
    }
  };
  const known = new Set(config.children.map((child) => child.id));
  for (const event of events) {
    const bring = event.bring ?? [];
    const named = event.childIds.filter((id) => known.has(id));
    if (named.length === 0) {
      add(null, bring);
      continue;
    }
    for (const id of new Set(named)) add(id, bring);
  }

  const groups: BringGroup[] = [];
  const neutral = icons.get(null);
  if (neutral !== undefined) groups.push({ child: null, icons: neutral.list });
  for (const child of config.children) {
    const entry = icons.get(child.id);
    if (entry !== undefined) groups.push({ child, icons: entry.list });
  }
  return { when, date, groups };
}
