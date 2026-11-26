// @vitest-environment node
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  parseLightColorTokens,
  pwaColorsFromTokens,
  readPwaColors,
} from "./tokenColors";

const tokensCss = readFileSync(
  new URL("../src/styles/tokens.css", import.meta.url),
  "utf8",
);

describe("pwa token colours", () => {
  it("reads the manifest colours from the light tokens in tokens.css", () => {
    const light = parseLightColorTokens(tokensCss);
    expect(readPwaColors()).toEqual({
      background: light.get("--color-surface"),
      theme: light.get("--color-accent"),
    });
    expect(readPwaColors().background).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("ignores the night overrides and comments", () => {
    const css = `
      @theme static {
        --color-*: initial;
        /* --color-surface: #000000; */
        --color-surface: #FBF6EE;
        --color-accent: #a63a08;
      }
      [data-theme="night"] { --color-surface: #14100c; --color-accent: #f0a35e; }
    `;
    expect(pwaColorsFromTokens(css)).toEqual({
      background: "#fbf6ee",
      theme: "#a63a08",
    });
  });

  it("fails loudly when a required token is missing or not hex", () => {
    expect(() =>
      pwaColorsFromTokens("@theme static { --color-surface: #ffffff; }"),
    ).toThrow(/--color-accent/);
    expect(() =>
      pwaColorsFromTokens(
        "@theme static { --color-surface: var(--x); --color-accent: #a63a08; }",
      ),
    ).toThrow(/--color-surface/);
    expect(() =>
      pwaColorsFromTokens(":root { --color-surface: #fff; }"),
    ).toThrow(/@theme static/);
  });
});
