import { addCalendarDays } from "@kidboard/shared";
import { useTranslation } from "react-i18next";

import type { EditorScope } from "../data";
import type { FormatContext } from "../i18n/format";
import type { EditTarget, Pending } from "./editorState";
import { dateLabel, dayLabel } from "./labels";
import { TID } from "./testIds";
import { ConfirmDialog } from "./ui";

interface DialogsProps {
  pending: Pending | null;
  today: string;
  format: FormatContext;
  onClose: () => void;
  onDelete: (target: EditTarget, scope: EditorScope) => void;
  onCopy: (plan: Extract<Pending, { kind: "copy" }>["plan"]) => void;
}

/** The editor's confirmations: which days a change applies to, delete, copy meals. */
export function EditorDialogs({
  pending,
  today,
  format,
  onClose,
  onDelete,
  onCopy,
}: DialogsProps): React.JSX.Element | null {
  const { t } = useTranslation();
  if (pending === null) return null;
  return (
    <>
      {pending.kind === "scope" && (
        <ConfirmDialog
          title={t("editor.scope.title", { title: pending.title })}
          text={
            pending.hasOverride
              ? `${t("editor.scope.text")} ${t("editor.scope.overrideText")}`
              : t("editor.scope.text")
          }
          cancelLabel={t("editor.action.cancel")}
          onCancel={() => {
            onClose();
          }}
          actions={[
            {
              label: t("editor.scope.one", {
                day: dateLabel(pending.date, format, t),
              }),
              "data-testid": TID.scopeOne,
              onSelect: () => {
                onClose();
                pending.save({ scope: "one", date: pending.date });
              },
            },
            {
              label: t("editor.scope.series"),
              "data-testid": TID.scopeSeries,
              onSelect: () => {
                onClose();
                pending.save({ scope: "series" });
              },
            },
          ]}
        />
      )}
      {pending.kind === "delete" && (
        <ConfirmDialog
          title={t("editor.delete.title", { title: pending.title })}
          text={
            pending.target.occurrenceDate === null
              ? t("editor.delete.text")
              : t("editor.delete.seriesText")
          }
          cancelLabel={t("editor.delete.keep")}
          onCancel={() => {
            onClose();
          }}
          actions={
            pending.target.occurrenceDate === null
              ? [
                  {
                    label: t("editor.action.delete"),
                    tone: "danger",
                    "data-testid": TID.confirmDelete,
                    onSelect: () => {
                      onClose();
                      onDelete(pending.target, { scope: "series" });
                    },
                  },
                ]
              : [
                  {
                    label: t("editor.scope.one", {
                      day: dateLabel(pending.target.occurrenceDate, format, t),
                    }),
                    "data-testid": TID.deleteOne,
                    onSelect: () => {
                      const date = pending.target.occurrenceDate ?? today;
                      onClose();
                      onDelete(pending.target, { scope: "one", date });
                    },
                  },
                  {
                    label: t("editor.delete.series"),
                    tone: "danger",
                    "data-testid": TID.deleteSeries,
                    onSelect: () => {
                      onClose();
                      onDelete(pending.target, { scope: "series" });
                    },
                  },
                ]
          }
        />
      )}
      {pending.kind === "copy" && (
        <ConfirmDialog
          title={t("editor.copy.confirmTitle", {
            count: pending.plan.length,
          })}
          text={t("editor.copy.confirmText", {
            from: dayLabel(today, today, format, t),
            to: dayLabel(addCalendarDays(today, 6), today, format, t),
          })}
          cancelLabel={t("editor.action.cancel")}
          onCancel={() => {
            onClose();
          }}
          actions={[
            {
              label: t("editor.copy.confirmAction"),
              tone: "primary",
              "data-testid": TID.confirmCopy,
              onSelect: () => {
                const plan = pending.plan;
                onClose();
                onCopy(plan);
              },
            },
          ]}
        />
      )}
    </>
  );
}
