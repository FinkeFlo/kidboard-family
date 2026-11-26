import {
  addCalendarDays,
  addWallMinutes,
  type AppConfig,
  buildRecurrenceRule,
  composeDescription,
  composeTitle,
  EditorCompositionError,
  type EditorEntryInput,
  type EditorKind,
  resolveTimedRange,
  resolveWriteLocale,
  wallTimeInZone,
  type WriteLocale,
  zonedWallTimeToEpochMs,
} from "@kidboard/shared";
import ICAL from "ical.js";

import { errorName } from "../http/errors";
import { logWarn } from "../log";
import type { AppEntry } from "./entryStore";

/** `PRODID` of the in-memory calendar (never published as is). */
export const APP_CALENDAR_PRODID = "-//KidBoard//App entries//EN";

/** Wall-clock date and time (`YYYY-MM-DD`, `HH:mm`) in the configured zone. */
interface Wall {
  date: string;
  time: string;
}

function dateTime(date: string, time?: string): ICAL.Time {
  const [year = 0, month = 0, day = 0] = date.split("-").map(Number);
  if (time === undefined) {
    return ICAL.Time.fromData({ year, month, day, isDate: true });
  }
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  return ICAL.Time.fromData({
    year,
    month,
    day,
    hour,
    minute,
    second: 0,
    isDate: false,
  });
}

/**
 * Adds a DATE (`time` absent) or a wall-clock DATE-TIME with `TZID` = the configured
 * zone. No VTIMEZONE is written here: the expansion converts IANA TZIDs with the
 * runtime's tz database (ADR-0003, ADR-0008), exactly as for Google feeds. The phone
 * feed adds one for other calendar apps (`feed/renderFeed.ts`).
 */
function addTime(
  component: ICAL.Component,
  name: string,
  timeZone: string,
  date: string,
  time?: string,
): void {
  const property = component.addPropertyWithValue(name, dateTime(date, time));
  if (time !== undefined) {
    property.setParameter("tzid", timeZone);
  }
}

/**
 * End of a timed entry as a wall time: the given end, or one hour later on the wall
 * clock; when the start lies in a spring-forward gap, the wall time of start + 60 real
 * minutes (the `resolveTimedRange` rule of T-39, so the board matches the editor).
 */
function timedEnd(entry: EditorEntryInput, timeZone: string): Wall {
  const startTime = entry.startTime ?? "00:00";
  if (entry.endTime !== undefined) {
    return { date: entry.endDate ?? entry.date, time: entry.endTime };
  }
  const wall = addWallMinutes(entry.date, startTime, 60);
  const range = resolveTimedRange({ date: entry.date, startTime }, timeZone);
  return zonedWallTimeToEpochMs(wall.date, wall.time, timeZone) === range.endMs
    ? wall
    : wallTimeInZone(range.endMs, timeZone);
}

/** SUMMARY, DESCRIPTION, DTSTART and DTEND of one entry (master or override). */
function addContent(
  component: ICAL.Component,
  entry: EditorEntryInput,
  config: AppConfig,
  locale: WriteLocale,
): void {
  const timeZone = config.timeZone;
  component.addPropertyWithValue(
    "summary",
    composeTitle(entry, config, { locale }),
  );
  // Only what the editor writes (ADR-0014 privacy): the bring line and the marker.
  const description =
    entry.kind === "meal"
      ? ""
      : composeDescription("", {
          bring: entry.bring,
          countdown: entry.countdown,
          locale,
        });
  if (description !== "") {
    component.addPropertyWithValue("description", description);
  }
  if (entry.allDay) {
    addTime(component, "dtstart", timeZone, entry.date);
    addTime(
      component,
      "dtend",
      timeZone,
      entry.endDate ?? addCalendarDays(entry.date, 1),
    );
    return;
  }
  addTime(component, "dtstart", timeZone, entry.date, entry.startTime);
  const end = timedEnd(entry, timeZone);
  addTime(component, "dtend", timeZone, end.date, end.time);
}

