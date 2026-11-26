import { z } from "zod";

import { calendarDaysBetween, isDateKey } from "../dates";
import { MealSlotSchema } from "../model";
import {
  DateStringSchema,
  EmojiSchema,
  SlugSchema,
  TimeOfDaySchema,
} from "../primitives";
import { minutesOfTime } from "../primitives";
import { BRING_MAX } from "../title/parseBringList";
import { isoWeekday } from "./zonedTime";

/**
 * The editor model (T-39, ADR-0012): one runtime-agnostic description of an entry that
 * the parent editor creates or changes. The worker stores it in D1 and renders it as
 * iCalendar (ADR-0014) using the ADR-0005 / ADR-0010 title and description
 * conventions, so entries written by the editor read exactly like hand-written ones.
 */

/** Max length of an editor title (UTF-16 code units, after whitespace normalisation). */
export const EDITOR_TITLE_MAX = 60;

/** Line breaks and other control characters (incl. tab) are not allowed in titles. */
const CONTROL_OR_LINE_BREAK = /[\p{Cc}\u2028\u2029]/u;

/**
 * Plain-text title: trimmed, inner whitespace collapsed to one space (exactly like
 * `parseTitle` step 1, so the round trip is exact), 1-60 characters, no line breaks.
 */
export const EditorTitleSchema = z
  .string()
  .trim()
  .refine((value) => !CONTROL_OR_LINE_BREAK.test(value), {
    message: "Title must be one line of plain text",
  })
  .transform((value) => value.replace(/\s+/gu, " "))
  .pipe(z.string().min(1).max(EDITOR_TITLE_MAX));

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export const WeekdaySchema = z.number().int().min(1).max(7);

export const WeeklyRepeatSchema = z.strictObject({
  weekly: z.strictObject({
    weekdays: z
      .array(WeekdaySchema)
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length, {
        message: "Weekdays must be unique",
      }),
    interval: z.union([z.literal(1), z.literal(2)]).default(1),
    /** Last day of the series (inclusive, `YYYY-MM-DD` in the configured zone). */
    until: DateStringSchema.optional(),
  }),
});
export type WeeklyRepeat = z.infer<typeof WeeklyRepeatSchema>;

export const EditorRepeatSchema = z.union([
  z.literal("none"),
  WeeklyRepeatSchema,
]);
export type EditorRepeat = z.infer<typeof EditorRepeatSchema>;

export const EditorKindSchema = z.enum(["event", "meal"]);
export type EditorKind = z.infer<typeof EditorKindSchema>;

const VS16 = /\uFE0F/gu;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const BringSchema = z
  .array(EmojiSchema)
  .max(BRING_MAX)
  .refine(
    (icons) =>
      new Set(icons.map((icon) => icon.replace(VS16, ""))).size ===
      icons.length,
    { message: "Bring icons must be unique" },
  );

const baseShape = {
  kind: EditorKindSchema,
  /** Configured child ids; `[]` = everyone. Always `[]` for meals. */
  childIds: z.array(SlugSchema).default([]),
  icon: EmojiSchema,
  allDay: z.boolean(),
  /** First day (`YYYY-MM-DD`, configured zone). */
  date: DateStringSchema,
  /** Timed entries only. */
  startTime: TimeOfDaySchema.optional(),
  /** Timed entries only; default: one hour (wall clock) after `startTime`. */
  endTime: TimeOfDaySchema.optional(),
  /**
   * All-day: exclusive end date (multi-day; default `date` + 1). Timed: the date of
   * `endTime` when the entry ends on a later day (default `date`).
   */
  endDate: DateStringSchema.optional(),
  repeat: EditorRepeatSchema.default("none"),
  /** Bring icons (events only, ADR-0010). */
  bring: BringSchema.default([]),
  /** Countdown flag (events only). */
  countdown: z.boolean().default(false),
  /** Meals only. */
  slot: MealSlotSchema.optional(),
};

interface RefinableEntry {
  kind: EditorKind;
  childIds: string[];
  allDay: boolean;
  date: string;
  startTime?: string | undefined;
  endTime?: string | undefined;
  endDate?: string | undefined;
  repeat: EditorRepeat;
  bring: string[];
  countdown: boolean;
  slot?: string | undefined;
}

/** Structural rules of an input entry; the end must be strictly after the start. */
function refineEntry(entry: RefinableEntry, ctx: z.RefinementCtx): void {
  // Field checks (formats) do not abort the object; skip cross-field rules on
  // malformed dates/times, their own issues are already reported.
  const dates = [entry.date, entry.endDate];
  if (entry.repeat !== "none") {
    dates.push(entry.repeat.weekly.until);
  }
  if (
    dates.some((date) => date !== undefined && !isDateKey(date)) ||
    [entry.startTime, entry.endTime].some(
      (time) => time !== undefined && !TIME_RE.test(time),
    )
  ) {
    return;
  }
  const issue = (path: string, message: string): void => {
    ctx.addIssue({ code: "custom", path: [path], message });
  };
  if (new Set(entry.childIds).size !== entry.childIds.length) {
    issue("childIds", "Child ids must be unique");
  }
  if (entry.kind === "meal") {
    if (entry.slot === undefined) {
      issue("slot", "Meals need a slot");
    }
    if (entry.childIds.length > 0) {
      issue("childIds", "Meals have no children");
    }
    if (entry.bring.length > 0) {
      issue("bring", "Meals have no bring list");
    }
    if (entry.countdown) {
      issue("countdown", "Meals have no countdown");
    }
  } else if (entry.slot !== undefined) {
    issue("slot", "Only meals have a slot");
  }

  if (entry.allDay) {
    if (entry.startTime !== undefined || entry.endTime !== undefined) {
      issue("startTime", "All-day entries have no times");
    }
    if (
      entry.endDate !== undefined &&
      calendarDaysBetween(entry.date, entry.endDate) < 1
    ) {
      issue("endDate", "endDate (exclusive) must be after date");
    }
  } else if (entry.startTime === undefined) {
    issue("startTime", "Timed entries need a startTime");
  } else {
    const endDay =
      entry.endDate === undefined
        ? 0
        : calendarDaysBetween(entry.date, entry.endDate);
    if (entry.endDate !== undefined && entry.endTime === undefined) {
      issue("endTime", "endDate needs an endTime");
    }
    if (endDay < 0) {
      issue("endDate", "endDate must not be before date");
    } else if (entry.endTime !== undefined) {
      const start = minutesOfTime(entry.startTime);
      const end = endDay * 1440 + minutesOfTime(entry.endTime);
      if (end <= start) {
        issue("endTime", "End must be after start");
      }
    }
  }

  if (entry.repeat !== "none") {
    const { weekdays, until } = entry.repeat.weekly;
    if (!weekdays.includes(isoWeekday(entry.date))) {
      issue("repeat", "The first date must be one of the weekdays");
    }
    if (until !== undefined && calendarDaysBetween(entry.date, until) < 0) {
      issue("repeat", "until must not be before date");
    }
  }
}

/** What the editor sends to create or change an entry (validated at the API boundary). */
export const EditorEntryInputSchema = z
  .strictObject({ ...baseShape, title: EditorTitleSchema })
  .superRefine(refineEntry);
export type EditorEntryInput = z.output<typeof EditorEntryInputSchema>;
/** Input as sent by a client (defaults optional). */
export type EditorEntryInputRaw = z.input<typeof EditorEntryInputSchema>;
