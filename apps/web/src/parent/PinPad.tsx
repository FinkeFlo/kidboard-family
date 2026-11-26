import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { IdleWarning } from "./IdleWarning";
import {
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
  type UnlockFailure,
  useParentGate,
  useRegisterPad,
} from "./parentGate";

/**
 * The PIN of the in-memory demo API (`pnpm dev:demo`, `vite --mode demo`), shown on the
 * pad only there. `import.meta.env.MODE` is replaced at build time, so production
 * builds carry `null` and drop the hint.
 */
export const DEMO_PIN: string | null =
  import.meta.env.MODE === "demo" ? "123456" : null;

/** Keypad digits in reading order; `0` sits in the bottom row between ⌫ and OK. */
const TOP_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
const BOTTOM_DIGIT = "0";

type Feedback =
  | { kind: "wrong-pin"; attemptsLeft: number }
  | { kind: "error"; error: UnlockFailure };

/** Minutes until `until` (rounded up, at least 1) or `null` when it has passed. */
export function lockoutMinutesLeft(
  until: number | null,
  now: number,
): number | null {
  if (until === null || until <= now) return null;
  return Math.max(1, Math.ceil((until - now) / 60_000));
}

/** From this many slots on, the dots get smaller so 12 fit on a narrow phone too. */
const COMPACT_DOTS_FROM = 9;

function PinDots({ count }: { count: number }): React.JSX.Element {
  const { t } = useTranslation();
  const slots = Math.max(PIN_MIN_LENGTH, count);
  const compact = slots >= COMPACT_DOTS_FROM;
  return (
    <div
      role="img"
      aria-label={t("parent.pin.entered", { count })}
      data-testid="pin-dots"
      data-count={count}
      data-compact={compact}
      className={`flex min-h-6 max-w-full flex-wrap items-center justify-center ${
        compact ? "gap-2" : "gap-3"
      }`}
    >
      {Array.from({ length: slots }, (_, index) => (
        <span
          key={index}
          className={`shrink-0 rounded-full ${
            compact ? "size-4 border-2" : "size-5 border-3"
          } ${index < count ? "border-text bg-text" : "border-border"}`}
        />
      ))}
    </div>
  );
}

const KEY_CLASS =
  "min-h-touch rounded-tile bg-surface-sunken text-text text-heading focus-visible:outline-accent flex items-center justify-center select-none focus-visible:outline-4 disabled:text-text-muted";

function DigitKey({
  digit,
  disabled,
  onPress,
}: {
  digit: string;
  disabled: boolean;
  onPress: (digit: string) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      data-pin-digit={digit}
      onClick={() => {
        onPress(digit);
      }}
      className={KEY_CLASS}
    >
      {digit}
    </button>
  );
}

/**
 * PIN pad of the parent area (ADR-0013): a modal card over the board with masked digits
 * (dots only, the digits are never rendered), a 3 × 4 keypad of >= 64 px keys, OK and
 * Cancel. A wrong PIN clears the entry and shows the tries left (plus a short shake
 * only without reduced motion; the message carries the meaning); a lockout disables the
 * keypad and shows the minutes left, counted down while the pad is open. At most
 * {@link PIN_MAX_LENGTH} digits are taken (the digit keys disable at that length).
 *
 * Physical keyboards work too (digits, Backspace, Enter, Escape), wherever the focus is
 * while the pad is open (a document listener: a key button that was disabled during
 * the check drops the focus, and typing must go on), and the focus returns into the
 * pad after every answer. Enter submits, also while a digit key has the focus (it does
 * not press that key again); on OK, ⌫ and Cancel it activates them as usual.
 * Held-key repeats are ignored, so the Enter or Space held to open the gate cannot
 * type or submit here.
 */
