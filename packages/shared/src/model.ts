import { z } from "zod";

import {
  DateStringSchema,
  DateTimeStringSchema,
  EmojiSchema,
  SlugSchema,
  TimeZoneSchema,
} from "./primitives";
import { BRING_MAX } from "./title/parseBringList";

/**
 * Colour of a child: a design-token name (`child-1` ... `child-6`) or a hex colour
 * (`#rgb`, `#rrggbb`). Anything else is a configuration error, reported with its path
 * where the config is loaded, instead of silently falling back to grey on the board.
 */
export const ChildColorSchema = z
  .string()
  .trim()
  .regex(
    /^(?:child-[1-6]|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})$/,
    "Expected child-1 ... child-6 or a hex colour (#rgb, #rrggbb)",
  );

/** A configured child. */
export const ChildSchema = z.strictObject({
  id: SlugSchema,
  name: z.string().trim().min(1).max(40),
  color: ChildColorSchema,
  avatar: EmojiSchema,
});
export type Child = z.infer<typeof ChildSchema>;

export const CalendarKindSchema = z.enum(["events", "meals"]);
export type CalendarKind = z.infer<typeof CalendarKindSchema>;

/** One configured iCal feed. The URL itself is a secret and never part of this type. */
export const CalendarSourceSchema = z.strictObject({
  id: SlugSchema,
  kind: CalendarKindSchema,
  childId: SlugSchema.optional(),
  label: z.string().trim().min(1).max(60).optional(),
});
export type CalendarSource = z.infer<typeof CalendarSourceSchema>;

export const MealSlotSchema = z.enum([
  "breakfast",
  "lunch",
  "dinner",
  "unspecified",
]);
export type MealSlot = z.infer<typeof MealSlotSchema>;

const DateOrDateTimeSchema = z.union([DateStringSchema, DateTimeStringSchema]);

/** One concrete occurrence (recurrences are already expanded server-side). */
export const CalendarEventSchema = z
  .object({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    title: z.string(),
    icon: z.string().min(1),
    iconIsFallback: z.boolean(),
    childIds: z.array(z.string().min(1)),
    allDay: z.boolean(),
    /** ISO 8601 with offset (timed) or `YYYY-MM-DD` (all-day). */
    start: DateOrDateTimeSchema,
    /** Exclusive end, same format as `start`. */
    end: DateOrDateTimeSchema,
    countdown: z.boolean(),
    /**
     * Icons from the description's `Mitbringen:` / `Bring:` lines (ADR-0010), each a
     * single emoji, at most `BRING_MAX`. Omitted when there are none; data without the
     * field (persisted client data, old worker cache entries) stays valid.
     */
    bring: z.array(EmojiSchema).max(BRING_MAX).optional(),
  })
  .superRefine((event, ctx) => {
    const schema = event.allDay ? DateStringSchema : DateTimeStringSchema;
    const expected = event.allDay
      ? "YYYY-MM-DD (all-day event)"
      : "ISO 8601 with offset (timed event)";
    for (const key of ["start", "end"] as const) {
      if (!schema.safeParse(event[key]).success) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `Expected ${expected}`,
        });
      }
    }
  });
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const MealSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  /** `YYYY-MM-DD` in the configured time zone. */
  date: DateStringSchema,
  slot: MealSlotSchema,
  title: z.string(),
  icon: z.string().min(1),
  iconIsFallback: z.boolean(),
});
export type Meal = z.infer<typeof MealSchema>;

export const SourceStatusSchema = z.enum(["ok", "stale", "error"]);

export const AgendaResponseSchema = z.object({
  /** ISO timestamp of the underlying data. */
  generatedAt: DateTimeStringSchema,
  timeZone: TimeZoneSchema,
  /** `YYYY-MM-DD`, `to` exclusive. */
  range: z.object({ from: DateStringSchema, to: DateStringSchema }),
  /** True if at least one source was served from the last-good cache. */
  stale: z.boolean(),
  sources: z.array(
    z.object({
      id: z.string().min(1),
      status: SourceStatusSchema,
      /** When the served data was fetched from upstream (absent for `error`). */
      fetchedAt: DateTimeStringSchema.optional(),
      /** True if recurrence expansion hit a cap: some occurrences may be missing. */
      truncated: z.boolean().optional(),
    }),
  ),
  events: z.array(CalendarEventSchema),
  meals: z.array(MealSchema),
});
export type AgendaResponse = z.infer<typeof AgendaResponseSchema>;
