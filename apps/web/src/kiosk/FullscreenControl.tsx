import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useFullscreen } from "./useFullscreen";

/** How long a pointer has to stay down before the control reacts. */
export const FULLSCREEN_HOLD_MS = 700;
/** How long the "press and hold" hint stays after a short tap. */
export const FULLSCREEN_HINT_MS = 2500;

/**
 * Ring around the glyph while a pointer is held: a quiet track plus a progress arc that
 * fills in `FULLSCREEN_HOLD_MS` (CSS keyframes `kb-hold-ring`, started on mount, so a
 * new press starts from empty). With reduced motion only the static track shows (no
 * sweep, and never a full ring before the hold is done). Decorative.
 */
function HoldRing(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      data-testid="fullscreen-hold-ring"
      viewBox="0 0 48 48"
      fill="none"
      strokeWidth="4"
      className="pointer-events-none absolute inset-0 m-auto size-12 -rotate-90"
    >
      <circle cx="24" cy="24" r="21" className="stroke-border" />
      <circle
        data-testid="fullscreen-hold-progress"
        cx="24"
        cy="24"
        r="21"
        pathLength={100}
        strokeDasharray="100"
        strokeLinecap="round"
        // Style value only (CSP-safe): the keyframes live in global.css.
        style={{
          animation: `kb-hold-ring ${String(FULLSCREEN_HOLD_MS)}ms linear forwards`,
        }}
        className="stroke-text motion-reduce:hidden"
      />
    </svg>
  );
}

/**
 * Parent control for fullscreen, a quiet overlay in the bottom slot of the navigation rail
 * (merge rule 6): fixed in the reserved bottom strip, centred under the rail, so the rail
 * and the board never cover it and it never changes their layout. It stays in place on
 * the loading and error screens too (they have no rail). Children must not toggle
 * fullscreen by accident, so a pointer needs a long press (`FULLSCREEN_HOLD_MS`); a ring
 * fills while it is held, and a short tap shows a small "press and hold" hint for a
 * moment (no dialog). It is quiet and shows only a small glyph in
 * `--color-control-quiet` (no opacity, so it keeps >= 3:1 non-text contrast, WCAG
 * 1.4.11), but the hit area is a full 64 px touch target. Keyboard and assistive-tech
 * activation (a click without pointer, `detail === 0`) works at once. The fullscreen
 * request runs on pointer-up, because browsers only grant it inside a user gesture.
 * Hidden where fullscreen is unsupported or the board already runs as an installed app.
 */
export function FullscreenControl(): React.JSX.Element | null {
  const { t } = useTranslation();
  const { available, active, toggle } = useFullscreen();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const armed = useRef(false);
  const [holding, setHolding] = useState(false);
  const [hint, setHint] = useState(false);

  const cancel = (): void => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
    armed.current = false;
    setHolding(false);
  };
  const showHint = (): void => {
    if (hintTimer.current !== undefined) clearTimeout(hintTimer.current);
    setHint(true);
    hintTimer.current = setTimeout(() => {
      hintTimer.current = undefined;
      setHint(false);
    }, FULLSCREEN_HINT_MS);
  };
  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
      if (hintTimer.current !== undefined) clearTimeout(hintTimer.current);
    },
    [],
  );

  if (!available) return null;
  const label = active ? t("fullscreen.exit") : t("fullscreen.enter");
  return (
    <button
      type="button"
      aria-label={label}
      data-testid="fullscreen-control"
      data-active={active}
      data-holding={holding}
      onPointerDown={() => {
        cancel();
        if (hintTimer.current !== undefined) clearTimeout(hintTimer.current);
        hintTimer.current = undefined;
        setHint(false);
        setHolding(true);
        timer.current = setTimeout(() => {
          armed.current = true;
        }, FULLSCREEN_HOLD_MS);
      }}
      onPointerUp={() => {
        const hold = armed.current;
        cancel();
        if (hold) {
          void toggle();
        } else {
          showHint();
        }
      }}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onContextMenu={(event) => {
        // A long press must not open the touch context menu.
        event.preventDefault();
      }}
      onClick={(event) => {
        // Pointer clicks have detail >= 1 and are handled above; keyboard/AT have 0.
        if (event.detail === 0) void toggle();
      }}
      className="text-control-quiet min-h-touch min-w-touch focus-visible:outline-text fixed right-[calc(var(--spacing-gutter)+(var(--spacing-nav)-var(--spacing-touch))/2)] bottom-0 z-10 flex touch-none items-center justify-center select-none focus-visible:outline-4 focus-visible:-outline-offset-4"
    >
      {holding && <HoldRing />}
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
        {active ? (
          <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
        ) : (
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        )}
      </svg>
      {hint && (
        // The button's name already says "press and hold"; this is the visible reminder.
        <span
          aria-hidden="true"
          data-testid="fullscreen-hint"
          className="bg-surface-raised text-text text-caption rounded-pill shadow-card pointer-events-none absolute end-full me-1 px-3 py-1.5 font-bold whitespace-nowrap"
        >
          {t("fullscreen.hint")}
        </span>
      )}
    </button>
  );
}
