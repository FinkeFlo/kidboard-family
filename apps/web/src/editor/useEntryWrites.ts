import type { EditorEntryInputRaw } from "@kidboard/shared";
import { useTranslation } from "react-i18next";

import { EditorApiError, type EditorScope } from "../data";
import {
  type EventDraft,
  eventDraftToInput,
  type MealDraft,
  mealDraftToInput,
  mealSeriesWeekdays,
  seriesStartDate,
} from "./draft";
import type { EditorActionContext } from "./editorActions";
import type { EditTarget } from "./editorState";
import { type EditorFailure, toFailure } from "./failure";

export interface EntryWrites {
  saveEvent: (draft: EventDraft, target: EditTarget | null) => void;
  saveMeal: (draft: MealDraft, target: EditTarget | null) => void;
  remove: (target: EditTarget, scope: EditorScope) => void;
}

/**
 * The editor's write paths: create and save events and meals (a series asks for its
 * scope first), delete. Success goes home with a toast and refreshes list and board; a
 * failure keeps the form, and a conflict adopts the newer revision.
 */
export function useEntryWrites(context: EditorActionContext): EntryWrites {
  const { t } = useTranslation();
  const {
    api,
    token,
    setView,
    setPending,
    setToast,
    setBusy,
    setFailure,
    reload,
    refreshBoard,
  } = context;

  /** Runs one write; success → home, toast, list and board refreshed. */
  const write = async (
    op: () => Promise<unknown>,
    message: string,
    purpose: "save" | "delete" = "save",
  ): Promise<boolean> => {
    setBusy(true);
    setFailure(null);
    try {
      await op();
      setView({ kind: "home" });
      setToast(message);
      refreshBoard();
      return true;
    } catch (error) {
      const classified = toFailure(error);
      const next: EditorFailure =
        classified.kind === "conflict" && purpose === "delete"
          ? { ...classified, kind: "conflictDelete" }
          : classified;
      setFailure(next);
      if (
        (next.kind === "conflict" || next.kind === "conflictDelete") &&
        error instanceof EditorApiError &&
        error.revision !== undefined
      ) {
        // Saving (or deleting) again acts on the newer version on purpose (the message
        // says so).
        const revision = error.revision;
        setView((current) =>
          current.kind !== "home" && current.target !== null
            ? { ...current, target: { ...current.target, revision } }
            : current,
        );
      }
      if (
        next.kind === "conflict" ||
        next.kind === "conflictDelete" ||
        next.kind === "notFound"
      ) {
        reload();
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  /**
   * Saves a series ("every week"). When the opened day had its own change, the worker
   * keeps it, so that day would not show the new entry: it then gets what the form
   * showed ("only this day", with the series' new revision). A failure there keeps the
   * form with the new revision, so saving again repeats both steps safely.
   */
  const saveSeries = (
    target: EditTarget,
    series: EditorEntryInputRaw,
    day: EditorEntryInputRaw,
  ): void => {
    void write(async () => {
      const result = await api.updateEntry(
        token,
        target.entryId,
        target.revision,
        series,
        { scope: "series" },
      );
      const saved = result.entry;
      const date = target.occurrenceDate;
      if (
        !target.hasOverride ||
        date === null ||
        saved === null ||
        saved.overrides[date] === undefined
      ) {
        return;
      }
      const revision = saved.revision;
      setView((current) =>
        current.kind !== "home" && current.target !== null
          ? { ...current, target: { ...current.target, revision } }
          : current,
      );
      refreshBoard();
      await api.updateEntry(token, target.entryId, revision, day, {
        scope: "one",
        date,
      });
    }, t("editor.toast.saved"));
  };

  const saveEvent = (draft: EventDraft, target: EditTarget | null): void => {
    if (target === null) {
      void write(
        () => api.createEntry(token, eventDraftToInput(draft)),
        t("editor.toast.saved"),
      );
      return;
    }
    const series = (scope: EditorScope): void => {
      if (scope.scope === "one") {
        const input = eventDraftToInput({ ...draft, repeat: "none" });
        void write(
          () =>
            api.updateEntry(
              token,
              target.entryId,
              target.revision,
              input,
              scope,
            ),
          t("editor.toast.saved"),
        );
        return;
      }
      const input = eventDraftToInput(
        draft.repeat === "none" || target.occurrenceDate === null
          ? draft
          : {
              ...draft,
              date: seriesStartDate(
                target.master,
                target.shownDate,
                draft,
                draft.weekdays,
              ),
            },
      );
      // The opened day as the form showed it (its series day when the date moved).
      const day = eventDraftToInput({
        ...draft,
        date:
          draft.date === target.shownDate
            ? draft.date
            : (target.occurrenceDate ?? draft.date),
        repeat: "none",
      });
      saveSeries(target, input, day);
    };
    if (target.occurrenceDate === null) {
      series({ scope: "series" });
      return;
    }
    const date = target.occurrenceDate;
    setPending({
      kind: "scope",
      title: draft.title,
      date,
      hasOverride: target.hasOverride,
      save: series,
    });
  };

  const saveMeal = (draft: MealDraft, target: EditTarget | null): void => {
    if (target === null) {
      void write(
        () => api.createEntry(token, mealDraftToInput(draft)),
        t("editor.toast.saved"),
      );
      return;
    }
    const save = (scope: EditorScope): void => {
      if (scope.scope === "one" || draft.repeat === "none") {
        const input = mealDraftToInput(
          scope.scope === "one" ? { ...draft, repeat: "none" } : draft,
        );
        void write(
          () =>
            api.updateEntry(
              token,
              target.entryId,
              target.revision,
              input,
              scope,
            ),
          t("editor.toast.saved"),
        );
        return;
      }
      const weekly = draft.repeat.weekly;
      const weekdays = mealSeriesWeekdays(
        weekly.weekdays,
        target.shownDate,
        draft.date,
      );
      const repeat = { weekly: { ...weekly, weekdays } };
      const input = mealDraftToInput({
        ...draft,
        repeat,
        date:
          target.occurrenceDate === null
            ? draft.date
            : seriesStartDate(target.master, target.shownDate, draft, weekdays),
      });
      const day = mealDraftToInput({
        ...draft,
        date:
          draft.date === target.shownDate
            ? draft.date
            : (target.occurrenceDate ?? draft.date),
        repeat: "none",
      });
      saveSeries(target, input, day);
    };
    if (target.occurrenceDate === null) {
      save({ scope: "series" });
      return;
    }
    const date = target.occurrenceDate;
    setPending({
      kind: "scope",
      title: draft.title,
      date,
      hasOverride: target.hasOverride,
      save,
    });
  };

  const remove = (target: EditTarget, scope: EditorScope): void => {
    void write(
      () => api.deleteEntry(token, target.entryId, target.revision, scope),
      t("editor.toast.deleted"),
      "delete",
    );
  };

  return { saveEvent, saveMeal, remove };
}
