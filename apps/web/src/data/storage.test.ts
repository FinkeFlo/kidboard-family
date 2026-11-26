import { describe, expect, it } from "vitest";

import { getLocalStorage, type KeyValueStorage } from "./storage";
import { createMemoryStorage as memoryStorage } from "./testing.test-utils";

describe("getLocalStorage", () => {
  it("returns window.localStorage when usable", () => {
    expect(getLocalStorage()).toBe(window.localStorage);
  });

  it("leaves no probe key behind", () => {
    const storage = memoryStorage();
    expect(getLocalStorage(() => storage)).toBe(storage);
    expect(storage.data.size).toBe(0);
  });

  it("returns undefined when accessing storage throws (blocked)", () => {
    expect(
      getLocalStorage(() => {
        throw new DOMException("denied", "SecurityError");
      }),
    ).toBeUndefined();
  });

  it("returns undefined when writes throw (private mode quota 0)", () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    expect(getLocalStorage(() => storage)).toBeUndefined();
  });

  it("returns undefined when localStorage is null (Android WebView)", () => {
    expect(
      getLocalStorage(() => null as unknown as KeyValueStorage),
    ).toBeUndefined();
  });
});
