import {
  type EditorAppItem,
  type EditorEntryInput,
  type EditorEntryInputRaw,
  isoWeekday,
} from "@kidboard/shared";

import type { EditorScope } from "../data";
import {
  type EventDraft,
  eventDraftFromEntry,
  type MealDraft,
  mealDraftFromEntry,
} from "./draft";
import type { EditorFailure } from "./failure";

/*
 * State shapes of the parent editor (`Editor.tsx`) and the pure part of opening an edit
 * form.
 */

/** What an edit form changes: the stored entry and which of its days was opened. */
export interface EditTarget {
  entryId: string;
  revision: number;
  /** The stored entry (series master for series). */
  master: EditorEntryInput;
  /** Original date of the opened series occurrence; `null` for single entries. */
  occurrenceDate: string | null;
  /** The date the form showed when it opened. */
  shownDate: string;
  /** The opened series day had its own change ("only this day" override). */
  hasOverride: boolean;
}

export type View =
  | { kind: "home" }
  | { kind: "event"; key: number; draft: EventDraft; target: EditTarget | null }
  | { kind: "meal"; key: number; draft: MealDraft; target: EditTarget | null };

export type Pending =
  | {
      kind: "scope";
      title: string;
      date: string;
      hasOverride: boolean;
      save: (scope: EditorScope) => void;
    }
  | { kind: "delete"; title: string; target: EditTarget }
  | { kind: "copy"; plan: EditorEntryInputRaw[] };

export type CopyState =
  | { kind: "nothing" }
  | { kind: "partial"; done: number; total: number; failure: EditorFailure };

const sortedDays = (days: readonly number[]): number[] =>
  [...new Set(days)].sort((a, b) => a - b);

/**
 * The series fields of `master` on a draft showing its day `occurrenceDate`. The rule
 * stays the stored one: a day moved on its own (another weekday) is anchored to its
 * rule day instead of adding its weekday (see `EventDraft.anchorDate`).
 */
function withSeries(
  draft: EventDraft,
  master: EditorEntryInput,
  occurrenceDate: string,
): EventDraft {
  const series = eventDraftFromEntry(master);
  const weekdays = sortedDays(series.weekdays);
  return {
    ...draft,
    repeat: series.repeat,
    interval: series.interval,
    until: series.until,
    weekdays,
    anchorDate: weekdays.includes(isoWeekday(draft.date))
      ? undefined
      : occurrenceDate,
  };
}

/** The form draft of one list item (the "only this day" replacement if it has one). */
export function draftOfItem(
  item: EditorAppItem,
): { kind: "event"; draft: EventDraft } | { kind: "meal"; draft: MealDraft } {
  const shown =
    item.override ??
    (item.occurrenceDate === null
      ? item.entry
      : { ...item.entry, date: item.occurrenceDate });
  if (item.kind === "meal") {
    return {
      kind: "meal",
      draft: { ...mealDraftFromEntry(shown), repeat: item.entry.repeat },
    };
  }
  const draft = eventDraftFromEntry(shown);
  return {
    kind: "event",
    draft:
      item.occurrenceDate === null
        ? draft
        : withSeries(draft, item.entry, item.occurrenceDate),
  };
}
