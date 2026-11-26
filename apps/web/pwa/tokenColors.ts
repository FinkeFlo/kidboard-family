import { readFileSync } from "node:fs";

/** Light-theme colours used outside CSS (web manifest, generated icons). */
export interface PwaColors {
  /** `--color-surface`: splash screen and maskable icon background. */
  readonly background: string;
  /** `--color-accent`: brand colour for `theme_color` / `<meta name="theme-color">`. */
  readonly theme: string;
}

const TOKENS_URL = new URL("../src/styles/tokens.css", import.meta.url);

/**
 * Read the `--color-*` declarations of the first `@theme static { … }` block (the light
 * theme; night overrides live in a separate block and are ignored). Only plain hex
 * values are returned: the manifest needs literal colours.
 */
export function parseLightColorTokens(css: string): Map<string, string> {
  const start = css.indexOf("@theme static");
  if (start === -1) {
    throw new Error("tokens.css: `@theme static` block not found");
  }
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  if (open === -1 || close === -1) {
    throw new Error("tokens.css: unterminated `@theme static` block");
  }
  const body = css.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens = new Map<string, string>();
  for (const match of body.matchAll(
    /(--color-[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g,
  )) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) {
      tokens.set(name, value.toLowerCase());
    }
  }
  return tokens;
}

/** Pick the manifest colours from the token CSS; throws when a token is missing. */
export function pwaColorsFromTokens(css: string): PwaColors {
  const tokens = parseLightColorTokens(css);
  const pick = (name: string): string => {
    const value = tokens.get(name);
    if (value === undefined) {
      throw new Error(`tokens.css: ${name} is missing or not a hex colour`);
    }
    return value;
  };
  return {
    background: pick("--color-surface"),
    theme: pick("--color-accent"),
  };
}

/** Manifest colours read from `src/styles/tokens.css` (single source of truth). */
export function readPwaColors(): PwaColors {
  return pwaColorsFromTokens(readFileSync(TOKENS_URL, "utf8"));
}
