import {
  addCalendarDays,
  addWallMinutes,
  calendarDaysBetween,
  type CalendarEvent,
  type EditorEntryInput,
  type EditorEntryInputRaw,
  type EditorGoogleItem,
  type EditorTemplate,
  EmojiSchema,
  formatInstant,
  isoWeekday,
  type MealSlot,
  minutesOfTime,
  parseEditorEntryInput,
  type PublicConfig,
  resolveTimedRange,
} from "@kidboard/shared";

import { minuteOfDay } from "../time/clock";

/*
 * The editor's form state (T-45) and its conversion to and from the shared editor model
 * (`EditorEntryInput`, T-39). Pure functions, the configured zone is always passed in.
 */

/** Duration presets of a timed entry, minutes. */
export const DURATION_PRESETS = [30, 45, 60, 90, 120, 180] as const;
export const DEFAULT_DURATION = 60;
/** Default start of a new timed entry (wall clock, configured zone). */
export const DEFAULT_START_TIME = "15:00";

export type RepeatMode = "none" | "weekly";

/** The event form. */
export interface EventDraft {
  /** `[]` = everyone. */
  childIds: string[];
  /** One emoji, `""` until one is picked. */
  icon: string;
  title: string;
  /**
   * The title is still the label of the picked catalogue icon (so picking another icon
   * replaces it); false as soon as the parent types.
   */
  titleFromLabel: boolean;
  date: string;
  allDay: boolean;
  /** `HH:mm`, timed entries. */
  startTime: string;
  /** Minutes, timed entries. */
  duration: number;
  /** Days an all-day entry covers (≥ 1; kept from an edited multi-day entry). */
  allDayDays: number;
  repeat: RepeatMode;
  /** ISO weekdays (1 = Monday) of a weekly entry, sorted. */
  weekdays: number[];
  interval: 1 | 2;
  /** Last day of a weekly series, `""` = no end. */
  until: string;
  bring: string[];
  countdown: boolean;
  /**
   * The rule day a weekly draft is anchored to when `date` is none: a series day that
   * was moved on its own ("only this day") and is now edited for every week. Its
   * weekday is the locked weekday chip, and the rule is checked from it, so the moved
   * day never adds its own weekday to the series. Cleared when the date is changed.
   */
  anchorDate?: string | undefined;
}

/** The meal form. */
export interface MealDraft {
  date: string;
  slot: MealSlot;
  icon: string;
  title: string;
  titleFromLabel: boolean;
  /** Kept from an edited weekly meal (the meal form has no repeat controls). */
  repeat: EditorEntryInput["repeat"];
}

export function newEventDraft(
  date: string,
  startTime: string = DEFAULT_START_TIME,
): EventDraft {
  return {
    childIds: [],
    icon: "",
    title: "",
    titleFromLabel: false,
    date,
    allDay: false,
    startTime,
    duration: DEFAULT_DURATION,
    allDayDays: 1,
    repeat: "none",
    weekdays: [isoWeekday(date)],
    interval: 1,
    until: "",
    bring: [],
    countdown: false,
  };
}

export function newMealDraft(date: string, slot: MealSlot): MealDraft {
  return {
    date,
    slot,
    icon: "",
    title: "",
    titleFromLabel: false,
    repeat: "none",
  };
}

/**
 * Day and start of a new entry made at `nowMs`: today at {@link DEFAULT_START_TIME}
 * while that is strictly ahead, or, from that minute on, today at the next full hour
 * (from 23:00 on, tomorrow at the default start, as no full hour of today is left). So
 * a fresh entry never starts in the past (see {@link startsInPast}).
 */
export function defaultStart(
  today: string,
  nowMs: number,
  timeZone: string,
): { date: string; startTime: string } {
  const minutes = minuteOfDay(nowMs, timeZone);
  if (minutes < minutesOfTime(DEFAULT_START_TIME)) {
    return { date: today, startTime: DEFAULT_START_TIME };
  }
  const hour = Math.floor(minutes / 60) + 1;
  if (hour >= 24) {
    return { date: addCalendarDays(today, 1), startTime: DEFAULT_START_TIME };
  }
  return { date: today, startTime: `${String(hour).padStart(2, "0")}:00` };
}

/**
 * Whether a one-off draft starts before `nowMs` (an all-day one: before `today`), for
 * a gentle hint; series are never "past" as their later days still come. Compared at
 * minute resolution: a start in the current minute is not past.
 */
