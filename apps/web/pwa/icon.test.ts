// @vitest-environment node
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseLightColorTokens } from "./tokenColors";

const svg = readFileSync(
  new URL("../public/kidboard-icon.svg", import.meta.url),
  "utf8",
);
const tokens = parseLightColorTokens(
  readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8"),
);

describe("app icon source", () => {
  it("is a square SVG", () => {
    expect(svg).toMatch(/<svg[^>]*viewBox="0 0 512 512"/);
  });

  it("only uses light design-token colours", () => {
    const used = [...svg.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) =>
      m[0].toLowerCase(),
    );
    expect(used.length).toBeGreaterThan(0);
    const allowed = new Set(tokens.values());
    expect(used.filter((color) => !allowed.has(color))).toEqual([]);
  });

  it("contains no scripts, external references or embedded rasters", () => {
    expect(svg).not.toMatch(/<script|href=|<image|<foreignObject/i);
  });
});
