import type { CoreConfig } from "../config";
import { addCalendarDays, calendarDaysBetween } from "../dates";
import type { MealSlot } from "../model";
import type { CalendarEvent, Meal } from "../model";
import { EmojiSchema } from "../primitives";
import { parseCalendarDate, startOfDayMs } from "../wallTime";
import {
  EDITOR_TEMPLATES_MAX,
  type EditorGoogleItem,
  type EditorListItem,
  type EditorTemplate,
  type EditorUnresolvedEntry,
} from "./api";
import { type EditorEntryInput, EditorTitleSchema } from "./entry";
import { parseEditorEntryInput } from "./validate";
import { isoWeekday } from "./zonedTime";

/*
 * Pure logic of the parent editor shared by the worker (the real backend) and the demo
 * and test backend in `apps/web/demo`: which days a series occurs on, how list items
 * are ordered and how templates are suggested. One implementation, so the stand-in can
 * not drift from the worker.
 */

/** Monday of the ISO week of `date`. */
function mondayOf(date: string): string {
  return addCalendarDays(date, 1 - isoWeekday(date));
}

/**
 * Whether a series starts an occurrence on `date` (`YYYY-MM-DD`, config zone): on or
 * after the first date, not after `until`, on one of the weekdays and, for every other
 * week, in a week with an even distance from the first week (RFC 5545 `INTERVAL=2`
 * with the default `WKST=MO`, as written by `buildRecurrenceRule`). A single entry has one
 * occurrence, on its own date.
 */
export function isOccurrenceDate(
  entry: EditorEntryInput,
  date: string,
): boolean {
  if (entry.repeat === "none") {
    return date === entry.date;
  }
  const { weekdays, interval, until } = entry.repeat.weekly;
  if (date < entry.date || (until !== undefined && date > until)) {
    return false;
  }
  if (!weekdays.includes(isoWeekday(date))) {
    return false;
  }
  const weeks = calendarDaysBetween(mondayOf(entry.date), mondayOf(date)) / 7;
  return weeks % interval === 0;
}

/**
 * Calendar days from the start date of one occurrence to the last day it may touch.
 * Deliberately generous for timed entries (+1: a default one-hour end after 23:00 or an
 * end at midnight reaches into the next day); only used to pre-filter by date range.
 */
function spanDays(entry: EditorEntryInput): number {
  if (entry.allDay) {
    return entry.endDate === undefined
      ? 0
      : calendarDaysBetween(entry.date, entry.endDate) - 1;
  }
  const days =
    entry.endDate === undefined
      ? 0
      : calendarDaysBetween(entry.date, entry.endDate);
  return days + 1;
}

export interface DateRange {
  /** First day any occurrence (including moved overrides) may touch. */
  first: string;
  /** Last day any occurrence may touch; `null` for an open-ended series. */
  last: string | null;
}

/** Date range of an entry with its overrides, stored for `list(from, to)`. */
export function entryDateRange(
  entry: EditorEntryInput,
  overrides: Readonly<Record<string, EditorEntryInput>>,
): DateRange {
  let first = entry.date;
  let last: string | null =
    entry.repeat === "none"
      ? addCalendarDays(entry.date, spanDays(entry))
      : entry.repeat.weekly.until === undefined
        ? null
        : addCalendarDays(entry.repeat.weekly.until, spanDays(entry));
  for (const override of Object.values(overrides)) {
    if (override.date < first) {
      first = override.date;
    }
    const overrideLast = addCalendarDays(override.date, spanDays(override));
    if (last !== null && overrideLast > last) {
      last = overrideLast;
    }
  }
  return { first, last };
}

/**
 * Splits stored entries into those the config can express and those it no longer can
 * (`parseEditorEntryInput` fails, e.g. a removed child or an import from an older
 * config). The latter are listed as unresolved with their issues, so a parent can
 * change or delete them; the renderer skips them on the board.
 */
export function splitResolvable<
  E extends { id: string; revision: number; data: EditorEntryInput },
>(
  entries: readonly E[],
  config: CoreConfig,
): { resolvable: E[]; unresolved: EditorUnresolvedEntry[] } {
  const resolvable: E[] = [];
  const unresolved: EditorUnresolvedEntry[] = [];
  for (const entry of entries) {
    const parsed = parseEditorEntryInput(entry.data, config);
    if (parsed.ok) {
      resolvable.push(entry);
    } else {
      unresolved.push({
        entryId: entry.id,
        revision: entry.revision,
        entry: entry.data,
        issues: parsed.issues.map((issue) => ({
          code: issue.code,
          path: issue.path,
          message: issue.message,
        })),
      });
    }
  }
  return { resolvable, unresolved };
}

/**
 * Google occurrences as read-only list items. Built field by field from the
 * normalized board data (which never holds descriptions), so nothing beyond title,
 * icon, children, time and bring icons can reach the editor.
 */
