import type { Child } from "@kidboard/shared";
import type { CSSProperties } from "react";

import { CHILD_COLOR_VAR, CHILD_TOKEN, resolveChildColor } from "./childColor";

/** Neutral tile fill: no child, an unusable colour, or three and more children. */
const NEUTRAL = "var(--color-surface-raised)";
/** Badges shown on a tile before the rest is counted as "+N". */
export const MAX_BADGES = 3;

type ColorInput = Pick<Child, "color"> | string | undefined;

function colorOf(input: ColorInput): string | undefined {
  return typeof input === "string" ? input : input?.color;
}

/**
 * Tile fill for one child. A token colour (`child-N`) uses its design token
 * `--color-child-N-tint`; any other valid CSS colour is mixed 20 % into the surface so
 * text on it keeps its contrast in both themes. An unusable colour (config is
 * parent-edited text) falls back to the neutral fill. The value is only used as a style
 * value (CSP-safe), never in class names.
 */
export function resolveChildTint(input: ColorInput): string {
  const value = colorOf(input)?.trim() ?? "";
  const token = CHILD_TOKEN.exec(value);
  if (token) return `var(--color-child-${token[1] ?? "1"}-tint)`;
  const color = resolveChildColor(value);
  if (color === resolveChildColor(undefined)) return NEUTRAL;
  return `color-mix(in oklab, ${color} 20%, var(--color-surface))`;
}

export type TileTintKind = "none" | "single" | "split" | "neutral";

export interface TileTint {
  kind: TileTintKind;
  /** Value for the CSS `background` property. */
  background: string;
  /** Inset edge colour (one child only), else `null`. */
  edge: string | null;
  /**
   * Shared tiles (two and more children): the children's colours (as many as get a
   * badge) for the stripes on the tile's start edge; empty otherwise.
   */
  stripes: string[];
  /** Children that get a badge, in order (at most `MAX_BADGES`). */
  badges: Child[];
  /** Children beyond `MAX_BADGES`, shown as "+N". */
  overflow: number;
}

/**
 * Tint of a tile for its children: none → neutral; one → its tint and an edge; two →
 * neutral with a stripe per child on the start edge (side by side, so it never reads as
 * a "half done" bar); three or more → the same, with up to three badges and "+N".
 */
export function resolveTileTint(children: readonly Child[]): TileTint {
  const badges = children.slice(0, MAX_BADGES);
  const overflow = children.length - badges.length;
  const [first, second] = children;
  if (first === undefined) {
    return {
      kind: "none",
      background: NEUTRAL,
      edge: null,
      stripes: [],
      badges,
      overflow,
    };
  }
  if (second === undefined) {
    return {
      kind: "single",
      background: resolveChildTint(first),
      edge: resolveChildColor(first.color),
      stripes: [],
      badges,
      overflow,
    };
  }
  return {
    kind: children.length === 2 ? "split" : "neutral",
    background: NEUTRAL,
    edge: null,
    stripes: badges.map((child) => resolveChildColor(child.color)),
    badges,
    overflow,
  };
}

/** Width of one stripe of a shared tile in rem. */
export const STRIPE_REM = 0.375;

/**
 * Inline style of a shared tile's start-edge stripes: hard stops, one equal vertical band
 * per child, side by side; `undefined` when the tile has none. Style value only (CSP-safe).
 */
export function stripeStyle(tint: TileTint): CSSProperties | undefined {
  const count = tint.stripes.length;
  if (count === 0) return undefined;
  const stops = tint.stripes.map((color, index) => {
    const from = (index * 100) / count;
    const to = ((index + 1) * 100) / count;
    return `${color} ${String(from)}% ${String(to)}%`;
  });
  return {
    width: `${String(count * STRIPE_REM)}rem`,
    background: `linear-gradient(90deg, ${stops.join(", ")})`,
  };
}

/** Inline style carrying the tile fill (and the edge as `--child-color`). */
export function tileTintStyle(tint: TileTint): CSSProperties {
  return {
    background: tint.background,
    // React's CSSProperties has no index signature for custom properties.
    ...(tint.edge === null
      ? {}
      : ({ [CHILD_COLOR_VAR]: tint.edge } as CSSProperties)),
  };
}
