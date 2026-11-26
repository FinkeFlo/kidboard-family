import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useParentGate } from "./parentGate";

/** ADR-0013: the entry opens the PIN pad after a 2-second press and hold. */
export const PARENT_HOLD_MS = 2000;
/**
 * The ring appears only after this part of the hold, so a child's short tap shows
 * nothing at all; it then fills over the rest of {@link PARENT_HOLD_MS}.
 */
export const PARENT_RING_DELAY_MS = 300;

/**
 * Progress ring while the entry is held: a quiet track plus an arc that fills until the
 * hold is complete (keyframes `kb-hold-ring` in global.css, started on mount). With
 * reduced motion only the static track shows. Decorative.
 */
function HoldRing(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      data-testid="parent-hold-ring"
      viewBox="0 0 48 48"
      fill="none"
      strokeWidth="4"
      className="pointer-events-none absolute inset-0 m-auto size-12 -rotate-90"
    >
      <circle cx="24" cy="24" r="21" className="stroke-border" />
      <circle
        data-testid="parent-hold-progress"
        cx="24"
        cy="24"
        r="21"
        pathLength={100}
        strokeDasharray="100"
        strokeLinecap="round"
        // Style value only (CSP-safe): the keyframes live in global.css.
        style={{
          animation: `kb-hold-ring ${String(PARENT_HOLD_MS - PARENT_RING_DELAY_MS)}ms linear forwards`,
        }}
        className="stroke-text motion-reduce:hidden"
      />
    </svg>
  );
}

/** Keys whose 2-second hold opens the gate, like a held pointer. */
const HOLD_KEYS = new Set(["Enter", " "]);

/**
 * Hidden entry to the parent area (ADR-0013) at the bottom of the navigation rail: a
 * small pencil in `--color-control-quiet` (no opacity, >= 3:1 non-text contrast) on a
 * full 64 px touch target. It opens the PIN pad only after {@link PARENT_HOLD_MS} of a
 * held pointer or a held Enter or Space key; a ring fills meanwhile. Short taps,
 * clicks, short key presses and assistive-tech activation do nothing, so children
 * cannot open it by accident. Rendered only when the worker reports the editor as
 * available.
 */
export function ParentEntry(): React.JSX.Element {
  const { t } = useTranslation();
  const { openPin, entryRef } = useParentGate();
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const ringTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [ring, setRing] = useState(false);

  const cancel = useCallback((): void => {
    if (holdTimer.current !== undefined) clearTimeout(holdTimer.current);
    if (ringTimer.current !== undefined) clearTimeout(ringTimer.current);
    holdTimer.current = undefined;
    ringTimer.current = undefined;
    setRing(false);
  }, []);

  const start = (): void => {
    cancel();
    ringTimer.current = setTimeout(() => {
      ringTimer.current = undefined;
      setRing(true);
    }, PARENT_RING_DELAY_MS);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = undefined;
      cancel();
      openPin();
    }, PARENT_HOLD_MS);
  };

  useEffect(() => cancel, [cancel]);

  return (
    <button
      type="button"
      ref={entryRef}
      aria-label={t("parent.entry")}
      data-testid="parent-entry"
      data-holding={ring}
      onPointerDown={(event) => {
        // Primary button / touch / pen only.
        if (event.button !== 0) return;
        start();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onContextMenu={(event) => {
        // A long press must not open the touch context menu.
        event.preventDefault();
      }}
      onKeyDown={(event) => {
        if (!HOLD_KEYS.has(event.key)) return;
        // No click (and no scrolling on Space): only a held key opens the gate.
        event.preventDefault();
        if (!event.repeat) start();
      }}
      onKeyUp={(event) => {
        if (!HOLD_KEYS.has(event.key)) return;
        // Space would click on release.
        event.preventDefault();
        cancel();
      }}
      onBlur={cancel}
      className="text-control-quiet min-h-touch min-w-touch focus-visible:outline-text relative flex shrink-0 touch-none items-center justify-center select-none focus-visible:outline-4 focus-visible:-outline-offset-4"
    >
      {ring && <HoldRing />}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
      </svg>
    </button>
  );
}
