import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApiClient } from "../data/apiClient";
import { ApiClientContext } from "../data/apiContext";
import { useConfig } from "../data/queries";
import { createQueryClient } from "../data/queryClient";
import {
  configFixture,
  createFakeFetch,
  createMemoryStorage,
  dataWrapper,
  type FakeFetch,
  TEST_TOKEN,
} from "../data/testing.test-utils";
import {
  PARENT_IDLE_LOCK_MS,
  PARENT_IDLE_WARNING_MS,
  PARENT_SESSION_TTL_MS,
  type UnlockOutcome,
  useParentGate,
} from "./parentGate";
import { ParentGateProvider } from "./ParentGateProvider";

const T0 = Date.parse("2026-11-22T11:00:00Z");
const SESSION = "v1.1795000000.TESTONLY-not-a-signature";
const UNLOCKED = {
  status: 200,
  body: {
    token: SESSION,
    expiresAt: new Date(T0 + PARENT_SESSION_TTL_MS).toISOString(),
  },
};

let fake: FakeFetch;
let visibility: DocumentVisibilityState;

function renderGate(): ReturnType<
  typeof renderHook<ReturnType<typeof useParentGate>, unknown>
> {
  const api = createApiClient({ fetch: fake.fetch, token: TEST_TOKEN });
  function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return createElement(
      ApiClientContext,
      { value: api },
      createElement(ParentGateProvider, null, children),
    );
  }
  return renderHook(() => useParentGate(), { wrapper: Wrapper });
}

async function unlockWith(
  gate: { current: ReturnType<typeof useParentGate> },
  pin = "123456",
): Promise<UnlockOutcome> {
  let outcome: UnlockOutcome | undefined;
  await act(async () => {
    outcome = await gate.current.unlock(pin);
  });
  if (outcome === undefined) throw new Error("no outcome");
  return outcome;
}

