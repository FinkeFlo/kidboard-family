import type { ImportModeValue } from "@kidboard/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { ChosenBackup } from "./DataSection";
import type { EditorActionContext } from "./editorActions";
import { type EditorFailure, toFailure } from "./failure";

function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

export interface Backup {
  /** The last export or import failed; shown in the Data section. */
  dataFailure: EditorFailure | null;
  exportBackup: () => Promise<void>;
  importBackup: (
    backup: ChosenBackup,
    mode: ImportModeValue,
  ) => Promise<boolean>;
}

/** Export of all entries as a download, and import of such a file (the Data section). */
export function useBackup(context: EditorActionContext): Backup {
  const { t } = useTranslation();
  const { api, token, setToast, setBusy, refreshBoard } = context;
  const [dataFailure, setDataFailure] = useState<EditorFailure | null>(null);

  const exportBackup = async (): Promise<void> => {
    setBusy(true);
    setDataFailure(null);
    try {
      const backup = await api.exportEntries(token);
      downloadText(backup.fileName, backup.text);
      setToast(t("editor.toast.exported"));
    } catch (error) {
      setDataFailure(toFailure(error));
    } finally {
      setBusy(false);
    }
  };

  const importBackup = async (
    backup: ChosenBackup,
    mode: ImportModeValue,
  ): Promise<boolean> => {
    setBusy(true);
    setDataFailure(null);
    try {
      const result = await api.importEntries(token, mode, backup.text);
      setToast(
        t("editor.toast.imported", {
          count: result.imported,
          created: result.created,
          updated: result.updated,
        }),
      );
      refreshBoard();
      return true;
    } catch (error) {
      setDataFailure(toFailure(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { dataFailure, exportBackup, importBackup };
}
