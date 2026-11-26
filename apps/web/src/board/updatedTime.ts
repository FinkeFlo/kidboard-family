import { type FormatContext, formatTime } from "../i18n/format";

/**
 * When the shown agenda was fetched (epoch ms, the query's `dataUpdatedAt`) as a time
 * that never breaks inside ("12:00 PM" keeps its space as U+00A0), or `undefined` when
 * unknown (0: a midnight seed or nothing fetched yet). Used by the rail's "Stand 15:18"
 * and the offline pill.
 */
export function formatUpdatedTime(
  updatedAt: number,
  format: FormatContext,
): string | undefined {
  if (!(updatedAt > 0)) return undefined;
  return formatTime(updatedAt, format).replace(/\s/gu, " ");
}
