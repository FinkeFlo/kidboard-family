import type { CoreConfig } from "../config";
import {
  composeTitle,
  EditorCompositionError,
  type EditorCompositionErrorCode,
  type WriteLocale,
} from "./composeTitle";
import { type EditorEntryInput, EditorEntryInputSchema } from "./entry";
import { resolveTimedRange } from "./timeRange";

export type EditorIssueCode =
  /** Shape or structural rule of {@link EditorEntryInputSchema}. */
  | "invalid"
  /** A child id that is not configured. */
  | "unknown_child"
  /** The icon is a countdown emoji (always a countdown) but `countdown` is false. */
  | "countdown_icon"
  /** The entry cannot be written so that the title reads back the same (see composeTitle). */
  | "title_not_expressible"
  /** The children cannot be expressed in the given calendar. */
  | "children_not_expressible"
  /**
   * The end is not after the start once both are resolved in the configured zone (a
   * start in a spring-forward gap moves forward, see `resolveTimedRange`).
   */
  | "time_range_invalid";

export interface EditorIssue {
  code: EditorIssueCode;
  path: string;
  message: string;
}

export type ParseEditorEntryResult =
  { ok: true; entry: EditorEntryInput } | { ok: false; issues: EditorIssue[] };

export interface ParseEditorEntryOptions {
  /** Calendar the entry will be written to (per-child calendars change the title). */
  sourceId?: string | undefined;
  locale?: WriteLocale | undefined;
}

const COMPOSITION_ISSUES: Record<EditorCompositionErrorCode, EditorIssue> = {
  unknown_source: {
    code: "invalid",
    path: "sourceId",
    message: "Unknown calendar",
  },
  unknown_child: {
    code: "unknown_child",
    path: "childIds",
    message: "Unknown child id",
  },
  children_not_expressible: {
    code: "children_not_expressible",
    path: "childIds",
    message: "These children cannot be written into this calendar",
  },
  title_not_expressible: {
    code: "title_not_expressible",
    path: "title",
    message: "This title cannot be written so that it reads back the same",
  },
};

function strip(value: string): string {
  return value.replace(/\uFE0F/gu, "");
}

/**
 * Validates an editor request body against {@link EditorEntryInputSchema} and the
 * config: child ids must be configured, a countdown icon implies `countdown: true`
 * (it is derived from the icon when read back), the end must lie after the start in
 * `config.timeZone` (DST gaps, `time_range_invalid`), and the title must be writable so
 * that `parseTitle` returns the same children, icon, title and slot. Never throws.
 */
export function parseEditorEntryInput(
  value: unknown,
  config: CoreConfig,
  options: ParseEditorEntryOptions = {},
): ParseEditorEntryResult {
  const result = EditorEntryInputSchema.safeParse(value);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        code: "invalid",
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    };
  }
  const entry = result.data;
  const issues: EditorIssue[] = [];
  const known = new Set(config.children.map((child) => child.id));
  entry.childIds.forEach((id, i) => {
    if (!known.has(id)) {
      issues.push({
        code: "unknown_child",
        path: `childIds.${String(i)}`,
        message: `Unknown child id "${id}"`,
      });
    }
  });
  if (
    entry.kind === "event" &&
    !entry.countdown &&
    config.countdown.emojis.some((emoji) => strip(emoji) === strip(entry.icon))
  ) {
    issues.push({
      code: "countdown_icon",
      path: "countdown",
      message: "This icon always shows a countdown",
    });
  }
  if (
    !entry.allDay &&
    entry.startTime !== undefined &&
    !resolveTimedRange(
      { ...entry, startTime: entry.startTime },
      config.timeZone,
    ).valid
  ) {
    issues.push({
      code: "time_range_invalid",
      path: "endTime",
      message: "End must be after start in the configured time zone",
    });
  }
  if (issues.length === 0) {
    try {
      composeTitle(entry, config, options);
    } catch (error) {
      if (!(error instanceof EditorCompositionError)) {
        throw error;
      }
      issues.push(COMPOSITION_ISSUES[error.code]);
    }
  }
  return issues.length === 0 ? { ok: true, entry } : { ok: false, issues };
}
