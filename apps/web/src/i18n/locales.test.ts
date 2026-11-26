import { describe, expect, it } from "vitest";

import de from "./locales/de.json";
import en from "./locales/en.json";

function flatten(
  node: unknown,
  prefix = "",
  out: Map<string, unknown> = new Map(),
): Map<string, unknown> {
  if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      flatten(value, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out.set(prefix, node);
  }
  return out;
}

describe("locale resources", () => {
  const deKeys = flatten(de);
  const enKeys = flatten(en);

  it("have identical key sets", () => {
    expect([...deKeys.keys()].sort()).toEqual([...enKeys.keys()].sort());
  });

  it.each([
    ["de", deKeys],
    ["en", enKeys],
  ])("%s has only non-empty string values", (_name, keys) => {
    expect(keys.size).toBeGreaterThan(0);
    for (const [key, value] of keys) {
      expect(typeof value, key).toBe("string");
      expect((value as string).trim(), key).not.toBe("");
    }
  });
});
