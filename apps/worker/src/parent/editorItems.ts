import {
  type AppConfig,
  type EditorAppItem,
  type EditorEntryInput,
  type EditorKind,
} from "@kidboard/shared";

import type { AppEntry } from "../entries/entryStore";
import { renderAppCalendar } from "../entries/renderCalendar";
import { expandCalendar } from "../ical/expandCalendar";
import { logWarn } from "../log";

const KINDS: readonly EditorKind[] = ["event", "meal"];

/**
 * Occurrences of the app entries overlapping `[from, to)`, through the same rendering
 * and expansion as the board (`renderAppCalendar` + `expandCalendar`), so the editor
 * lists exactly the days, times and DST handling the board shows. Each item carries
 * the stored entry, its revision and, for series, the original occurrence date and the
 * "only this day" replacement shown on it. Entries the config can no longer express
 * are skipped by the renderer (logged there by code and id).
 */
export function appItems(
  entries: readonly AppEntry[],
  range: { from: string; to: string },
  config: AppConfig,
): EditorAppItem[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const items: EditorAppItem[] = [];
  for (const kind of KINDS) {
    const expanded = expandCalendar(renderAppCalendar(entries, kind, config), {
      from: range.from,
      to: range.to,
      timeZone: config.timeZone,
    });
    if (expanded.truncated) {
      logWarn(`editor list: app ${kind} expansion truncated`);
    }
    for (const occurrence of expanded.occurrences) {
      const entry = byId.get(occurrence.uid);
      if (entry === undefined) {
        continue;
      }
      const occurrenceDate =
        occurrence.recurrenceId === null
          ? null
          : occurrence.recurrenceId.slice(0, 10);
      const override =
        occurrenceDate === null
          ? null
          : (entry.overrides[occurrenceDate] ?? null);
      const shown: EditorEntryInput = override ?? entry.data;
      items.push({
        origin: "app",
        id:
          occurrenceDate === null ? entry.id : `${entry.id}/${occurrenceDate}`,
        entryId: entry.id,
        revision: entry.revision,
        entry: entry.data,
        occurrenceDate,
        override,
        kind: shown.kind,
        icon: shown.icon,
        title: shown.title,
        childIds: [...shown.childIds],
        allDay: occurrence.allDay,
        start: occurrence.start,
        end: occurrence.end,
        date: occurrence.start.slice(0, 10),
        ...(shown.slot === undefined ? {} : { slot: shown.slot }),
        bring: [...shown.bring],
        countdown: shown.countdown,
      });
    }
  }
  return items;
}