export function startsInPast(
  draft: EventDraft,
  today: string,
  nowMs: number,
  timeZone: string,
): boolean {
  if (draft.repeat !== "none") return false;
  if (draft.allDay) return draft.date < today;
  const range = resolveTimedRange(
    { date: draft.date, startTime: draft.startTime, ...timedEnd(draft) },
    timeZone,
  );
  return range.startMs < nowMs - (nowMs % 60_000);
}

/**
 * Whether the form holds changes against what it opened with (ignoring the internal
 * "title still follows the picture" flag), so Cancel can ask before dropping them.
 */
export function draftChanged<T extends EventDraft | MealDraft>(
  draft: T,
  initial: T,
): boolean {
  const a: Record<string, unknown> = { ...draft };
  const b: Record<string, unknown> = { ...initial };
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("titleFromLabel");
  return [...keys].some(
    (key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]),
  );
}

function sortedUnique(days: readonly number[]): number[] {
  return [...new Set(days)].sort((a, b) => a - b);
}

/**
 * Moves the draft to `date`. A weekly draft keeps its weekdays but always includes the
 * new date's weekday (the first date must be a rule weekday); when it was only the old
 * date's weekday, the new one replaces it.
 */
export function withDate(draft: EventDraft, date: string): EventDraft {
  const oldDay = isoWeekday(ruleDate(draft));
  const newDay = isoWeekday(date);
  const onlyOld = draft.weekdays.length === 1 && draft.weekdays[0] === oldDay;
  return {
    ...draft,
    date,
    weekdays: onlyOld ? [newDay] : sortedUnique([...draft.weekdays, newDay]),
    until: draft.until !== "" && draft.until < date ? "" : draft.until,
    anchorDate: undefined,
  };
}

/** The date whose weekday a weekly draft's rule starts on (see `anchorDate`). */
export function ruleDate(draft: EventDraft): string {
  return draft.anchorDate ?? draft.date;
}

/** Toggles a weekday of a weekly draft; the date's own weekday always stays on. */
export function toggleWeekday(draft: EventDraft, day: number): EventDraft {
  if (day === isoWeekday(ruleDate(draft))) return draft;
  return {
    ...draft,
    weekdays: draft.weekdays.includes(day)
      ? draft.weekdays.filter((d) => d !== day)
      : sortedUnique([...draft.weekdays, day]),
  };
}

/** Whether `icon` is one of the configured countdown emoji (always a countdown). */
export function isCountdownIcon(
  icon: string,
  config: Pick<PublicConfig, "countdown">,
): boolean {
  const strip = (value: string): string => value.replace(/️/gu, "");
  return config.countdown.emojis.some((emoji) => strip(emoji) === strip(icon));
}

/** True when `value` (trimmed) is exactly one emoji (`EmojiSchema`). */
export function isEmoji(value: string): boolean {
  return EmojiSchema.safeParse(value.trim()).success;
}

/** The end of a timed draft: wall clock time and, when on a later day, its date. */
function timedEnd(draft: EventDraft): { endTime: string; endDate?: string } {
  const end = addWallMinutes(draft.date, draft.startTime, draft.duration);
  return end.date === draft.date
    ? { endTime: end.time }
    : { endTime: end.time, endDate: end.date };
}

/** The request body for `POST`/`PATCH` of an event draft. */
export function eventDraftToInput(draft: EventDraft): EditorEntryInputRaw {
  const base = {
    kind: "event" as const,
    childIds: [...draft.childIds],
    icon: draft.icon.trim(),
    title: draft.title,
    date: draft.date,
    bring: [...draft.bring],
    countdown: draft.countdown,
    repeat:
      draft.repeat === "none"
        ? ("none" as const)
        : {
            weekly: {
              weekdays: sortedUnique(draft.weekdays),
              interval: draft.interval,
              ...(draft.until === "" ? {} : { until: draft.until }),
            },
          },
  };
  if (draft.allDay) {
    return {
      ...base,
      allDay: true,
      ...(draft.allDayDays > 1
        ? { endDate: addCalendarDays(draft.date, draft.allDayDays) }
        : {}),
    };
  }
  return {
    ...base,
    allDay: false,
    startTime: draft.startTime,
    ...timedEnd(draft),
  };
}

/** The request body for a meal draft (meals are all-day entries in a slot). */
export function mealDraftToInput(draft: MealDraft): EditorEntryInputRaw {
  return {
    kind: "meal",
    childIds: [],
    icon: draft.icon.trim(),
    title: draft.title,
    allDay: true,
    date: draft.date,
    slot: draft.slot,
    repeat: draft.repeat,
  };
}

