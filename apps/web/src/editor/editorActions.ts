import type { Dispatch, SetStateAction } from "react";

import type { ApiClient } from "../data";
import type { Pending, View } from "./editorState";
import type { EditorFailure } from "./failure";

/**
 * What the editor's action hooks (`useEntryWrites`, `useBackup`, `useMealCopy`) need
 * from `Editor.tsx`: the session, the state they change and the two refreshes. The
 * state itself stays in the editor, because the views and dialogs read it.
 */
export interface EditorActionContext {
  api: ApiClient;
  token: string;
  setView: Dispatch<SetStateAction<View>>;
  setPending: Dispatch<SetStateAction<Pending | null>>;
  setToast: (message: string) => void;
  setBusy: (busy: boolean) => void;
  setFailure: (failure: EditorFailure | null) => void;
  /** Loads the editor's list and templates again. */
  reload: () => void;
  /** Loads them again and refetches the board's agenda. */
  refreshBoard: () => void;
}
