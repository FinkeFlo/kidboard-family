import { afterEach, describe, expect, it, vi } from "vitest";

import { applyLocale, i18n, initI18n } from "./index";

afterEach(() => {
  vi.restoreAllMocks();
  initI18n({ configLocale: "en" });
});

describe("initI18n / applyLocale", () => {
  it("translates with the resolved language and updates <html lang>", () => {
    expect(initI18n({ configLocale: "de" })).toBe("de");
    expect(i18n.t("error.retry")).toBe("Jetzt neu laden");
    expect(document.documentElement.lang).toBe("de");
  });

  it("falls back to the browser language, then de, without a config locale", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr", "en-GB"]);
    expect(initI18n()).toBe("en");
    expect(document.documentElement.lang).toBe("en");

    vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr"]);
    expect(applyLocale("auto")).toBe("de");
    expect(document.documentElement.lang).toBe("de");
  });

  it("applies the config locale once it is known", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["de-DE"]);
    initI18n();
    expect(applyLocale("en")).toBe("en");
    expect(i18n.t("error.retry")).toBe("Reload now");
    expect(document.documentElement.lang).toBe("en");
  });
});
