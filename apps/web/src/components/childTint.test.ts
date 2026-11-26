import { describe, expect, it } from "vitest";

import { resolveChildColor } from "./childColor";
import {
  MAX_BADGES,
  resolveChildTint,
  resolveTileTint,
  STRIPE_REM,
  stripeStyle,
  tileTintStyle,
} from "./childTint";
import { BEN, MIA } from "./fixtures.test-utils";

const child = (id: string, color: string): typeof MIA => ({
  ...MIA,
  id,
  color,
});

describe("resolveChildTint", () => {
  it("maps token colours to their tint token", () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(resolveChildTint(`child-${String(n)}`)).toBe(
        `var(--color-child-${String(n)}-tint)`,
      );
    }
    expect(resolveChildTint({ color: " child-3 " })).toBe(
      "var(--color-child-3-tint)",
    );
  });

  it("mixes hex colours 20 % into the surface", () => {
    expect(resolveChildTint("#ff00aa")).toBe(
      "color-mix(in oklab, #ff00aa 20%, var(--color-surface))",
    );
    expect(resolveChildTint({ color: "#e45" })).toBe(
      "color-mix(in oklab, #e45 20%, var(--color-surface))",
    );
  });

  it("falls back to the neutral fill for unusable colours", () => {
    for (const bad of [
      "child-7",
      "inherit",
      "initial",
      "notacolor",
      "rgb(red, x)",
      "url(http://x)",
      "red; background: blue",
      "",
      undefined,
    ]) {
      expect(resolveChildTint(bad)).toBe("var(--color-surface-raised)");
    }
  });
});

describe("resolveTileTint", () => {
  it("is neutral without children", () => {
    expect(resolveTileTint([])).toEqual({
      kind: "none",
      background: "var(--color-surface-raised)",
      edge: null,
      stripes: [],
      badges: [],
      overflow: 0,
    });
    expect(stripeStyle(resolveTileTint([]))).toBeUndefined();
  });

  it("uses tint, edge and one badge for a single child", () => {
    const tint = resolveTileTint([child("a", "child-2")]);
    expect(tint.kind).toBe("single");
    expect(tint.background).toBe("var(--color-child-2-tint)");
    expect(tint.edge).toBe("var(--color-child-2)");
    expect(tint.badges).toHaveLength(1);
    expect(tint.stripes).toEqual([]);
    expect(stripeStyle(tint)).toBeUndefined();
  });

  it("two children: neutral fill (no half-and-half bar) and a stripe per child, child 1 first", () => {
    const tint = resolveTileTint([MIA, BEN]);
    expect(tint.kind).toBe("split");
    expect(tint.edge).toBeNull();
    expect(tint.background).toBe("var(--color-surface-raised)");
    expect(tint.background).not.toContain("gradient");
    expect(tint.stripes).toEqual([
      resolveChildColor(MIA.color),
      resolveChildColor(BEN.color),
    ]);
    expect(tint.badges).toEqual([MIA, BEN]);
    // Side-by-side vertical bands with hard stops, one stripe width per child.
    expect(stripeStyle(tint)).toEqual({
      width: `${String(2 * STRIPE_REM)}rem`,
      background: `linear-gradient(90deg, ${resolveChildColor(MIA.color)} 0% 50%, ${resolveChildColor(BEN.color)} 50% 100%)`,
    });
  });

  it("is neutral for 3+ children with up to three badges and +N", () => {
    const four = ["a", "b", "c", "d"].map((id) => child(id, "child-1"));
    const tint = resolveTileTint(four);
    expect(tint.kind).toBe("neutral");
    expect(tint.background).toBe("var(--color-surface-raised)");
    expect(tint.badges).toHaveLength(MAX_BADGES);
    expect(tint.overflow).toBe(1);
    // Stripes only for the children with a badge.
    expect(tint.stripes).toHaveLength(MAX_BADGES);
    expect(stripeStyle(tint)?.width).toBe(`${String(3 * STRIPE_REM)}rem`);
    expect(resolveTileTint(four.slice(0, 3)).overflow).toBe(0);
  });

  it("validates the edge like the tint", () => {
    const bad = resolveTileTint([child("a", "notacolor")]);
    expect(bad.background).toBe("var(--color-surface-raised)");
    expect(bad.edge).toBe("var(--color-border)");
    expect(resolveTileTint([child("a", "#e4572e")]).edge).toBe("#e4572e");
  });

  it("builds a style value, with the edge only for one child", () => {
    const single = tileTintStyle(resolveTileTint([child("a", "child-1")]));
    expect(single).toEqual({
      background: "var(--color-child-1-tint)",
      "--child-color": "var(--color-child-1)",
    });
    expect(tileTintStyle(resolveTileTint([MIA, BEN]))).not.toHaveProperty(
      "--child-color",
    );
  });
});
