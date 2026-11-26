/** Room an icon row needs and how many whole icons it can draw (all sizes in rem). */
export interface IconRowMetrics {
  /** Width of one icon's slot. */
  slotRem: number;
  /** Gap between two icons (and before the "+N"). */
  gapRem: number;
  /** Room kept for the "+N" when not every icon fits. */
  moreRem: number;
}

/** Width in rem of `icons` whole icons side by side (no "+N"). Never negative. */
export function iconRowRem(icons: number, metrics: IconRowMetrics): number {
  if (icons <= 0) return 0;
  return icons * metrics.slotRem + (icons - 1) * metrics.gapRem;
}

/**
 * How many of `icons` a row can draw in `widthRem` (`null`: not measured, then all of
 * them), when `hidden` further items have no icon anyway and are counted in "+N". Every
 * icon is drawn whole: if they do not all fit (with the "+N" when one is needed), as many
 * as fit next to a "+N" that counts the rest. Never negative.
 */
export function iconsThatFit(
  icons: number,
  hidden: number,
  widthRem: number | null,
  metrics: IconRowMetrics,
): number {
  if (widthRem === null || icons <= 0) return Math.max(0, icons);
  const { slotRem, gapRem, moreRem } = metrics;
  const available = widthRem + 1e-6;
  const all = iconRowRem(icons, metrics) + (hidden > 0 ? gapRem + moreRem : 0);
  if (all <= available) return icons;
  const fit = Math.floor((available - moreRem) / (slotRem + gapRem));
  return Math.max(0, Math.min(icons, fit));
}
