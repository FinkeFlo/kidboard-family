import { type RefObject, useLayoutEffect, useState } from "react";

export interface ContentSize {
  /** Content-box height of the element in px. */
  height: number;
  /** Root font size in px (1rem), read at the same time: the board's rem scale. */
  rem: number;
}

function rootRem(): number {
  const size = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) && size > 0 ? size : 16;
}

/** Content-box height right now: `clientHeight` minus the vertical padding. */
export function measureContentHeight(element: HTMLElement): number {
  const style = getComputedStyle(element);
  const padding =
    (parseFloat(style.paddingTop) || 0) +
    (parseFloat(style.paddingBottom) || 0);
  return Math.max(0, element.clientHeight - padding);
}

/**
 * Content-box height of `ref`'s element, kept up to date with a `ResizeObserver`, plus the
 * root font size. The first value is measured synchronously in the layout effect, before
 * the browser paints, so the first frame is already fitted (no flash of the unfitted
 * column); the observer keeps it current afterwards. `null` where `ResizeObserver` is
 * missing (callers then show everything). The element's height must not depend on its
 * content (e.g. `flex-1 min-h-0`), or measuring and laying out would feed each other.
 */
export function useContentHeight(
  ref: RefObject<HTMLElement | null>,
): ContentSize | null {
  const [size, setSize] = useState<ContentSize | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const update = (height: number): void => {
      const next = { height, rem: rootRem() };
      setSize((previous) =>
        previous?.height === next.height && previous.rem === next.rem
          ? previous
          : next,
      );
    };
    // Synchronous first measurement: a state update in a layout effect re-renders before
    // the paint, so the observer's first (asynchronous) callback is not awaited.
    update(measureContentHeight(element));
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry === undefined) return;
      update(entry.contentRect.height);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return size;
}
