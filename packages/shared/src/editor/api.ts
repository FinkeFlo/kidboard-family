import { z } from "zod";

import { MealSlotSchema, SourceStatusSchema } from "../model";
import {
  DateStringSchema,
  DateTimeStringSchema,
  EmojiSchema,
  TimeOfDaySchema,
  TimeZoneSchema,
} from "../primitives";
import { BRING_MAX } from "../title/parseBringList";
import {
  EDITOR_TITLE_MAX,
  EditorEntryInputSchema,
  EditorKindSchema,
} from "./entry";

/**
 * Response shapes of the editor API (`/api/parent/*`, T-43, ADR-0014), shared so the
 * web client can parse what the worker sends. Objects are not strict: a newer worker
 * may add fields that an older client ignores.
 */

/** What every successful write answers: the board should refetch the agenda now. */
export const BOARD_REFRESH_NOW = "now";

/** An app entry as stored by the worker (ADR-0014). */
export const AppEntrySchema = z.object({
  /** Random UUID. */
  id: z.string().min(1),
  /** Optimistic concurrency: a write names the revision it edited (409 on mismatch). */
  revision: z.number().int().min(1),
  kind: EditorKindSchema,
  data: EditorEntryInputSchema,
  /** Days of a series removed "only this day", sorted. */
  exdates: z.array(DateStringSchema),
  /** "Only this day" replacements keyed by the original occurrence date. */
  overrides: z.record(DateStringSchema, EditorEntryInputSchema),
  createdAt: DateTimeStringSchema,
  updatedAt: DateTimeStringSchema,
});
export type AppEntryDto = z.output<typeof AppEntrySchema>;

const DateOrDateTimeSchema = z.union([DateStringSchema, DateTimeStringSchema]);

/** Fields every list item has: what the child sees and when. */
const listItemShape = {
  kind: EditorKindSchema,
  icon: z.string().min(1),
  title: z.string(),
  /** Configured child ids; `[]` = everyone (always `[]` for meals). */
  childIds: z.array(z.string().min(1)),
  allDay: z.boolean(),
  /** ISO 8601 with the configured zone's offset (timed) or `YYYY-MM-DD` (all-day). */
  start: DateOrDateTimeSchema,
  /** Exclusive end, same format as `start`. */
  end: DateOrDateTimeSchema,
  /** Day of `start` in the configured zone. */
  date: DateStringSchema,
  /** Meals only. */
  slot: MealSlotSchema.optional(),
  /** Bring icons (events; `[]` otherwise). */
  bring: z.array(EmojiSchema).max(BRING_MAX),
  countdown: z.boolean(),
};

/** One occurrence of an app entry: editable. */
export const EditorAppItemSchema = z.object({
  origin: z.literal("app"),
  /** Unique per occurrence: the entry id, plus `/<occurrenceDate>` for series. */
  id: z.string().min(1),
  entryId: z.string().min(1),
  revision: z.number().int().min(1),
  /** The stored entry (the series master for series). */
  entry: EditorEntryInputSchema,
  /**
   * Series only: the original date of this occurrence (`date` of `scope=one` writes);
   * `null` for single entries.
   */
  occurrenceDate: DateStringSchema.nullable(),
  /** The "only this day" replacement shown on this occurrence, if any. */
  override: EditorEntryInputSchema.nullable(),
  ...listItemShape,
});
export type EditorAppItem = z.output<typeof EditorAppItemSchema>;

/**
 * One occurrence from a configured Google calendar: read-only, only what the board
 * shows (title, icon, children, time, bring icons); never a description.
 */
export const EditorGoogleItemSchema = z.object({
  origin: z.literal("google"),
  id: z.string().min(1),
  sourceId: z.string().min(1),
  iconIsFallback: z.boolean(),
  ...listItemShape,
});
export type EditorGoogleItem = z.output<typeof EditorGoogleItemSchema>;

export const EditorListItemSchema = z.discriminatedUnion("origin", [
  EditorAppItemSchema,
  EditorGoogleItemSchema,
]);
export type EditorListItem = z.output<typeof EditorListItemSchema>;

/** A field problem of a rejected entry or import (`parseEditorEntryInput` codes). */
export const EditorIssueSchema = z.object({
  code: z.string().min(1),
  /** Dotted field path, e.g. `title`, `childIds.0`, `entries.3.data.endTime`. */
  path: z.string(),
  message: z.string(),
});

/**
 * A stored app entry the current config can no longer express (e.g. its child was
 * removed from the config). The board skips it; the editor shows it so a parent can
 * change (`PATCH` with `revision`) or delete it. `issues` are the
 * `parseEditorEntryInput` problems against the current config.
 */
export const EditorUnresolvedEntrySchema = z.object({
  entryId: z.string().min(1),
  revision: z.number().int().min(1),
  entry: EditorEntryInputSchema,
  issues: z.array(EditorIssueSchema),
});
export type EditorUnresolvedEntry = z.output<
  typeof EditorUnresolvedEntrySchema
>;

