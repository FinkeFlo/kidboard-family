import { useLayoutEffect, useRef, useState } from "react";

import { useNow } from "../time";
import { isNight, type NightMode, parseNightOverride } from "./night";
import { rememberTheme } from "./themeMemory";

/** Attribute that enables the colour transition on <html> while the theme switches. */
const SWITCHING_ATTR = "data-theme-switching";
/** Longer than `--duration-slow` (600 ms), so the transition is never cut short. */
const SWITCHING_MS = 800;

/** Marks <html> with the theme and keeps `<meta name="theme-color">` in step. */
function applyTheme(night: boolean): void {
  const root = document.documentElement;
  root.dataset["theme"] = night ? "night" : "light";
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (meta === null) {
    return;
  }
  // The light value is the build-time one (brand accent); remember it for the way back.
  meta.dataset["lightContent"] ??= meta.content;
  meta.content = night
    ? getComputedStyle(root).getPropertyValue("--color-surface").trim()
    : (meta.dataset["lightContent"] ?? meta.content);
}

/**
 * Night mode (T-21): sets `data-theme="night"|"light"` on <html>, which swaps the token
 * set (`tokens.css`). Active inside `nightMode` of the config in its time zone, re-evaluated
 * on the minute clock; `?night=1|0` forces it (read once, not persisted). Until the config
 * is known the theme is left untouched: the theme the boot script in `index.html` applied
 * before first paint (the last remembered one, see `themeMemory.ts`), else light tokens.
 * The first known value applies at once and is remembered unless it is a `?night`
 * override. A change fades over `--duration-slow` (see `global.css`); under
 * `prefers-reduced-motion` it is instant. Returns whether it is night.
 */
export function useNightTheme(
  nightMode: NightMode | undefined,
  timeZone: string | undefined,
): boolean {
  const now = useNow();
  const [override] = useState(() => parseNightOverride(window.location.search));
  const known =
    override !== undefined ||
    (nightMode !== undefined && timeZone !== undefined);
  const night =
    override ??
    (nightMode === undefined || timeZone === undefined
      ? false
      : isNight(now, nightMode, timeZone));

  const previous = useRef<boolean | undefined>(undefined);
  useLayoutEffect(() => {
    // Without a config the theme stays as it is (light tokens): the first real value
    // must apply at once, not fade in from the placeholder.
    if (!known) {
      return undefined;
    }
    const changed =
      previous.current !== undefined && previous.current !== night;
    previous.current = night;
    const root = document.documentElement;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (changed) {
      root.setAttribute(SWITCHING_ATTR, "");
      // Flush styles so the transition is part of the "before" style of the switch.
      getComputedStyle(root).getPropertyValue("transition-property");
      timer = setTimeout(() => {
        root.removeAttribute(SWITCHING_ATTR);
      }, SWITCHING_MS);
    }
    applyTheme(night);
    // Only the clock's theme is remembered for the next cold start, never `?night`.
    if (override === undefined) {
      rememberTheme(night);
    }
    return () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        root.removeAttribute(SWITCHING_ATTR);
      }
    };
  }, [night, known, override]);

  return night;
}