export function googleEventItem(event: CalendarEvent): EditorGoogleItem {
  return {
    origin: "google",
    id: event.id,
    sourceId: event.sourceId,
    iconIsFallback: event.iconIsFallback,
    kind: "event",
    icon: event.icon,
    title: event.title,
    childIds: [...event.childIds],
    allDay: event.allDay,
    start: event.start,
    end: event.end,
    date: event.start.slice(0, 10),
    bring: [...(event.bring ?? [])],
    countdown: event.countdown,
  };
}

/** A Google meal is a whole day in its slot (`start` = its date, `end` = the next day). */
export function googleMealItem(meal: Meal): EditorGoogleItem {
  return {
    origin: "google",
    id: meal.id,
    sourceId: meal.sourceId,
    iconIsFallback: meal.iconIsFallback,
    kind: "meal",
    icon: meal.icon,
    title: meal.title,
    childIds: [],
    allDay: true,
    start: meal.date,
    end: addCalendarDays(meal.date, 1),
    date: meal.date,
    slot: meal.slot,
    bring: [],
    countdown: false,
  };
}

const SLOT_ORDER: Record<MealSlot, number> = {
  breakfast: 0,
  lunch: 1,
  dinner: 2,
  unspecified: 3,
};

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Start instant (epoch ms); all-day items start at midnight in the configured zone. */
export function itemStartMs(item: EditorListItem, timeZone: string): number {
  if (!item.allDay) {
    return Date.parse(item.start);
  }
  const date = parseCalendarDate(item.start);
  return date === null ? Number.NaN : startOfDayMs(date, timeZone);
}

/**
 * List order ("sorted by start"): start day, all-day before timed, start time, events
 * before meals, meal slot, title, id.
 */
export function compareItems(
  a: EditorListItem,
  b: EditorListItem,
  timeZone: string,
): number {
  return (
    compareText(a.date, b.date) ||
    Number(!a.allDay) - Number(!b.allDay) ||
    (a.allDay ? 0 : itemStartMs(a, timeZone) - itemStartMs(b, timeZone)) ||
    Number(a.kind === "meal") - Number(b.kind === "meal") ||
    (a.slot === undefined || b.slot === undefined
      ? 0
      : SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]) ||
    compareText(a.title, b.title) ||
    compareText(a.id, b.id)
  );
}

const VS16 = /️/gu;

interface Candidate {
  template: EditorTemplate;
  /** Distance of the representative occurrence from now (ms). */
  distanceMs: number;
}

/** Wall time `HH:mm` of a timed ISO string written with the configured zone's offset. */
function wallTime(iso: string): string {
  return iso.slice(11, 16);
}

/**
 * Up to {@link EDITOR_TEMPLATES_MAX} suggestions: items grouped by kind, icon (VS16
 * ignored), title and children; most occurrences first, then the group whose
 * representative (the occurrence nearest to now, which supplies times, slot, bring
 * icons and countdown) is nearest to now, then by title. Items whose title or icon
 * could not be saved as an app entry (empty or too long titles, text icons) are left
 * out, so every suggestion pre-fills a valid form.
 */
export function buildTemplates(
  items: readonly EditorListItem[],
  nowMs: number,
  timeZone: string,
): EditorTemplate[] {
  const groups = new Map<string, Candidate>();
  for (const item of items) {
    const title = EditorTitleSchema.safeParse(item.title);
    if (!title.success || !EmojiSchema.safeParse(item.icon).success) {
      continue;
    }
    const childIds = [...item.childIds].sort();
    const key = JSON.stringify([
      item.kind,
      item.icon.replace(VS16, ""),
      title.data,
      childIds,
    ]);
    const distanceMs = Math.abs(itemStartMs(item, timeZone) - nowMs);
    const known = groups.get(key);
    const origins = new Set(known?.template.origins ?? []);
    origins.add(item.origin);
    const count = (known?.template.count ?? 0) + 1;
    if (known !== undefined && !(distanceMs < known.distanceMs)) {
      known.template = {
        ...known.template,
        count,
        origins: [...origins].sort(),
      };
      continue;
    }
    // Only an end the form can hold: same day and after the start (Google allows
    // zero-length events).
    const sameDayEnd =
      !item.allDay &&
      item.end.slice(0, 10) === item.start.slice(0, 10) &&
      wallTime(item.end) > wallTime(item.start);
    groups.set(key, {
      distanceMs: Number.isNaN(distanceMs)
        ? Number.POSITIVE_INFINITY
        : distanceMs,
      template: {
        kind: item.kind,
        icon: item.icon,
        title: title.data,
        childIds: item.kind === "meal" ? [] : [...item.childIds],
        allDay: item.allDay,
        ...(item.allDay ? {} : { startTime: wallTime(item.start) }),
        ...(sameDayEnd ? { endTime: wallTime(item.end) } : {}),
        ...(item.slot === undefined ? {} : { slot: item.slot }),
        bring: item.kind === "meal" ? [] : [...item.bring],
        countdown: item.kind === "meal" ? false : item.countdown,
        count,
        origins: [...origins].sort(),
      },
    });
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        b.template.count - a.template.count ||
        a.distanceMs - b.distanceMs ||
        compareText(a.template.title, b.template.title),
    )
    .slice(0, EDITOR_TEMPLATES_MAX)
    .map((candidate) => candidate.template);
}