/** `GET /api/parent/entries?from&days`. */
export const EditorListResponseSchema = z.object({
  timeZone: TimeZoneSchema,
  /** `to` exclusive. */
  range: z.object({ from: DateStringSchema, to: DateStringSchema }),
  /** Status of the configured Google calendars (app entries come straight from D1). */
  sources: z.array(
    z.object({ id: z.string().min(1), status: SourceStatusSchema }),
  ),
  /** Sorted by start: day, all-day first, time, events before meals, slot, title. */
  items: z.array(EditorListItemSchema),
  /**
   * App entries whose date range touches the requested days but that fail
   * `parseEditorEntryInput` against the current config; they are not in `items`.
   */
  unresolved: z.array(EditorUnresolvedEntrySchema).default([]),
  /**
   * True when the app entries could not be read (D1 unavailable): `items` then holds
   * only the Google occurrences.
   */
  storageUnavailable: z.boolean().default(false),
});
export type EditorListResponse = z.output<typeof EditorListResponseSchema>;

/**
 * `GET /api/parent/feed` (ADR-0014 "Getting data out"): the relative URL of the phone
 * feed, `/api/feed.ics?token=<token>`, present only while the feed is configured. The token
 * is a secret: show it to the unlocked parent only, never log or cache it.
 */
export const ParentFeedResponseSchema = z.object({
  feedUrl: z
    .string()
    .regex(/^\/api\/feed\.ics\?token=[A-Za-z0-9_-]{32,256}$/)
    .optional(),
});
export type ParentFeedResponse = z.output<typeof ParentFeedResponseSchema>;

/** A suggestion for a new app entry ("Again" row), built from recent occurrences. */
export const EditorTemplateSchema = z.object({
  kind: EditorKindSchema,
  icon: EmojiSchema,
  title: z.string().min(1).max(EDITOR_TITLE_MAX),
  childIds: z.array(z.string().min(1)),
  allDay: z.boolean(),
  /** Timed suggestions only (wall clock, configured zone). */
  startTime: TimeOfDaySchema.optional(),
  /** Timed suggestions that end on their start day only. */
  endTime: TimeOfDaySchema.optional(),
  slot: MealSlotSchema.optional(),
  bring: z.array(EmojiSchema).max(BRING_MAX),
  countdown: z.boolean(),
  /** Occurrences with the same kind, icon, title and children in the template window. */
  count: z.number().int().min(1),
  origins: z.array(z.enum(["app", "google"])).min(1),
});
export type EditorTemplate = z.output<typeof EditorTemplateSchema>;

/** At most this many suggestions. */
export const EDITOR_TEMPLATES_MAX = 12;

/** `GET /api/parent/templates`. */
export const EditorTemplatesResponseSchema = z.object({
  templates: z.array(EditorTemplateSchema).max(EDITOR_TEMPLATES_MAX),
});
export type EditorTemplatesResponse = z.output<
  typeof EditorTemplatesResponseSchema
>;

/** `POST`/`PATCH`/`DELETE /api/parent/entries…`; `entry` is `null` after a full delete. */
export const EditorWriteResponseSchema = z.object({
  entry: AppEntrySchema.nullable(),
  boardRefresh: z.literal(BOARD_REFRESH_NOW),
});
export type EditorWriteResponse = z.output<typeof EditorWriteResponseSchema>;

export const ImportModeSchema = z.enum(["merge", "replace"]);
export type ImportModeValue = z.output<typeof ImportModeSchema>;

/**
 * `POST /api/parent/import?mode=merge|replace`: `imported` = `created` (ids that were
 * not stored before) + `updated` (ids that replaced a stored entry).
 */
export const EditorImportResponseSchema = z
  .object({
    mode: ImportModeSchema,
    imported: z.number().int().min(0),
    created: z.number().int().min(0),
    updated: z.number().int().min(0),
    boardRefresh: z.literal(BOARD_REFRESH_NOW),
  })
  .refine((r) => r.created + r.updated === r.imported, {
    path: ["imported"],
    message: "imported must equal created + updated",
  });
export type EditorImportResponse = z.output<typeof EditorImportResponseSchema>;

/**
 * Error body of the parent API. `error` codes: `bad_request` (400), `parent_locked`
 * (403, no or an invalid session), `wrong_pin` (403 at unlock, with `attemptsLeft`),
 * `not_found` (404, also every route while the editor is off), `conflict` (409, with
 * the current `revision`), `payload_too_large` (413), `invalid_entry` (422, with
 * `issues`), `limit_reached` (422, `limit`: `entries` = 1 000 entries, `size` = 8 KB
 * per entry), `parent_lockout` (429 at unlock, with `retryAfterSeconds` and a
 * `Retry-After` header), `server_misconfigured` (500, invalid `KIDBOARD_CONFIG`),
 * `storage_unavailable` (503, D1 unavailable; retry later). 401 belongs to the access
 * token only.
 */
export const EditorErrorResponseSchema = z.object({
  error: z.string().min(1),
  message: z.string(),
  issues: z.array(EditorIssueSchema).optional(),
  revision: z.number().int().min(1).optional(),
  limit: z.enum(["entries", "size"]).optional(),
  attemptsLeft: z.number().int().min(0).optional(),
  retryAfterSeconds: z.number().int().min(0).optional(),
});
export type EditorErrorResponse = z.output<typeof EditorErrorResponseSchema>;
