import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
} from "react";

import { TID } from "./testIds";

/*
 * Small building blocks of the parent editor (T-45). Choices are native radio buttons
 * and checkboxes inside chip-shaped labels, so roles, names, keyboard behaviour (arrow
 * keys in a radio group, Space on a checkbox) and the focus order come from the
 * platform. Every target is at least `--spacing-touch-parent` (48 px) high.
 */

/** Focus ring shared by every editor control. */
export const FOCUS_RING =
  "focus-visible:outline-accent focus-visible:outline-4 focus-visible:outline-offset-2";

const CHIP_BASE =
  "min-h-touch-parent rounded-pill bg-surface-sunken text-text inset-ring-border inset-ring-2 has-checked:bg-nav-active has-checked:text-on-nav-active has-checked:inset-ring-nav-active has-focus-visible:outline-accent has-focus-visible:outline-4 has-focus-visible:outline-offset-2 has-[input:disabled:not(:checked)]:text-text-muted relative inline-flex cursor-pointer items-center justify-center gap-2 px-4 font-extrabold select-none has-disabled:cursor-default";

export interface ChoiceChipProps {
  type: "radio" | "checkbox";
  /** Radio group name (radios only). */
  name?: string | undefined;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean | undefined;
  /** Extra classes (e.g. a square icon chip). */
  className?: string;
  /** Visible content; it is the accessible name unless `label` is given. */
  children: ReactNode;
  /** Accessible name when the visible content is not enough (e.g. icon only). */
  label?: string | undefined;
  "data-testid"?: string | undefined;
}

/** A radio button or checkbox shaped as a chip. */
export function ChoiceChip({
  type,
  name,
  checked,
  onChange,
  disabled = false,
  className = "text-body",
  children,
  label,
  "data-testid": testId,
}: ChoiceChipProps): React.JSX.Element {
  return (
    <label className={`${CHIP_BASE} ${className}`} data-testid={testId}>
      <input
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-label={label}
        className="sr-only"
      />
      {children}
    </label>
  );
}

