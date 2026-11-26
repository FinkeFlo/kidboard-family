import { addCalendarDays } from "@kidboard/shared";
import type { TFunction } from "i18next";

import {
  type FormatContext,
  formatDayMonthShort,
  formatWeekday,
  formatWeekdayShort,
} from "../i18n/format";

/** "Today", "Tomorrow" or "Tue, Nov 24" / "Di., 24. Nov" for a date key. */
export function dayLabel(
  date: string,
  today: string,
  format: FormatContext,
  t: TFunction,
): string {
  if (date === today) return t("editor.day.today");
  if (date === addCalendarDays(today, 1)) return t("editor.day.tomorrow");
  return t("editor.day.date", {
    weekday: formatWeekdayShort(date, format),
    date: formatDayMonthShort(date, format),
  });
}

/** Always the weekday and date, e.g. "Tue, Nov 24" (for "only on <date>"). */
export function dateLabel(
  date: string,
  format: FormatContext,
  t: TFunction,
): string {
  return t("editor.day.date", {
    weekday: formatWeekdayShort(date, format),
    date: formatDayMonthShort(date, format),
  });
}

/** A Monday (2024-01-01), so weekday `n` (1 = Monday) is `n - 1` days later. */
const REFERENCE_MONDAY = "2024-01-01";

/** Short name of ISO weekday `day` (1 = Monday), e.g. "Mo" / "Mon". */
export function weekdayShort(day: number, format: FormatContext): string {
  return formatWeekdayShort(addCalendarDays(REFERENCE_MONDAY, day - 1), format);
}

/** Full name of ISO weekday `day`, e.g. "Montag" / "Monday". */
export function weekdayLong(day: number, format: FormatContext): string {
  return formatWeekday(addCalendarDays(REFERENCE_MONDAY, day - 1), format);
}