export function PinPad(): React.JSX.Element {
  const { t } = useTranslation();
  const gate = useParentGate();
  useRegisterPad();
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const [digits, setDigits] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // Restarts the shake on every wrong PIN.
  const [errorCount, setErrorCount] = useState(0);
  // Clock for the lockout minutes: set when a lockout starts, then ticks each second.
  const [now, setNow] = useState(() => Date.now());
  const lockedMinutes = lockoutMinutesLeft(gate.lockoutUntil, now);
  const locked = lockedMinutes !== null;
  const disabled = pending || locked;
  const full = digits.length >= PIN_MAX_LENGTH;

  useEffect(() => {
    if (!locked) return undefined;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [locked]);

  const press = (digit: string): void => {
    if (disabled) return;
    setDigits((current) =>
      current.length >= PIN_MAX_LENGTH ? current : current + digit,
    );
  };
  const erase = (): void => {
    if (disabled) return;
    setDigits((current) => current.slice(0, -1));
  };
  const submit = async (): Promise<void> => {
    if (disabled || digits.length < PIN_MIN_LENGTH) return;
    setPending(true);
    const outcome = await gate.unlock(digits);
    setPending(false);
    if (outcome.kind !== "unlocked" && outcome.kind !== "cancelled") {
      // A key button disabled during the check dropped the focus: take it back, so
      // typing (and Escape) keep working.
      const element = dialog.current;
      if (element !== null && !element.contains(document.activeElement)) {
        element.focus();
      }
    }
    switch (outcome.kind) {
      case "unlocked":
      case "cancelled":
        return;
      case "wrong-pin":
        setDigits("");
        setFeedback({ kind: "wrong-pin", attemptsLeft: outcome.attemptsLeft });
        setErrorCount((count) => count + 1);
        return;
      case "lockout":
        setDigits("");
        setFeedback(null);
        setNow(Date.now());
        setErrorCount((count) => count + 1);
        return;
      case "error":
        setFeedback({ kind: "error", error: outcome.error });
        return;
    }
  };

  // Physical keyboard: a native listener on the document while the pad is open (latest
  // handlers via a ref). The pad is modal and the board behind it inert, so every key
  // belongs to the pad, even when the focus fell to <body>.
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keyHandler.current = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return;
      }
      if (event.repeat) {
        // The Enter or Space held to open the gate keeps repeating: ignore it.
        event.preventDefault();
        return;
      }
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        press(event.key);
      } else if (event.key === "Backspace") {
        event.preventDefault();
        erase();
      } else if (event.key === "Escape") {
        event.preventDefault();
        gate.close();
      } else if (event.key === "Enter") {
        const target = event.target;
        if (
          target instanceof HTMLButtonElement &&
          target.dataset.pinDigit === undefined
        ) {
          // OK, ⌫ and Cancel: their own click.
          return;
        }
        // Elsewhere, and on a digit key: submit instead of pressing it again.
        event.preventDefault();
        void submit();
      }
    };
  });
  useEffect(() => {
    dialog.current?.focus();
    const listener = (event: KeyboardEvent): void => {
      keyHandler.current(event);
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
    };
  }, []);

  let message: string | undefined;
  if (locked) {
    message = t("parent.pin.lockout", { count: lockedMinutes });
  } else if (feedback?.kind === "wrong-pin") {
    message = t("parent.pin.wrong", { count: feedback.attemptsLeft });
  } else if (feedback?.kind === "error") {
    message = t(`parent.pin.error.${feedback.error}`);
  }

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="pin-pad"
      className="bg-surface text-text p-page fixed inset-0 z-20 overflow-y-auto outline-none"
    >
      <div className="flex min-h-full flex-col items-center justify-center lg:flex-row">
        <div className="bg-surface-raised rounded-column shadow-raised p-page gap-gutter flex w-full max-w-[32rem] flex-col items-stretch">
          <div className="flex items-center justify-center gap-3">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="text-control-quiet size-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            <h2 id={titleId} className="text-heading">
              {t("parent.pin.title")}
            </h2>
          </div>
          <p className="text-body text-text-muted text-center">
            {pending ? t("parent.pin.checking") : t("parent.pin.prompt")}
          </p>
          {DEMO_PIN !== null && (
            <p
              className="text-meta text-text-muted text-center"
              data-testid="demo-pin"
            >
              {t("parent.pin.demo", { pin: DEMO_PIN })}
            </p>
          )}
          <div
            key={errorCount}
            data-testid="pin-dots-row"
            className={
              errorCount > 0
                ? "motion-safe:animate-[kb-shake_var(--duration-slow)_ease-in-out]"
                : undefined
            }
          >
            <PinDots count={digits.length} />
          </div>
          <p
            aria-live="polite"
            data-testid="pin-feedback"
            className={`text-body min-h-[1.4em] text-center ${
              locked ? "text-text" : "text-danger"
            }`}
          >
            {message}
          </p>
          <div className="grid grid-cols-3 gap-3">
            {TOP_DIGITS.map((digit) => (
              <DigitKey
                key={digit}
                digit={digit}
                disabled={disabled || full}
                onPress={press}
              />
            ))}
            <button
              type="button"
              aria-label={t("parent.pin.erase")}
              disabled={disabled || digits.length === 0}
              onClick={erase}
              className={KEY_CLASS}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="size-8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 5h11v14H9l-6-7 6-7zM12 9l5 6M17 9l-5 6" />
              </svg>
            </button>
            <DigitKey
              digit={BOTTOM_DIGIT}
              disabled={disabled || full}
              onPress={press}
            />
            <button
              type="button"
              disabled={disabled || digits.length < PIN_MIN_LENGTH}
              onClick={() => {
                void submit();
              }}
              className="min-h-touch rounded-tile bg-accent text-on-accent text-title focus-visible:outline-text disabled:bg-surface-sunken disabled:text-text-muted flex items-center justify-center select-none focus-visible:outline-4 focus-visible:outline-offset-2"
            >
              {t("parent.pin.submit")}
            </button>
          </div>
          <button
            type="button"
            onClick={gate.close}
            className="min-h-touch text-body text-text-muted focus-visible:outline-accent rounded-pill self-center px-6 font-extrabold focus-visible:outline-4"
          >
            {t("parent.pin.cancel")}
          </button>
        </div>
        <IdleWarning placement="flow" />
      </div>
    </div>
  );
}
