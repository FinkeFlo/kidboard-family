import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { PARENT_IDLE_WARNING_MS, useParentGate } from "./parentGate";

/**
 * Keeps the keyboard focus where it was while the warning shows. The banner's button
 * takes the focus when pressed, and the banner disappears at the first touch (any input
 * restarts the idle time), which would drop the focus to the page. On removal the focus
 * goes back to the element that had it before (or the dialog around the banner, when
 * there was none); nothing is moved if the focus is somewhere else by then, or the
 * dialog is gone too (the gate locked).
 */
function useRestoreFocus(banner: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = banner.current;
    if (element === null) return undefined;
    const host = element.closest<HTMLElement>('[role="dialog"]');
    let previous: HTMLElement | null =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body &&
      !element.contains(document.activeElement)
        ? document.activeElement
        : null;
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target !== document.body &&
        !element.contains(target)
      ) {
        previous = target;
      }
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      const active = document.activeElement;
      if (active !== null && active !== document.body) return;
      const back = [previous, host].find(
        (candidate) =>
          candidate?.isConnected === true &&
          candidate.closest("[inert]") === null,
      );
      back?.focus({ preventScroll: true });
    };
  }, [banner]);
}

/**
 * "Locking soon" (ADR-0013 auto-lock): a calm banner while the gate has been idle for
 * all but the last {@link PARENT_IDLE_WARNING_MS} of the idle lock, with one large "Keep
 * editing" button that restarts the idle time (any other touch or key does too). The
 * visible countdown shows the real seconds left but is hidden from assistive tech; a
 * static sentence is announced once when the banner appears (never every second). No
 * motion; the live region exists all the time. Rendered inside the open dialog, so
 * assistive tech does not treat it as outside the modal.
 *
 * `dock`: fixed to the bottom of the screen (the editor). `flow`: in the normal flow
 * after the PIN pad's card (beside it on wide screens, below it on narrow ones), so it
 * never covers the pad's buttons.
 */
export function IdleWarning({
  placement = "dock",
}: {
  placement?: "dock" | "flow";
}): React.JSX.Element {
  const { idleWarning } = useParentGate();
  return (
    <div
      aria-live="assertive"
      data-testid="idle-warning-region"
      className={placement === "flow" ? "w-full lg:w-auto" : undefined}
    >
      {idleWarning && <Banner placement={placement} />}
    </div>
  );
}

function Banner({
  placement,
}: {
  placement: "dock" | "flow";
}): React.JSX.Element {
  const { t } = useTranslation();
  const { idleSecondsLeft, stayActive } = useParentGate();
  const root = useRef<HTMLDivElement>(null);
  useRestoreFocus(root);
  const flow = placement === "flow";
  return (
    <div
      ref={root}
      data-testid="idle-warning"
      className={
        flow
          ? "mt-gutter lg:ms-gutter flex justify-center lg:mt-0"
          : "p-page pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center"
      }
    >
      <div
        className={`bg-surface-raised rounded-column shadow-raised gap-gutter text-text pointer-events-auto flex w-full items-center justify-between p-6 ${
          flow ? "max-w-[32rem] flex-wrap lg:w-72 lg:flex-col" : "max-w-[40rem]"
        }`}
      >
        <p className="sr-only">
          {t("parent.idle.announce", {
            seconds: PARENT_IDLE_WARNING_MS / 1000,
          })}
        </p>
        <div aria-hidden="true" className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-title">{t("parent.idle.title")}</p>
          <p className="text-body text-text-muted">
            {t("parent.idle.text", { count: idleSecondsLeft })}
          </p>
        </div>
        <button
          type="button"
          onClick={stayActive}
          className={`min-h-touch rounded-pill bg-accent text-on-accent text-title focus-visible:outline-text px-8 focus-visible:outline-4 focus-visible:outline-offset-2 ${
            flow ? "w-full" : ""
          }`}
        >
          {t("parent.idle.stay")}
        </button>
      </div>
    </div>
  );
}