/** Minutes between start and end of a timed entry (default one hour). */
function durationOf(entry: EditorEntryInput): number {
  if (entry.startTime === undefined || entry.endTime === undefined) {
    return DEFAULT_DURATION;
  }
  const days =
    entry.endDate === undefined
      ? 0
      : calendarDaysBetween(entry.date, entry.endDate);
  const minutes =
    days * 1440 + minutesOfTime(entry.endTime) - minutesOfTime(entry.startTime);
  return minutes > 0 ? minutes : DEFAULT_DURATION;
}

/** An event draft showing a stored entry (or an "only this day" replacement). */
export function eventDraftFromEntry(entry: EditorEntryInput): EventDraft {
  const weekly = entry.repeat === "none" ? null : entry.repeat.weekly;
  return {
    childIds: [...entry.childIds],
    icon: entry.icon,
    title: entry.title,
    titleFromLabel: false,
    date: entry.date,
    allDay: entry.allDay,
    startTime: entry.startTime ?? DEFAULT_START_TIME,
    duration: entry.allDay ? DEFAULT_DURATION : durationOf(entry),
    allDayDays:
      entry.allDay && entry.endDate !== undefined
        ? Math.max(1, calendarDaysBetween(entry.date, entry.endDate))
        : 1,
    repeat: weekly === null ? "none" : "weekly",
    weekdays:
      weekly === null
        ? [isoWeekday(entry.date)]
        : sortedUnique([...weekly.weekdays, isoWeekday(entry.date)]),
    interval: weekly?.interval ?? 1,
    until: weekly?.until ?? "",
    bring: [...entry.bring],
    countdown: entry.countdown,
  };
}

export function mealDraftFromEntry(entry: EditorEntryInput): MealDraft {
  return {
    date: entry.date,
    slot: entry.slot ?? "unspecified",
    icon: entry.icon,
    title: entry.title,
    titleFromLabel: false,
    repeat: entry.repeat,
  };
}

/** A new event draft on `date` from a suggestion of the "Again" row. */
export function eventDraftFromTemplate(
  template: EditorTemplate,
  date: string,
): EventDraft {
  const draft = newEventDraft(date);
  return {
    ...draft,
    childIds: [...template.childIds],
    icon: template.icon,
    title: template.title,
    allDay: template.allDay,
    startTime: template.startTime ?? DEFAULT_START_TIME,
    duration:
      template.startTime !== undefined && template.endTime !== undefined
        ? Math.max(
            15,
            minutesOfTime(template.endTime) - minutesOfTime(template.startTime),
          )
        : DEFAULT_DURATION,
    bring: [...template.bring],
    countdown: template.countdown,
  };
}

/** Wall clock `HH:mm` of an ISO date-time with offset (its own offset, no zone math). */
function wallTime(iso: string): string {
  return iso.slice(11, 16);
}

/**
 * A new event draft like a Google occurrence ("use as template"): same children, icon,
 * title, time and bring list, on the same day unless it lies before `today`.
 */
export function eventDraftFromGoogle(
  item: EditorGoogleItem,
  today: string,
): EventDraft {
  const date = item.date < today ? today : item.date;
  const draft = newEventDraft(date);
  if (item.allDay) {
    return {
      ...draft,
      childIds: [...item.childIds],
      icon: item.iconIsFallback ? "" : item.icon,
      title: item.title.slice(0, 60),
      allDay: true,
      bring: [...item.bring],
      countdown: item.countdown,
    };
  }
  const startMs = Date.parse(item.start);
  const endMs = Date.parse(item.end);
  const minutes = Math.round((endMs - startMs) / 60_000);
  return {
    ...draft,
    childIds: [...item.childIds],
    icon: item.iconIsFallback ? "" : item.icon,
    title: item.title.slice(0, 60),
    allDay: false,
    startTime: wallTime(item.start),
    duration: minutes > 0 ? minutes : DEFAULT_DURATION,
    bring: [...item.bring],
    countdown: item.countdown,
  };
}

/** Problems of a draft the form shows next to its fields, before sending. */
export type DraftProblem =
  "icon" | "title" | "time" | "until" | "children" | "invalid";

/**
 * Checks an event draft like the worker will (`parseEditorEntryInput` with the public
 * config: shape, known children, end after start in the configured zone, countdown
 * icons) and maps the result to the form's fields. `[]` = ready to save.
 */