function setVisibility(state: DocumentVisibilityState): void {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  fake = createFakeFetch();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("ParentGateProvider", () => {
  it("goes board → PIN pad → editor and keeps the token in memory only", async () => {
    fake.setReplies("/api/parent/unlock", UNLOCKED);
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderGate();
    expect(result.current.stage).toBe("closed");

    act(() => {
      result.current.openPin();
    });
    expect(result.current.stage).toBe("pin");
    expect(await unlockWith(result)).toEqual({ kind: "unlocked" });

    expect(result.current.stage).toBe("editor");
    expect(result.current.session).toEqual({
      token: SESSION,
      lockAt: T0 + PARENT_SESSION_TTL_MS,
    });
    expect(storage).not.toHaveBeenCalled();
    storage.mockRestore();

    act(() => {
      result.current.lock();
    });
    expect(result.current.stage).toBe("closed");
    expect(result.current.session).toBeNull();
  });

  it("stays on the PIN pad after a wrong PIN and reports the attempts left", async () => {
    fake.setReplies("/api/parent/unlock", {
      status: 403,
      body: { error: "wrong_pin", attemptsLeft: 2 },
    });
    const { result } = renderGate();
    act(() => {
      result.current.openPin();
    });
    expect(await unlockWith(result)).toEqual({
      kind: "wrong-pin",
      attemptsLeft: 2,
    });
    expect(result.current.stage).toBe("pin");
    expect(result.current.session).toBeNull();
  });

  it("remembers a lockout (from Retry-After) across closing the pad, until an unlock", async () => {
    fake.setReplies(
      "/api/parent/unlock",
      {
        status: 429,
        body: { error: "parent_lockout" },
        headers: { "Retry-After": "600" },
      },
      UNLOCKED,
    );
    const { result } = renderGate();
    act(() => {
      result.current.openPin();
    });
    expect(await unlockWith(result)).toEqual({
      kind: "lockout",
      until: T0 + 600_000,
    });
    act(() => {
      result.current.lock();
      result.current.openPin();
    });
    expect(result.current.lockoutUntil).toBe(T0 + 600_000);
    await unlockWith(result);
    expect(result.current.lockoutUntil).toBeNull();
  });

  it.each([
    [{ status: 401, body: { error: "unauthorized" } }, "unauthorized"],
    [{ status: 404, body: { error: "not_found" } }, "unavailable"],
    [{ status: 500, body: { error: "internal" } }, "failed"],
    [{ status: 200, body: { nope: true } }, "failed"],
    ["network-error" as const, "failed"],
  ])("maps %j to the error %s", async (reply, error) => {
    fake.setReplies("/api/parent/unlock", reply);
    const { result } = renderGate();
    act(() => {
      result.current.openPin();
    });
    expect(await unlockWith(result)).toEqual({ kind: "error", error });
    expect(result.current.stage).toBe("pin");
  });

  it("discards an unlock answer that arrives after the gate was locked", async () => {
    fake.setReplies("/api/parent/unlock", "hang");
    const { result } = renderGate();
    act(() => {
      result.current.openPin();
    });
    let pending: Promise<UnlockOutcome> | undefined;
    act(() => {
      pending = result.current.unlock("123456");
    });
    act(() => {
      result.current.lock();
    });
    let outcome: UnlockOutcome | undefined;
    await act(async () => {
      outcome = await pending;
    });
    expect(outcome).toEqual({ kind: "cancelled" });
    expect(fake.calls[0]?.init?.signal?.aborted).toBe(true);
    expect(result.current.stage).toBe("closed");
    expect(result.current.session).toBeNull();
  });

  describe("auto-lock", () => {
    async function unlocked(): Promise<{
      current: ReturnType<typeof useParentGate>;
    }> {
      fake.setReplies("/api/parent/unlock", UNLOCKED);
      const { result } = renderGate();
      act(() => {
        result.current.openPin();
      });
      await unlockWith(result);
      expect(result.current.stage).toBe("editor");
      return result;
    }

    it("locks after 3 minutes without a touch; every touch or key restarts it", async () => {
      const result = await unlocked();
      act(() => {
        vi.advanceTimersByTime(PARENT_IDLE_LOCK_MS - 2000);
      });
      expect(result.current.stage).toBe("editor");
      act(() => {
        document.dispatchEvent(new Event("pointerdown"));
        vi.advanceTimersByTime(PARENT_IDLE_LOCK_MS - 2000);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
        vi.advanceTimersByTime(PARENT_IDLE_LOCK_MS - 2000);
      });
      expect(result.current.stage).toBe("editor");
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(result.current.stage).toBe("closed");
      expect(result.current.session).toBeNull();
    });

    it("also closes an idle PIN pad", () => {
      const { result } = renderGate();
      act(() => {
        result.current.openPin();
      });
      act(() => {
        vi.advanceTimersByTime(PARENT_IDLE_LOCK_MS - 1000);
      });
      expect(result.current.stage).toBe("pin");
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(result.current.stage).toBe("closed");
    });

    it("locks at once when the tab is hidden, not when it becomes visible", async () => {
      const result = await unlocked();
      act(() => {
        setVisibility("visible");
      });
      expect(result.current.stage).toBe("editor");
      act(() => {
        setVisibility("hidden");
      });
      expect(result.current.stage).toBe("closed");
      expect(result.current.session).toBeNull();
    });

    it("locks when the session expires, even while in use", async () => {
      const result = await unlocked();
      for (let minute = 0; minute < 14; minute += 1) {
        act(() => {
          vi.advanceTimersByTime(60_000);
          document.dispatchEvent(new Event("pointermove"));
        });
      }
      expect(result.current.stage).toBe("editor");
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(result.current.stage).toBe("closed");
    });

    it("locks on wake-up when the clock jumped past the idle limit (timers were asleep)", async () => {
      const result = await unlocked();
      act(() => {
        vi.setSystemTime(T0 + PARENT_IDLE_LOCK_MS + 1000);
        setVisibility("visible");
      });
      expect(result.current.stage).toBe("closed");
    });

    it("warns 30 s before the idle lock; any input or stayActive hides the warning and restarts the time", async () => {
      const result = await unlocked();
      const warnAt = PARENT_IDLE_LOCK_MS - PARENT_IDLE_WARNING_MS;
      act(() => {
        vi.advanceTimersByTime(warnAt - 1000);
      });
      expect(result.current.idleWarning).toBe(false);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(result.current.idleWarning).toBe(true);

      // A touch hides it at once (no tick needed) and restarts the idle time.
      act(() => {
        document.dispatchEvent(new Event("pointerdown"));
      });
      expect(result.current.idleWarning).toBe(false);
      act(() => {
        vi.advanceTimersByTime(warnAt);
      });
      expect(result.current.idleWarning).toBe(true);

      // "Keep editing": the full 3 minutes again.
      act(() => {
        result.current.stayActive();
      });
      expect(result.current.idleWarning).toBe(false);
      act(() => {
        vi.advanceTimersByTime(PARENT_IDLE_LOCK_MS - 1000);
      });
      expect(result.current.stage).toBe("editor");
      expect(result.current.idleWarning).toBe(true);

      // Ignored: it locks at 3 minutes and the warning goes with it.
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(result.current.stage).toBe("closed");
      expect(result.current.idleWarning).toBe(false);
    });

    it("counts the real seconds left down while the warning shows", async () => {
      const result = await unlocked();
      expect(result.current.idleSecondsLeft).toBe(0);
      act(() => {
        vi.advanceTimersByTime(PARENT_IDLE_LOCK_MS - PARENT_IDLE_WARNING_MS);
      });
      expect(result.current.idleSecondsLeft).toBe(30);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(result.current.idleSecondsLeft).toBe(29);
      act(() => {
        vi.advanceTimersByTime(27_000);
      });
      expect(result.current.idleSecondsLeft).toBe(2);
      act(() => {
        result.current.stayActive();
      });
      expect(result.current.idleSecondsLeft).toBe(0);
    });

    it("drops the warning when the tab is hidden (locks at once) and on reopening", async () => {
      const result = await unlocked();
      act(() => {
        vi.advanceTimersByTime(PARENT_IDLE_LOCK_MS - 10_000);
      });
      expect(result.current.idleWarning).toBe(true);
      act(() => {
        setVisibility("hidden");
      });
      expect(result.current.stage).toBe("closed");
      expect(result.current.idleWarning).toBe(false);
      act(() => {
        setVisibility("visible");
        result.current.openPin();
      });
      expect(result.current.stage).toBe("pin");
      expect(result.current.idleWarning).toBe(false);
    });

    it("stops listening once locked", async () => {
      const result = await unlocked();
      act(() => {
        result.current.lock();
      });
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});

describe("ParentGateProvider and the board's access token", () => {
  it("never wipes the board's data or token on 403, 429 or 401 from the unlock", async () => {
    vi.useRealTimers();
    fake.setReplies("/api/config", { status: 200, body: configFixture() });
    fake.setReplies(
      "/api/parent/unlock",
      { status: 403, body: { error: "wrong_pin", attemptsLeft: 4 } },
      {
        status: 429,
        body: { error: "parent_lockout" },
        headers: { "Retry-After": "900" },
      },
      { status: 401, body: { error: "unauthorized" } },
    );
    const onUnauthorized = vi.fn();
    const client = createQueryClient({ retry: false, onUnauthorized });
    const DataWrapper = dataWrapper(
      createApiClient({ fetch: fake.fetch, token: TEST_TOKEN }),
      client,
      createMemoryStorage(),
    );
    function Wrapper({ children }: { children: ReactNode }): ReactNode {
      return createElement(
        DataWrapper,
        null,
        createElement(ParentGateProvider, null, children),
      );
    }
    const { result } = renderHook(
      () => ({ gate: useParentGate(), config: useConfig() }),
      { wrapper: Wrapper },
    );
    await waitFor(() => {
      expect(result.current.config.data).toBeDefined();
    });
    act(() => {
      result.current.gate.openPin();
    });

    const outcomes: UnlockOutcome[] = [];
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        outcomes.push(await result.current.gate.unlock("123456"));
      });
    }
    expect(outcomes.map((o) => o.kind)).toEqual([
      "wrong-pin",
      "lockout",
      "error",
    ]);
    // Same access token as the board on every parent call.
    for (const call of fake.calls) {
      expect(new Headers(call.init?.headers).get("Authorization")).toBe(
        `Bearer ${TEST_TOKEN}`,
      );
    }
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(result.current.config.data).toBeDefined();
    expect(result.current.config.status).toBe("success");
    client.clear();
  });
});
