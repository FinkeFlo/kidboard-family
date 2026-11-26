import { describe, expect, it } from "vitest";

import { matchLocale, resolveLocale } from "./locale";

describe("matchLocale", () => {
  it("maps regional and oddly cased tags to the primary language", () => {
    expect(matchLocale("de-AT")).toBe("de");
    expect(matchLocale("EN_us")).toBe("en");
    expect(matchLocale(" en ")).toBe("en");
  });

  it("rejects unsupported or empty tags", () => {
    expect(matchLocale("fr-FR")).toBeUndefined();
    expect(matchLocale("")).toBeUndefined();
    expect(matchLocale("deutsch")).toBeUndefined();
  });
});

describe("resolveLocale", () => {
  it("prefers an explicit config locale over the browser", () => {
    expect(
      resolveLocale({ configLocale: "en", browserLanguages: ["de-DE"] }),
    ).toBe("en");
    expect(
      resolveLocale({ configLocale: "de", browserLanguages: ["en-US"] }),
    ).toBe("de");
  });

  it("uses the first supported browser language for auto or missing config", () => {
    expect(
      resolveLocale({
        configLocale: "auto",
        browserLanguages: ["fr", "en-GB"],
      }),
    ).toBe("en");
    expect(resolveLocale({ browserLanguages: ["de-CH", "en"] })).toBe("de");
  });

  it("falls back to de when nothing matches", () => {
    expect(resolveLocale()).toBe("de");
    expect(resolveLocale({ configLocale: "auto", browserLanguages: [] })).toBe(
      "de",
    );
    expect(resolveLocale({ browserLanguages: ["fr-FR", "ja"] })).toBe("de");
  });
});
