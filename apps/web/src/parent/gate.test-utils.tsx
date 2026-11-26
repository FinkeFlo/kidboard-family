// Test helpers for the parent gate (not part of the app bundle).
import { render, type RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";

import { type ParentGate, ParentGateContext } from "./parentGate";

/** A controllable gate: spies for the actions, fields overridable. */
export function fakeGate(overrides: Partial<ParentGate> = {}): ParentGate {
  return {
    stage: "closed",
    session: null,
    lockoutUntil: null,
    idleWarning: false,
    idleSecondsLeft: 0,
    stayActive: vi.fn(),
    openPin: vi.fn(),
    unlock: vi.fn(() => Promise.resolve({ kind: "unlocked" as const })),
    lock: vi.fn(),
    close: vi.fn(),
    entryRef: { current: null },
    ...overrides,
  };
}

/** Renders `ui` with `gate` as the parent gate. */
export function renderWithGate(ui: ReactNode, gate: ParentGate): RenderResult {
  return render(<ParentGateContext value={gate}>{ui}</ParentGateContext>);
}