function newEvent(entry: AppEntry): ICAL.Component {
  const component = new ICAL.Component("vevent");
  component.addPropertyWithValue("uid", entry.id);
  component.addPropertyWithValue(
    "dtstamp",
    ICAL.Time.fromJSDate(new Date(entry.updatedAt), true),
  );
  return component;
}

function compositionCode(error: unknown): string {
  if (error instanceof EditorCompositionError) {
    return error.code;
  }
  // Unexpected: log the type only (never entry text).
  return `internal ${errorName(error)}`;
}

/**
 * The VEVENTs of one stored entry: the master (with `RRULE` and one `EXDATE` per removed
 * day) and one `RECURRENCE-ID` component per "only this day" override. An override
 * that cannot be written any more (e.g. its child was removed from the config) hides
 * that day instead (`EXDATE`); an unwritable master skips the whole entry. Both are
 * logged by error code and entry id only.
 */
function entryComponents(
  entry: AppEntry,
  config: AppConfig,
  locale: WriteLocale,
): ICAL.Component[] {
  const timeZone = config.timeZone;
  const master = entry.data;
  const startTime = master.allDay ? undefined : master.startTime;
  const event = newEvent(entry);
  let rule: string | null;
  try {
    addContent(event, master, config, locale);
    rule = buildRecurrenceRule(
      master.repeat,
      { date: master.date, startTime },
      timeZone,
    );
  } catch (error) {
    logWarn(
      `skipped app entry ${entry.id}: ${compositionCode(error)} (config changed?)`,
    );
    return [];
  }
  if (rule === null) {
    return [event];
  }
  event.addPropertyWithValue("rrule", ICAL.Recur.fromString(rule));

  const hidden = new Set(entry.exdates);
  const overrides: ICAL.Component[] = [];
  for (const [date, override] of Object.entries(entry.overrides)) {
    const component = newEvent(entry);
    try {
      addContent(component, override, config, locale);
    } catch (error) {
      logWarn(
        `hid one day of app entry ${entry.id}: ${compositionCode(error)} (config changed?)`,
      );
      hidden.add(date);
      continue;
    }
    // The original occurrence, in the same value type and zone as the master's DTSTART.
    addTime(component, "recurrence-id", timeZone, date, startTime);
    overrides.push(component);
  }
  for (const date of [...hidden].sort()) {
    addTime(event, "exdate", timeZone, date, startTime);
  }
  return [event, ...overrides];
}

/**
 * The VEVENTs of the stored app entries of the given kinds (see
 * {@link renderAppCalendar}); shared with the phone feed (`feed/renderFeed.ts`), so the
 * feed carries exactly what the board expands.
 */
export function appEventComponents(
  entries: readonly AppEntry[],
  kinds: readonly EditorKind[],
  config: AppConfig,
): ICAL.Component[] {
  const locale = resolveWriteLocale(config.locale);
  return entries
    .filter((entry) => kinds.includes(entry.kind))
    .flatMap((entry) => entryComponents(entry, config, locale));
}

/**
 * Renders the stored app entries of one `kind` as an iCalendar document (ADR-0014),
 * written with the same conventions as hand-written Google events: titles via
 * `composeTitle` (ADR-0005), bring list and `#countdown` via `composeDescription`
 * (ADR-0010), weekly rules via `buildRecurrenceRule`, all times as wall-clock times
 * with `TZID` = `config.timeZone` (never the device zone, ADR-0008). The result goes
 * through the same `expandCalendar`/`normalize` path as a fetched feed (ADR-0003).
 * Titles are plain text; ical.js escapes them as iCalendar TEXT.
 */
export function renderAppCalendar(
  entries: readonly AppEntry[],
  kind: EditorKind,
  config: AppConfig,
): string {
  const calendar = new ICAL.Component("vcalendar");
  calendar.addPropertyWithValue("prodid", APP_CALENDAR_PRODID);
  calendar.addPropertyWithValue("version", "2.0");
  for (const component of appEventComponents(entries, [kind], config)) {
    calendar.addSubcomponent(component);
  }
  return calendar.toString();
}
