import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { IdleWarning } from "./IdleWarning";
import { PadHostContext, useParentGate } from "./parentGate";

export interface EditorScreenProps {
  /** The editor's content (T-45); a short placeholder until then. */
  children?: ReactNode;
}

/**
 * Shell of the parent editor, shown while the gate is unlocked: a full-screen modal
 * surface over the board with a title and "Done", which locks the gate and returns to
 * the board. The editor screens (T-45) render inside it.
 */
export function EditorScreen({
  children,
}: EditorScreenProps): React.JSX.Element {
  const { t } = useTranslation();
  const { close } = useParentGate();
  const titleId = useId();
  const root = useRef<HTMLElement>(null);
  // PIN pads open above the editor (re-lock) carry the "locking soon" banner themselves.
  const [pads, setPads] = useState(0);
  const registerPad = useCallback(() => {
    setPads((count) => count + 1);
    return () => {
      setPads((count) => count - 1);
    };
  }, []);

  useEffect(() => {
    root.current?.focus();
  }, []);

  return (
    <section
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="editor-screen"
      className="bg-surface text-text p-page gap-gutter fixed inset-0 z-20 flex flex-col outline-none"
    >
      <header className="gap-gutter flex shrink-0 items-center justify-between">
        <h2 id={titleId} className="text-heading">
          {t("parent.editor.title")}
        </h2>
        <button
          type="button"
          onClick={close}
          className="min-h-touch rounded-pill bg-accent text-on-accent text-title focus-visible:outline-text px-8 focus-visible:outline-4 focus-visible:outline-offset-2"
        >
          {t("parent.editor.done")}
        </button>
      </header>
      <PadHostContext value={registerPad}>
        <div data-testid="editor-content" className="min-h-0 flex-1">
          {children ?? (
            <p className="text-body text-text-muted">
              {t("parent.editor.placeholder")}
            </p>
          )}
        </div>
      </PadHostContext>
      {pads === 0 && <IdleWarning />}
    </section>
  );
}
