import { useLayoutEffect, useRef, useState } from "react";

import { useContentWidth } from "../day/useContentWidth";
import type { ClothingRowModel, TodayChipModel } from "./buildBoardWeather";
import { CLOTHING_ICON_STEPS, ClothingRow } from "./ClothingRow";
import { NowChip, WeatherChip } from "./WeatherChip";

/** Width in px the children of `element` need side by side, with its column gap. */
function neededWidth(element: HTMLElement): number {
  const children = [...element.children];
  const gap = parseFloat(getComputedStyle(element).columnGap) || 0;
  return (
    children.reduce(
      (sum, child) => sum + child.getBoundingClientRect().width,
      0,
    ) +
    gap * Math.max(0, children.length - 1)
  );
}

/**
 * Width in px left for the weather beside the heading: the heading row's width minus the
 * heading's full text (never truncated) and the row's gap.
 */
function availableWidth(element: HTMLElement): number {
  const row = element.parentElement;
  const heading = row === null ? null : row.querySelector("h2");
  if (row === null || heading === null) return element.clientWidth;
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
  const headingWidth = Math.max(
    heading.getBoundingClientRect().width,
    heading.scrollWidth,
  );
  return Math.min(element.clientWidth, row.clientWidth - headingWidth - gap);
}

/** One fit step: an icon size of {@link CLOTHING_ICON_STEPS} and whether the chip shows. */
interface FitStep {
  icons: number;
  chip: boolean;
}

/**
 * Fallbacks, first that fits wins. Evening: 2rem, 1.75rem, then the 🌡️ "now" chip gives
 * way (tomorrow's weather is in the pill), then 1.5rem. Morning (today's chip is the
 * clothes' weather): 2rem, 1.75rem, 1.5rem, and only then without the chip.
 */
export const FIT_PLANS: Record<"today" | "tomorrow", readonly FitStep[]> = {
  tomorrow: [
    { icons: 0, chip: true },
    { icons: 1, chip: true },
    { icons: 1, chip: false },
    { icons: 2, chip: false },
  ],
  today: [
    { icons: 0, chip: true },
    { icons: 1, chip: true },
    { icons: 2, chip: true },
    { icons: 2, chip: false },
  ],
};

/**
 * The weather part of today's heading row: the clothing pill and today's chip side by
 * side at its end, never wrapped (a wrapped pill took the 🎒 area's height) and never
 * over the heading, whose full text keeps its room. The first step of {@link FIT_PLANS}
 * at which pill and chip fit beside "Today" wins: measured before paint, again when the
 * width or the content change (back to the largest icons) and when the heading or a part
 * grows (web fonts arriving: further down only). The row's width does not depend on its
 * content (`flex-1 basis-0`), so measuring never feeds back into it.
 */
export function TodayWeatherHead({
  chip,
  clothing,
}: {
  chip: TodayChipModel | undefined;
  clothing: ClothingRowModel | undefined;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const width = useContentWidth(ref);
  const content = [
    clothing?.when,
    clothing?.items.map((item) => item.key).join(","),
    clothing?.when === "tomorrow" ? clothing.forecast.high : "",
    chip?.type === "now" ? chip.temperature : chip?.day.current,
    chip?.type === "day" ? chip.day.high : "",
  ].join("|");
  const key = `${String(width)}|${content}`;
  const plan = FIT_PLANS[clothing?.when ?? "today"];
  const [fit, setFit] = useState({ key, step: 0 });
  const index = fit.key === key ? fit.step : 0;
  // Checked again whenever the heading or a part of the head changes size (web fonts
  // arriving after the first measure); re-attached when the parts change.
  const [tick, setTick] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      setTick((value) => value + 1);
    });
    const heading = element.parentElement?.querySelector("h2");
    if (heading !== null && heading !== undefined) observer.observe(heading);
    for (const child of element.children) observer.observe(child);
    return () => {
      observer.disconnect();
    };
  }, [index, content]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || index >= plan.length - 1) return;
    if (neededWidth(element) > availableWidth(element) + 0.5) {
      setFit({ key, step: index + 1 });
    }
  }, [key, index, plan, tick]);
  const current = plan[index] ?? { icons: 0, chip: true };
  const step = CLOTHING_ICON_STEPS[current.icons] ?? CLOTHING_ICON_STEPS[0];
  const showChip = current.chip || clothing === undefined;
  return (
    <div
      ref={ref}
      data-testid="weather-head"
      data-fit={index}
      className="flex min-w-0 flex-1 basis-0 items-center justify-end gap-1 overflow-hidden"
    >
      {clothing !== undefined && <ClothingRow row={clothing} step={step} />}
      {showChip && chip?.type === "day" && (
        <WeatherChip day={chip.day} size="today" showCurrent />
      )}
      {showChip && chip?.type === "now" && (
        <NowChip date={chip.date} temperature={chip.temperature} />
      )}
    </div>
  );
}