/** A titled group of controls (`fieldset` + `legend`). */
export function Field({
  legend,
  hint,
  error,
  children,
  className = "",
  "data-testid": testId,
}: {
  legend: string;
  hint?: string | undefined;
  /** A calm problem message for this field, read with the group. */
  error?: string | undefined;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}): React.JSX.Element {
  const hintId = useId();
  const errorId = useId();
  const described =
    [
      hint === undefined ? undefined : hintId,
      error === undefined ? undefined : errorId,
    ]
      .filter((id) => id !== undefined)
      .join(" ") || undefined;
  return (
    <fieldset
      aria-describedby={described}
      aria-invalid={error === undefined ? undefined : true}
      data-testid={testId}
      className={`flex min-w-0 scroll-mt-4 flex-col gap-3 ${className}`}
    >
      <legend className="text-title mb-3">{legend}</legend>
      {hint !== undefined && (
        <p id={hintId} className="text-meta text-text-muted">
          {hint}
        </p>
      )}
      {children}
      {error !== undefined && (
        <p id={errorId} className="text-body text-danger" data-field-error="">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export type ButtonTone = "primary" | "secondary" | "quiet" | "danger";

const BUTTON_TONES: Record<ButtonTone, string> = {
  primary: "bg-accent text-on-accent",
  /** Destructive choices (delete a whole series, discard changes). */
  danger: "bg-danger text-on-danger",
  secondary: "bg-surface-sunken text-text inset-ring-border inset-ring-2",
  quiet: "text-text-muted underline-offset-4 hover:underline",
};

/** A text button of the editor (≥ 48 px, ≥ 64 px with `large`). */
export function EditorButton({
  tone = "secondary",
  className = "",
  large = false,
  ...props
}: React.ComponentProps<"button"> & {
  tone?: ButtonTone;
  /** A child-size target (`--spacing-touch`, 64 px) instead of the parent size (48 px). */
  large?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      {...props}
      className={`${large ? "min-h-touch" : "min-h-touch-parent"} rounded-pill text-body inline-flex items-center justify-center gap-2 px-6 font-extrabold disabled:opacity-100 ${BUTTON_TONES[tone]} ${FOCUS_RING} disabled:bg-surface-sunken disabled:text-text-muted disabled:cursor-default ${className}`}
    />
  );
}

/**
 * One shared "a dialog is open" signal: the editor provides a `track` function (it
 * returns the cleanup), every {@link ConfirmDialog} reports itself while mounted, and the
 * toast stays hidden meanwhile, whichever component owns the dialog.
 */
export const DialogTrackerContext = createContext<(() => () => void) | null>(
  null,
);

export interface ConfirmAction {
  label: string;
  onSelect: () => void;
  tone?: ButtonTone;
  "data-testid"?: string;
}

/**
 * A small modal question over the editor (`alertdialog`): a title, one sentence and its
 * actions. Focus starts on the safe choice (cancel / keep), stays inside the dialog
 * (Tab and Shift+Tab cycle through its buttons) and returns to where it was on close;
 * Escape cancels.
 */
export function ConfirmDialog({
  title,
  text,
  actions,
  onCancel,
  cancelLabel,
}: {
  title: string;
  text?: string | undefined;
  actions: readonly ConfirmAction[];
  onCancel: () => void;
  cancelLabel: string;
}): React.JSX.Element {
  const titleId = useId();
  const textId = useId();
  const safe = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef(onCancel);
  useEffect(() => {
    cancel.current = onCancel;
  });
  const track = useContext(DialogTrackerContext);
  useEffect(() => track?.(), [track]);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    safe.current?.focus();
    // Escape cancels and Tab stays inside (a native listener: the dialog itself is no
    // interactive element).
    const element = dialog.current;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancel.current();
        return;
      }
      if (event.key !== "Tab" || element === null) return;
      const buttons = [...element.querySelectorAll("button")].filter(
        (button) => !button.disabled,
      );
      const firstButton = buttons[0];
      const lastButton = buttons.at(-1);
      if (firstButton === undefined || lastButton === undefined) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === firstButton || active === element)) {
        event.preventDefault();
        lastButton.focus();
      } else if (!event.shiftKey && active === lastButton) {
        event.preventDefault();
        firstButton.focus();
      }
    };
    // Focus that leaves the dialog anyway (e.g. a click outside) is brought back.
    const onFocusOut = (event: FocusEvent): void => {
      const next = event.relatedTarget;
      if (next instanceof Node && element?.contains(next) === false) {
        safe.current?.focus();
      }
    };
    element?.addEventListener("keydown", onKey);
    element?.addEventListener("focusout", onFocusOut);
    return () => {
      element?.removeEventListener("keydown", onKey);
      element?.removeEventListener("focusout", onFocusOut);
      previous?.focus();
    };
  }, []);
  return (
    <div className="bg-surface/80 p-page fixed inset-0 z-30 flex items-center justify-center">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={text === undefined ? undefined : textId}
        data-testid={TID.editorConfirm}
        ref={dialog}
        className="bg-surface-raised rounded-column shadow-raised p-page gap-gutter flex w-full max-w-[36rem] flex-col"
      >
        <h3 id={titleId} className="text-title">
          {title}
        </h3>
        {text !== undefined && (
          <p id={textId} className="text-body text-text-muted">
            {text}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          {actions.map((action) => (
            <EditorButton
              key={action.label}
              tone={action.tone ?? "secondary"}
              onClick={action.onSelect}
              data-testid={action["data-testid"]}
            >
              {action.label}
            </EditorButton>
          ))}
          <EditorButton ref={safe} tone="quiet" onClick={onCancel}>
            {cancelLabel}
          </EditorButton>
        </div>
      </div>
    </div>
  );
}
