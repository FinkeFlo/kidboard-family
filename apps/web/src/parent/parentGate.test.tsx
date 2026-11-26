import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  PARENT_SESSION_TTL_MS,
  sessionLockAt,
  useParentGate,
  useParentGateOpen,
} from "./parentGate";

const T0 = Date.parse("2026-11-22T11:00:00Z");

describe("sessionLockAt", () => {
  it("uses the worker's expiry when it is plausible on this clock", () => {
    expect(sessionLockAt(T0, T0 + PARENT_SESSION_TTL_MS)).toBe(
      T0 + PARENT_SESSION_TTL_MS,
    );
    expect(sessionLockAt(T0, T0 + 60_000)).toBe(T0 + 60_000);
  });

  it.each([
    ["in the past (device clock ahead)", T0 - 60_000],
    ["exactly now", T0],
    ["beyond the session length (device clock behind)", T0 + 3_600_000],
    ["not a number", Number.NaN],
  ])(
    "falls back to 15 min from receipt when the expiry is %s",
    (_, expiresAt) => {
      expect(sessionLockAt(T0, expiresAt)).toBe(T0 + PARENT_SESSION_TTL_MS);
    },
  );
});

describe("gate hooks outside a provider", () => {
  it("report nothing open", () => {
    expect(renderHook(() => useParentGateOpen()).result.current).toBe(false);
  });

  it("refuse to hand out a gate", () => {
    expect(() => renderHook(() => useParentGate())).toThrow(
      /ParentGateProvider/,
    );
  });
});
