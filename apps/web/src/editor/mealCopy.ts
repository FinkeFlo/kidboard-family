import {
  addCalendarDays,
  type AppEntryDto,
  AppEntrySchema,
  type EditorEntryInputRaw,
} from "@kidboard/shared";
import { z } from "zod";

/*
 * "Repeat last week's meals" (T-45): the single app meals of the last seven days
 * (`today - 7` to `today - 1`) are copied to the same weekday of the next seven days
 * (`today` to `today + 6`). Weekly meals already repeat and are not copied. A meal of
 * the day that is already planned (any app meal, a weekly one or one from Google) is
 * never doubled: a copy is skipped when its day and slot are taken, so running it again
 * after a partial failure only adds what is still missing.
 */

/** Days copied: one week. */
export const MEAL_COPY_DAYS = 7;

const BackupSchema = z.object({ entries: z.array(z.unknown()) });

/** The readable entries of a backup document (`GET /api/parent/export`). */
export function entriesOfBackup(text: string): AppEntryDto[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  const backup = BackupSchema.safeParse(json);
  if (!backup.success) return [];
  return backup.data.entries.flatMap((entry) => {
    const parsed = AppEntrySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/** A meal of the day already planned (date and slot). */
export interface PlannedMeal {
  date: string;
  slot?: string | undefined;
}

function key(date: string, slot: string | undefined): string {
  return `${date}|${slot ?? "unspecified"}`;
}

/**
 * The meals to create, in date and slot order. `planned` adds the meals the export does
 * not show as single days (weekly app meals and Google meals of the editor list).
 */
export function planMealCopy(
  entries: readonly AppEntryDto[],
  today: string,
  planned: readonly PlannedMeal[] = [],
): EditorEntryInputRaw[] {
  const from = addCalendarDays(today, -MEAL_COPY_DAYS);
  const singles = entries
    .map((entry) => entry.data)
    .filter((data) => data.kind === "meal" && data.repeat === "none");
  // Taken before copying: several meals of one slot last week are all copied.
  const taken = new Set(
    [...singles, ...planned].map((meal) => key(meal.date, meal.slot)),
  );
  const order = ["breakfast", "lunch", "dinner", "unspecified"];
  return singles
    .filter((data) => data.date >= from && data.date < today)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        order.indexOf(a.slot ?? "unspecified") -
          order.indexOf(b.slot ?? "unspecified"),
    )
    .flatMap((data) => {
      const date = addCalendarDays(data.date, MEAL_COPY_DAYS);
      const slot = data.slot ?? "unspecified";
      if (taken.has(key(date, slot))) return [];
      return [
        {
          kind: "meal" as const,
          childIds: [],
          icon: data.icon,
          title: data.title,
          allDay: true,
          date,
          slot,
          repeat: "none" as const,
        },
      ];
    });
}
