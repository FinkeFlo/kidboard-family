import { describe, expect, it } from "vitest";

import type { KeyValueStorage } from "../data/storage";
import { rememberTheme, THEME_STORAGE_KEY } from "./themeMemory";

function memoryStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

describe("rememberTheme", () => {
  it("stores night and light under the boot script's key", () => {
    const storage = memoryStorage();
    rememberTheme(true, storage);
    expect(storage.map.get(THEME_STORAGE_KEY)).toBe("night");
    rememberTheme(false, storage);
    expect(storage.map.get(THEME_STORAGE_KEY)).toBe("light");
    expect(storage.map.size).toBe(1);
  });

  it("is a no-op without storage", () => {
    expect(() => {
      rememberTheme(true, undefined);
    }).not.toThrow();
  });

  it("swallows a failing write (quota, blocked storage)", () => {
    const storage: KeyValueStorage = {
      ...memoryStorage(),
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    };
    expect(() => {
      rememberTheme(true, storage);
    }).not.toThrow();
  });

  it("uses window.localStorage by default", () => {
    rememberTheme(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("night");
    window.localStorage.clear();
  });
});
