/*
 * Scrolling the parent editor to a place and moving the focus there: the first invalid
 * field after a failed save, a section of the jump bar. Smooth scrolling only when the
 * user has not asked for reduced motion.
 */

/** True when the user prefers reduced motion (or the platform cannot tell). */
export function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}

/** Scrolls `element` to the top of its scroll area (instant under reduced motion). */
export function scrollToStart(element: HTMLElement): void {
  // jsdom has no layout and no `scrollIntoView`.
  if (typeof element.scrollIntoView !== "function") return;
  element.scrollIntoView({ block: "start", behavior: scrollBehavior() });
}

/**
 * Brings `target` into view and focuses it, so keyboard and screen reader users land
 * there too. Targets that are no control (a heading) become focusable by script only.
 */
export function jumpTo(target: HTMLElement): void {
  if (target.tabIndex < 0 && !target.hasAttribute("tabindex")) {
    target.tabIndex = -1;
  }
  scrollToStart(target);
  target.focus({ preventScroll: true });
}

/** The first invalid field inside `root` and the control to focus in it. */
export function firstInvalid(
  root: HTMLElement,
): { field: HTMLElement; control: HTMLElement | null } | null {
  const marked = root.querySelector<HTMLElement>('[aria-invalid="true"]');
  if (marked === null) return null;
  if (marked instanceof HTMLFieldSetElement) {
    const control =
      marked.querySelector<HTMLElement>('input[aria-invalid="true"]') ??
      marked.querySelector<HTMLElement>(
        "[data-invalid-focus] input:not(:disabled)",
      ) ??
      marked.querySelector<HTMLElement>("input:checked:not(:disabled)") ??
      marked.querySelector<HTMLElement>(
        "input:not(:disabled), button:not(:disabled)",
      );
    return { field: marked, control };
  }
  const field = marked.closest<HTMLElement>("[data-editor-field]") ?? marked;
  return { field, control: marked };
}

/**
 * After a failed save: scrolls the first invalid field of `root` (with its message,
 * which sits inside the field) into view and focuses its control. Returns whether one
 * was found.
 */
export function revealFirstInvalid(root: HTMLElement | null): boolean {
  if (root === null) return false;
  const found = firstInvalid(root);
  if (found === null) return false;
  scrollToStart(found.field);
  found.control?.focus({ preventScroll: true });
  return true;
}
