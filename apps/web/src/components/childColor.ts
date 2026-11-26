import type { CSSProperties } from "react";

/** Custom property that carries the resolved child colour into the styles. */
export const CHILD_COLOR_VAR = "--child-color";

/** Matches a token child colour (`child-1` … `child-6`); the capture is its number. */
export const CHILD_TOKEN = /^child-([1-6])$/;
/** `#rgb` or `#rrggbb`; the config schema (`ChildColorSchema`) allows nothing else. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const FALLBACK = "var(--color-border)";

/**
 * Resolves a configured child colour (`Child.color`, validated by the config schema) to
 * a CSS value for the `--child-color` custom property. A token name ("child-1") maps to
 * its design token and a hex colour passes through; anything else falls back to the
 * neutral border colour (defensive: the value is only ever used as a style variable
 * value, never in class names).
 */
export function resolveChildColor(color: string | undefined): string {
  const value = color?.trim() ?? "";
  if (CHILD_TOKEN.test(value)) return `var(--color-${value})`;
  return HEX.test(value) ? value : FALLBACK;
}

/**
 * How much of a child colour stays at night: avatar discs and tile edges are mixed a
 * quarter towards the page, so the saturated colours do not dominate the dark board (the
 * emoji are dimmed the same way). `tokens.test.ts` checks the dimmed colours' contrast.
 */
export const CHILD_NIGHT_STRENGTH = 0.75;

// Full class names so Tailwind can see them; 75 % = CHILD_NIGHT_STRENGTH.
/** Fill in the child colour (`--child-color`), dimmed at night. */
export const CHILD_FILL =
  "bg-(--child-color) night:bg-[color-mix(in_oklab,var(--child-color)_75%,var(--color-surface))]";
/** Inset edge in the child colour (pair with an `inset-ring-N` width), dimmed at night. */
export const CHILD_EDGE =
  "inset-ring-(color:--child-color) night:inset-ring-[color-mix(in_oklab,var(--child-color)_75%,var(--color-surface))]";
/** {@link CHILD_EDGE} on the `::after` overlay of a tile. */
export const CHILD_EDGE_AFTER =
  "after:inset-ring-(color:--child-color) night:after:inset-ring-[color-mix(in_oklab,var(--child-color)_75%,var(--color-surface))]";

/** Inline style that defines `--child-color` for a child (or the neutral fallback). */
export function childColorStyle(color: string | undefined): CSSProperties {
  // React's CSSProperties has no index signature for custom properties.
  return { [CHILD_COLOR_VAR]: resolveChildColor(color) } as CSSProperties;
}
