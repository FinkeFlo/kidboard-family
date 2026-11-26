import { type RefObject, useLayoutEffect, useState } from "react";

/** Content-box width of `element` in rem right now: `clientWidth` minus the inline padding. */
export function measureContentWidthRem(element: HTMLElement): number {
  const style = getComputedStyle(element);
  const padding =
    (parseFloat(style.paddingLeft) || 0) +
    (parseFloat(style.paddingRight) || 0);
  return Math.max(0, element.clientWidth - padding) / rootRem();
}

function rootRem(): number {
  const size = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) && size > 0 ? size : 16;
}

/**
 * Content-box width of `ref`'s element in rem, kept up to date with a `ResizeObserver`;
 * measured synchronously before the first paint (like `useContentHeight`). `null` where
 * `ResizeObserver` is missing (callers then fall back to their fixed maximum). The
 * element's width must not depend on its content (e.g. `flex-1 basis-0 min-w-0`).
 */
export function useContentWidth(
  ref: RefObject<HTMLElement | null>,
): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    setWidth(measureContentWidthRem(element));
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry === undefined) return;
      const next = entry.contentRect.width;
      if (Number.isFinite(next)) setWidth(next / rootRem());
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return width;
}
