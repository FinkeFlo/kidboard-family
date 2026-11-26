import { tz, TZDate } from "@date-fns/tz";
import { DateStringSchema, DateTimeStringSchema } from "@kidboard/shared";
import { format } from "date-fns";
import { de, enUS } from "date-fns/locale";
import { useTranslation } from "react-i18next";

import { type AppLocale, FALLBACK_LOCALE, matchLocale } from "./locale";

const DATE_FNS_LOCALES = { de, en: enUS } as const;

export interface FormatContext {
  locale: AppLocale;
  /** IANA zone from the config; the device zone is never used. */
  timeZone: string;
}

/**
 * A `Date`, an epoch timestamp (ms), or a string. Strings must be either
 * - a calendar date key `YYYY-MM-DD` (all-day `start`/`end`, `Meal.date`,
 *   `range.from`): interpreted as that calendar day in `ctx.timeZone`, or
 * - an ISO 8601 date-time with an explicit offset (`Z` or `+02:00`).
 * Anything else throws a `RangeError`; strings are never parsed in the device zone.
 */
type DateInput = Date | number | string;

/** Same shape as a date key; used to tell "malformed key" apart from "not a key". */
const DATE_KEY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** True if `value` is a string shaped like a `YYYY-MM-DD` date key. */
function isDateKey(value: DateInput): boolean {
  return typeof value === "string" && DATE_KEY_SHAPE.test(value);
}

function toInstant(value: DateInput, timeZone: string): Date | number {
  if (typeof value !== "string") return value;
  if (isDateKey(value)) {
    if (!DateStringSchema.safeParse(value).success) {
      throw new RangeError(`Invalid date key "${value}" (expected YYYY-MM-DD)`);
    }
    const [y, m, d] = value.split("-").map(Number) as [number, number, number];
    // Date keys name a calendar day in the configured zone, not UTC midnight.
    // Noon keeps clear of midnight and DST transitions (which happen at night).
    return new TZDate(y, m - 1, d, 12, timeZone);
  }
  if (!DateTimeStringSchema.safeParse(value).success) {
    throw new RangeError(
      `Invalid date-time "${value}" (expected YYYY-MM-DD or ISO 8601 with offset)`,
    );
  }
  return new Date(value);
}

function fmt(
  value: DateInput,
  pattern: string,
  { locale, timeZone }: FormatContext,
): string {
  return format(toInstant(value, timeZone), pattern, {
    locale: DATE_FNS_LOCALES[locale],
    in: tz(timeZone),
  });
}

/** Full weekday name, e.g. "Sonntag" / "Sunday". */
export function formatWeekday(value: DateInput, ctx: FormatContext): string {
  return fmt(value, "EEEE", ctx);
}

/** Short weekday for a small cue, e.g. "Di" / "Tue". */
export function formatWeekdayShort(
  value: DateInput,
  ctx: FormatContext,
): string {
  return fmt(value, ctx.locale === "de" ? "EEEEEE" : "EEE", ctx);
}

/** Long date, e.g. "26. Oktober 2025" / "October 26, 2025". */
export function formatLongDate(value: DateInput, ctx: FormatContext): string {
  return fmt(value, ctx.locale === "de" ? "d. MMMM yyyy" : "MMMM d, yyyy", ctx);
}

/** Day and month, e.g. "26. Oktober" / "October 26". */
export function formatDayMonth(value: DateInput, ctx: FormatContext): string {
  return fmt(value, ctx.locale === "de" ? "d. MMMM" : "MMMM d", ctx);
}

/** Day and abbreviated month for narrow columns, e.g. "26. Nov" / "Nov 26". */
export function formatDayMonthShort(
  value: DateInput,
  ctx: FormatContext,
): string {
  return fmt(value, ctx.locale === "de" ? "d. MMM" : "MMM d", ctx);
}

/**
 * Wall-clock time, 24 h for `de` ("14:30"), 12 h for `en` ("2:30 PM").
 * A `YYYY-MM-DD` date key has no time of day, so it throws a `RangeError`
 * instead of printing a made-up time.
 */
export function formatTime(value: DateInput, ctx: FormatContext): string {
  if (typeof value === "string" && isDateKey(value)) {
    throw new RangeError(`Date key "${value}" has no time of day`);
  }
  return fmt(value, ctx.locale === "de" ? "HH:mm" : "h:mm a", ctx);
}

/** Formatting context bound to the active UI language and the given zone. */
export function useFormatContext(timeZone: string): FormatContext {
  const { i18n } = useTranslation();
  return { locale: matchLocale(i18n.language) ?? FALLBACK_LOCALE, timeZone };
}
