import { useTranslation } from "react-i18next";

import { Emoji } from "../components/Emoji";
import type { CopyState } from "./editorState";
import { FailureNotice } from "./Notice";
import { TID } from "./testIds";
import { EditorButton } from "./ui";

interface MealCopySectionProps {
  busy: boolean;
  copy: CopyState | null;
  onStart: () => void;
  onUnlock: () => void;
}

/** "Copy last week's meals" below the new-meal form, with the outcome of the last try. */
export function MealCopySection({
  busy,
  copy,
  onStart,
  onUnlock,
}: MealCopySectionProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby="editor-copy"
      className="bg-surface-sunken rounded-column flex flex-col gap-3 p-4"
      data-testid={TID.copyMeals}
    >
      <h4 id="editor-copy" className="text-body font-extrabold">
        {t("editor.copy.title")}
      </h4>
      <p className="text-meta text-text-muted">{t("editor.copy.hint")}</p>
      <EditorButton
        className="self-start"
        disabled={busy}
        onClick={onStart}
        data-testid={TID.copyMealsStart}
      >
        <Emoji emoji="🔁" className="text-[1.5rem]" />
        {t("editor.copy.action")}
      </EditorButton>
      {copy?.kind === "nothing" && (
        <p role="status" className="text-body">
          {t("editor.copy.nothing")}
        </p>
      )}
      {copy?.kind === "partial" && (
        <div className="flex flex-col gap-2" data-testid={TID.copyPartial}>
          <p role="status" className="text-body">
            {t("editor.copy.partial", {
              done: copy.done,
              count: copy.total,
            })}
          </p>
          <FailureNotice failure={copy.failure} onUnlock={onUnlock} />
        </div>
      )}
    </section>
  );
}
