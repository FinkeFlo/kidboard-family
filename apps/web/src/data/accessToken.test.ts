import { describe, expect, it, type Mock, vi } from "vitest";

import {
  ACCESS_TOKEN_STORAGE_KEY,
  consumeAccessToken,
  forgetAccessToken,
} from "./accessToken";
import type { KeyValueStorage } from "./storage";
import { TEST_TOKEN } from "./testing.test-utils";

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}

function fakeHistory(): {
  state: unknown;
  replaceState: Mock<History["replaceState"]>;
} {
  return {
    state: { from: "test" },
    replaceState: vi.fn<History["replaceState"]>(),
  };
}

describe("consumeAccessToken", () => {
  it("takes ?key=, stores it and removes it from the visible URL", () => {
    const storage = memoryStorage();
    const history = fakeHistory();

    const token = consumeAccessToken({
      storage,
      history,
      location: { href: `https://kb.test/week?view=1&key=${TEST_TOKEN}#top` },
    });

    expect(token).toBe(TEST_TOKEN);
    expect(storage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBe(TEST_TOKEN);
    expect(history.replaceState).toHaveBeenCalledWith(
      { from: "test" },
      "",
      "/week?view=1#top",
    );
  });

  it("uses the stored token when the URL has none, without touching history", () => {
    const history = fakeHistory();
    const token = consumeAccessToken({
      storage: memoryStorage({ [ACCESS_TOKEN_STORAGE_KEY]: TEST_TOKEN }),
      history,
      location: { href: "https://kb.test/" },
    });

    expect(token).toBe(TEST_TOKEN);
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it("lets a new ?key= replace the stored token", () => {
    const storage = memoryStorage({
      [ACCESS_TOKEN_STORAGE_KEY]: "old-TESTONLY",
    });
    const token = consumeAccessToken({
      storage,
      history: fakeHistory(),
      location: { href: "https://kb.test/?key=new-TESTONLY" },
    });

    expect(token).toBe("new-TESTONLY");
    expect(storage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBe("new-TESTONLY");
  });

  it("strips an empty ?key= and keeps the stored token", () => {
    const history = fakeHistory();
    const token = consumeAccessToken({
      storage: memoryStorage({ [ACCESS_TOKEN_STORAGE_KEY]: TEST_TOKEN }),
      history,
      location: { href: "https://kb.test/?key=" },
    });

    expect(token).toBe(TEST_TOKEN);
    expect(history.replaceState).toHaveBeenCalledWith(
      expect.anything(),
      "",
      "/",
    );
  });

  it("returns undefined without any token", () => {
    expect(
      consumeAccessToken({
        storage: memoryStorage(),
        history: fakeHistory(),
        location: { href: "https://kb.test/" },
      }),
    ).toBeUndefined();
  });

  it("keeps the URL token for the session when storage is unavailable", () => {
    const token = consumeAccessToken({
      storage: undefined,
      history: fakeHistory(),
      location: { href: `https://kb.test/?key=${TEST_TOKEN}` },
    });
    expect(token).toBe(TEST_TOKEN);
  });

  it("survives storage that throws on read and write", () => {
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
      removeItem: () => undefined,
    };
    expect(
      consumeAccessToken({
        storage: throwing,
        history: fakeHistory(),
        location: { href: `https://kb.test/?key=${TEST_TOKEN}` },
      }),
    ).toBe(TEST_TOKEN);
    expect(
      consumeAccessToken({
        storage: throwing,
        history: fakeHistory(),
        location: { href: "https://kb.test/" },
      }),
    ).toBeUndefined();
  });

  it("defaults to window.location and window.history", () => {
    window.history.replaceState(null, "", `/?a=1&key=${TEST_TOKEN}`);
    const token = consumeAccessToken({ storage: undefined });

    expect(token).toBe(TEST_TOKEN);
    expect(window.location.search).toBe("?a=1");
    window.history.replaceState(null, "", "/");
  });
});

describe("forgetAccessToken", () => {
  it("removes the stored token", () => {
    const storage = memoryStorage({ [ACCESS_TOKEN_STORAGE_KEY]: TEST_TOKEN });
    forgetAccessToken(storage);
    expect(storage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("ignores missing or throwing storage", () => {
    expect(() => {
      forgetAccessToken(undefined);
    }).not.toThrow();
    expect(() => {
      forgetAccessToken({
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => {
          throw new DOMException("denied", "SecurityError");
        },
      });
    }).not.toThrow();
  });
});
