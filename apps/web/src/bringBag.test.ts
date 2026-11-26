import { FALLBACK_ICON_TABLE } from "@kidboard/shared";
import { describe, expect, it } from "vitest";

import de from "./i18n/locales/de.json";
import en from "./i18n/locales/en.json";

/*
 * Merge rule 1 (one symbol, one meaning) for the bring bag: 🎒 means only "pack this"
 * and leads the evening-before area (T-36). It is defined once (`BRING_BAG`), drawn only
 * by `BringArea`, and appears in no other UI source, locale or built-in table.
 */

const BAG = "🎒";

// Every non-test source of the UI and the demo data.
const sources = import.meta.glob<string>(
  [
    "./**/*.{ts,tsx}",
    "../demo/**/*.ts",
    "!./**/*.test.{ts,tsx}",
    "!./**/*.test-utils.ts",
    "!../demo/**/*.test.ts",
  ],
  { query: "?raw", import: "default", eager: true },
);

/** The source without comments (docs may name the area by its symbol). */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^\s*\/\/.*$/gmu, "")
    .replace(/\s\/\/.*$/gmu, "");
}

describe("🎒 has one meaning (merge rule 1)", () => {
  it("scans real sources", () => {
    const names = Object.keys(sources);
    expect(names.some((n) => n.endsWith("day/BringArea.tsx"))).toBe(true);
    expect(names.some((n) => n.endsWith("demoData.ts"))).toBe(true);
    expect(names.some((n) => n.includes(".test."))).toBe(false);
  });

  it("appears in code only as BRING_BAG, used only by the bring area", () => {
    const withBag = Object.entries(sources)
      .filter(([, text]) => code(text).includes(BAG))
      .map(([name]) => name);
    expect(withBag).toEqual(["./day/buildBringReminder.ts"]);
    const users = Object.entries(sources)
      .filter(([, text]) => /\bBRING_BAG\b/u.test(code(text)))
      .map(([name]) => name)
      .sort();
    expect(users).toEqual([
      "./day/BringArea.tsx",
      "./day/buildBringReminder.ts",
    ]);
  });

  it("is in no locale string and no built-in icon table", () => {
    expect(JSON.stringify(en)).not.toContain(BAG);
    expect(JSON.stringify(de)).not.toContain(BAG);
    expect(FALLBACK_ICON_TABLE.map((entry) => entry.icon)).not.toContain(BAG);
  });

  it("the comment filter keeps code (negative case)", () => {
    expect(code(`const a = "${BAG}"; // ${BAG}`)).toContain(BAG);
    expect(code(`/* ${BAG} */\n// ${BAG}\nconst b = 1;`)).not.toContain(BAG);
  });
});
