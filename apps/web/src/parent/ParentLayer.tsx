import type { ReactNode } from "react";

import { Editor } from "../editor/Editor";
import { EditorScreen } from "./EditorScreen";
import { useParentGate, useParentGateOpen } from "./parentGate";
import { PinPad } from "./PinPad";

/** The PIN pad or the editor (T-45) above the board, depending on the gate's stage. */
export function ParentLayer(): React.JSX.Element | null {
  const { stage } = useParentGate();
  if (stage === "pin") return <PinPad />;
  if (stage === "editor") {
    return (
      <EditorScreen>
        <Editor />
      </EditorScreen>
    );
  }
  return null;
}

/**
 * Wraps the board: while the PIN pad or the editor is open the board stays rendered
 * (state kept) but is `inert` (no focus, no clicks, hidden from assistive tech).
 * `display: contents`, so the wrapper changes no layout.
 */
export function BoardLayer({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  const open = useParentGateOpen();
  return (
    <div className="contents" inert={open} data-testid="board-layer">
      {children}
    </div>
  );
}
