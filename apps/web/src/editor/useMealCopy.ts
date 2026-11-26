import type { EditorEntryInputRaw, EditorListItem } from "@kidboard/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { EditorActionContext } from "./editorActions";
import type { CopyState } from "./editorState";
import { type EditorFailure, toFailure } from "./failure";
import { entriesOfBackup, planMealCopy } from "./mealCopy";

export interface MealCopy {
  /** Outcome notice of the last copy ("nothing to copy", "copied only some"). */
  copy: CopyState | null;
  clearCopy: () => void;
  /** Plans the copy of last week's meals; asks for confirmation (`pending`) if any. */
  prepareCopy: () => Promise<void>;
  runCopy: (plan: readonly EditorEntryInputRaw[]) => Promise<void>;
}

/**
 * "Copy last week's meals": reads a backup of all entries, plans the meals of the 7 days
 * before `today` that are not planned yet and creates them one by one.
 */
export function useMealCopy(
  context: EditorActionContext,
  today: string,
  plannedMeals: readonly EditorListItem[],
): MealCopy {
  const { t } = useTranslation();
  const { api, token, setView, setPending, setToast, setBusy, setFailure } =
    context;
  const { refreshBoard } = context;
  const [copy, setCopy] = useState<CopyState | null>(null);
  const clearCopy = (): void => {
    setCopy(null);
  };

  const prepareCopy = async (): Promise<void> => {
    setBusy(true);
    setCopy(null);
    setFailure(null);
    try {
      const backup = await api.exportEntries(token);
      const planned = plannedMeals.filter((item) => item.kind === "meal");
      const plan = planMealCopy(entriesOfBackup(backup.text), today, planned);
      if (plan.length === 0) setCopy({ kind: "nothing" });
      else setPending({ kind: "copy", plan });
    } catch (error) {
      setFailure(toFailure(error));
    } finally {
      setBusy(false);
    }
  };

  const runCopy = async (
    plan: readonly EditorEntryInputRaw[],
  ): Promise<void> => {
    setBusy(true);
    let done = 0;
    let failed: EditorFailure | null = null;
    for (const meal of plan) {
      try {
        await api.createEntry(token, meal);
        done += 1;
      } catch (error) {
        failed = toFailure(error);
        // Without connection or session the rest would fail the same way.
        if (
          ["offline", "timeout", "locked", "unauthorized"].includes(failed.kind)
        ) {
          break;
        }
      }
    }
    setBusy(false);
    if (done > 0) refreshBoard();
    if (failed === null) {
      setView({ kind: "home" });
      setToast(t("editor.toast.copied", { count: done }));
    } else {
      setCopy({ kind: "partial", done, total: plan.length, failure: failed });
    }
  };

  return { copy, clearCopy, prepareCopy, runCopy };
}