export function eventDraftProblems(
  draft: EventDraft,
  config: PublicConfig,
): DraftProblem[] {
  if (!isEmoji(draft.icon)) return ["icon"];
  // A day moved on its own is checked as the series it belongs to (from its rule day).
  const checked =
    draft.repeat === "weekly" ? { ...draft, date: ruleDate(draft) } : draft;
  const result = parseEditorEntryInput(eventDraftToInput(checked), config);
  return result.ok ? [] : problemsOf(result.issues);
}

export function mealDraftProblems(
  draft: MealDraft,
  config: PublicConfig,
): DraftProblem[] {
  if (!isEmoji(draft.icon)) return ["icon"];
  // The meal form has no repeat controls: a kept weekly rule is fitted when saving
  // (`mealSeriesWeekdays`), so only the meal itself is checked here.
  const result = parseEditorEntryInput(
    mealDraftToInput({ ...draft, repeat: "none" }),
    config,
  );
  return result.ok ? [] : problemsOf(result.issues);
}

/** Field problems of worker or local issues (`path` = dotted field path). */
export function problemsOf(
  issues: readonly { code: string; path: string }[],
): DraftProblem[] {
  const problems = new Set<DraftProblem>();
  for (const issue of issues) {
    const field = issue.path.split(".").find((part) => !/^\d+$/.test(part));
    const top = issue.path.startsWith("entries.") ? undefined : field;
    if (top === "icon") problems.add("icon");
    else if (top === "title") problems.add("title");
    else if (
      top === "startTime" ||
      top === "endTime" ||
      top === "endDate" ||
      issue.code === "time_range_invalid"
    )
      problems.add("time");
    else if (top === "repeat") problems.add("until");
    else if (top === "childIds") problems.add("children");
    else problems.add("invalid");
  }
  return [...problems];
}

/**
 * The tile the children will see for an event draft, for the live preview (`null` until
 * an icon is picked). Times are resolved in `timeZone` like the worker does.
 */
export function previewEvent(
  draft: EventDraft,
  timeZone: string,
  fallbackTitle: string,
): CalendarEvent | null {
  if (!isEmoji(draft.icon)) return null;
  const title = draft.title.trim().replace(/\s+/gu, " ");
  const base = {
    id: "preview",
    sourceId: "preview",
    title: title === "" ? fallbackTitle : title,
    icon: draft.icon.trim(),
    iconIsFallback: false,
    childIds: [...draft.childIds],
    countdown: draft.countdown,
    ...(draft.bring.length > 0 ? { bring: [...draft.bring] } : {}),
  };
  if (draft.allDay) {
    return {
      ...base,
      allDay: true,
      start: draft.date,
      end: addCalendarDays(draft.date, Math.max(1, draft.allDayDays)),
    };
  }
  const range = resolveTimedRange(
    { date: draft.date, startTime: draft.startTime, ...timedEnd(draft) },
    timeZone,
  );
  return {
    ...base,
    allDay: false,
    start: formatInstant(range.startMs, timeZone),
    end: formatInstant(Math.max(range.endMs, range.startMs + 60_000), timeZone),
  };
}

/**
 * Weekdays of a weekly meal saved "every week" from one of its days: a date moved in
 * the form (not `shownDate`) adds its weekday, or replaces the only one, as in the
 * event form; otherwise the stored rule stays.
 */
export function mealSeriesWeekdays(
  weekdays: readonly number[],
  shownDate: string,
  draftDate: string,
): number[] {
  const day = isoWeekday(draftDate);
  if (draftDate === shownDate || weekdays.includes(day)) return [...weekdays];
  const onlyShown =
    weekdays.length === 1 && weekdays[0] === isoWeekday(shownDate);
  return onlyShown ? [day] : sortedUnique([...weekdays, day]);
}

/**
 * Start date of a series edited "every week" from one of its occurrences: the stored
 * start when it still is one of the new weekdays, else the first such day after it.
 * A date moved in the form (≠ the occurrence) becomes the new start.
 */
export function seriesStartDate(
  master: EditorEntryInput,
  occurrenceDate: string,
  draft: EventDraft | MealDraft,
  weekdays: readonly number[],
): string {
  if (draft.date !== occurrenceDate) return draft.date;
  let date = master.date;
  for (let i = 0; i < 7; i += 1) {
    if (weekdays.includes(isoWeekday(date))) return date;
    date = addCalendarDays(date, 1);
  }
  return master.date;
}
