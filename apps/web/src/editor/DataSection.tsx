import { ImportModeSchema, type ImportModeValue } from "@kidboard/shared";
import { type ReactNode, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Emoji } from "../components/Emoji";
import type { EditorFailure } from "./failure";
import { FailureNotice } from "./Notice";
import { TID } from "./testIds";
import { ChoiceChip, ConfirmDialog, EditorButton } from "./ui";

/** A backup file chosen for import: its text and how many entries it holds. */
export interface ChosenBackup {
  name: string;
  text: string;
  count: number;
}

/** Reads a chosen file as a KidBoard backup; `null` when it is none. */
export function readBackup(name: string, text: string): ChosenBackup | null {
  try {
    const json: unknown = JSON.parse(text);
    if (
      typeof json === "object" &&
      json !== null &&
      (json as { format?: unknown }).format === "kidboard-entries" &&
      Array.isArray((json as { entries?: unknown }).entries)
    ) {
      return {
        name,
        text,
        count: (json as { entries: unknown[] }).entries.length,
      };
    }
  } catch {
    // Not JSON: not a backup.
  }
  return null;
}

/**
 * The small "Backup & phone" section (T-45 criterion 6): export downloads the backup as a JSON
 * file; import reads a chosen backup and, after one confirmation that names the mode,
 * adds it to the entries (merge) or replaces all of them.
 */
export function DataSection({
  busy,
  failure,
  onExport,
  onImport,
  onTop,
  children,
}: {
  busy: boolean;
  failure: EditorFailure | null;
  onExport: () => void;
  /** Resolves `true` once imported. */
  onImport: (backup: ChosenBackup, mode: ImportModeValue) => Promise<boolean>;
  /** "Back to top": the home view jumps back to its first action. */
  onTop: () => void;
  /** More blocks of the section (the phone feed link), shown after the heading. */
  children?: ReactNode;
}): React.JSX.Element {
  const { t } = useTranslation();
  const fileId = useId();
  const modeName = useId();
  const input = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<ChosenBackup | null>(null);
  const [notBackup, setNotBackup] = useState(false);
  const [mode, setMode] = useState<ImportModeValue>("merge");
  const [confirming, setConfirming] = useState(false);

  return (
    <section
      aria-labelledby="editor-data"
      className="bg-surface-sunken rounded-column flex flex-col gap-4 p-4"
      data-testid={TID.dataSection}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="editor-data" className="text-title">
          {t("editor.data.title")}
        </h3>
        <EditorButton tone="quiet" onClick={onTop} data-testid={TID.backToTop}>
          <Emoji emoji="🔝" className="text-[1.5rem]" />
          {t("editor.jump.top")}
        </EditorButton>
      </div>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <EditorButton
          onClick={onExport}
          disabled={busy}
          data-testid={TID.export}
        >
          {t("editor.data.export")}
        </EditorButton>
        <label
          htmlFor={fileId}
          className={`min-h-touch-parent rounded-pill bg-surface-sunken text-text inset-ring-border text-body has-focus-visible:outline-accent relative inline-flex cursor-pointer items-center px-6 font-extrabold inset-ring-2 has-focus-visible:outline-4`}
        >
          {t("editor.data.choose")}
          <input
            ref={input}
            id={fileId}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            data-testid={TID.importFile}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file === undefined) return;
              void file.text().then((text) => {
                const backup = readBackup(file.name, text);
                setChosen(backup);
                setNotBackup(backup === null);
              });
            }}
          />
        </label>
      </div>
      <p className="text-meta text-text-muted">{t("editor.data.hint")}</p>
      {notBackup && (
        <p role="alert" className="text-body text-danger">
          {t("editor.data.notBackup")}
        </p>
      )}
      {chosen !== null && (
        <div className="flex flex-col gap-3" data-testid={TID.importChoice}>
          <p className="text-body">
            {t("editor.data.chosen", {
              count: chosen.count,
              name: chosen.name,
            })}
          </p>
          <div
            role="radiogroup"
            aria-label={t("editor.data.mode")}
            className="flex flex-wrap gap-3"
          >
            {ImportModeSchema.options.map((value) => (
              <ChoiceChip
                key={value}
                type="radio"
                name={modeName}
                checked={mode === value}
                onChange={() => {
                  setMode(value);
                }}
              >
                {t(`editor.data.${value}`)}
              </ChoiceChip>
            ))}
          </div>
          <EditorButton
            tone="primary"
            disabled={busy}
            className="self-start"
            data-testid={TID.import}
            onClick={() => {
              setConfirming(true);
            }}
          >
            {t("editor.data.import")}
          </EditorButton>
        </div>
      )}
      {failure !== null && <FailureNotice failure={failure} />}
      {confirming && chosen !== null && (
        <ConfirmDialog
          title={t(`editor.data.confirm.${mode}Title`, { count: chosen.count })}
          text={t(`editor.data.confirm.${mode}Text`)}
          cancelLabel={t("editor.action.cancel")}
          onCancel={() => {
            setConfirming(false);
          }}
          actions={[
            {
              label: t(`editor.data.confirm.${mode}Action`),
              tone: "primary",
              "data-testid": TID.confirmImport,
              onSelect: () => {
                setConfirming(false);
                // The chosen file stays until the import succeeded (try again).
                void onImport(chosen, mode).then((done) => {
                  if (!done) return;
                  setChosen(null);
                  if (input.current !== null) input.current.value = "";
                });
              },
            },
          ]}
        />
      )}
    </section>
  );
}
