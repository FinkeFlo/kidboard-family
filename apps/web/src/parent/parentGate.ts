import { createContext, type RefObject, useContext, useEffect } from "react";

/** ADR-0013: the editor locks itself after 3 minutes without a touch or key. */
export const PARENT_IDLE_LOCK_MS = 3 * 60_000;
/** The "locking soon" warning shows this long before the idle lock. */
export const PARENT_IDLE_WARNING_MS = 30_000;
/** ADR-0013: a parent session is valid 15 minutes. */
export const PARENT_SESSION_TTL_MS = 15 * 60_000;
/** How often the open gate checks idle time and session expiry against the clock. */
export const PARENT_LOCK_CHECK_MS = 1000;
/** ADR-0013: parent PINs have 6 to 12 digits. */
export const PIN_MIN_LENGTH = 6;
export const PIN_MAX_LENGTH = 12;

/** `closed`: the board; `pin`: the PIN pad; `editor`: unlocked, the editor screen. */
export type ParentStage = "closed" | "pin" | "editor";

/** An unlocked session, in memory only (never in storage). */
export interface ParentSession {
  /** Value for the `X-KidBoard-Parent` header. */
  token: string;
  /** When the gate locks itself, epoch ms on the device clock. */
  lockAt: number;
}

/** Why an unlock did not open the editor, for the PIN pad's message. */
export type UnlockFailure =
  /** 401: the tablet's access token is wrong or revoked. */
  | "unauthorized"
  /** 404: the editor is switched off on the worker. */
  | "unavailable"
  /** Network, timeout, server error or an unexpected answer: try again. */
  | "failed";

export type UnlockOutcome =
  | { kind: "unlocked" }
  | { kind: "wrong-pin"; attemptsLeft: number }
  /** `until`: end of the lockout, epoch ms on the device clock. */
  | { kind: "lockout"; until: number }
  | { kind: "error"; error: UnlockFailure }
  /** The gate was locked (idle, tab hidden, cancel) while the request ran. */
  | { kind: "cancelled" };

export interface ParentGate {
  stage: ParentStage;
  /** The unlocked session while `stage` is `editor`, else `null`. */
  session: ParentSession | null;
  /** End of a lockout reported by the worker (epoch ms), or `null`. */
  lockoutUntil: number | null;
  /**
   * The gate is open and idle for {@link PARENT_IDLE_WARNING_MS} less than the idle
   * lock: the "locking soon" warning shows.
   */
  idleWarning: boolean;
  /** Real seconds until the idle lock while {@link idleWarning} shows, else 0. */
  idleSecondsLeft: number;
  /** Counts as input: restarts the idle time and hides the warning. */
  stayActive: () => void;
  /** Shows the PIN pad (after the hold on the entry). */
  openPin: () => void;
  /** Sends the PIN; on success the editor opens. */
  unlock: (pin: string) => Promise<UnlockOutcome>;
  /** Drops the session and returns to the board (auto-lock: focus is not moved). */
  lock: () => void;
  /**
   * User-initiated {@link lock} ("Done", Cancel, Escape): also returns keyboard focus to
   * the parent entry once the board is interactive again (WCAG 2.4.3).
   */
  close: () => void;
  /** The parent entry button, so focus can return to it; set by `ParentEntry`. */
  entryRef: RefObject<HTMLButtonElement | null>;
}

export const ParentGateContext = createContext<ParentGate | null>(null);

/** The parent gate; throws outside `ParentGateProvider` (programming error). */
export function useParentGate(): ParentGate {
  const gate = useContext(ParentGateContext);
  if (gate === null) {
    throw new Error("useParentGate must be used inside <ParentGateProvider>");
  }
  return gate;
}

/**
 * Whether the PIN pad or the editor is open. Without a `ParentGateProvider` there is no
 * gate, so nothing can be open: `false`.
 */
export function useParentGateOpen(): boolean {
  return (useContext(ParentGateContext)?.stage ?? "closed") !== "closed";
}

/**
 * Locks an open gate as soon as the editor is not available (`config.editor` turned
 * false, or the config is gone after a 401 wipe). No-op without a provider.
 */
export function useLockWhenEditorOff(editor: boolean): void {
  const gate = useContext(ParentGateContext);
  const open = (gate?.stage ?? "closed") !== "closed";
  const lock = gate?.lock;
  useEffect(() => {
    if (!editor && open) lock?.();
  }, [editor, open, lock]);
}

/**
 * Device-clock time at which a session received at `receivedAt` locks. The worker's
 * `expiresAt` is on the server clock; when it is not plausible on this device's clock
 * (in the past or more than the 15-minute session ahead, i.e. the clocks differ), the
 * known session length counted from receipt is used instead.
 */
export function sessionLockAt(receivedAt: number, expiresAt: number): number {
  const ttl = expiresAt - receivedAt;
  return (
    receivedAt +
    (ttl > 0 && ttl <= PARENT_SESSION_TTL_MS ? ttl : PARENT_SESSION_TTL_MS)
  );
}

/**
 * Lets a PIN pad that opens inside the editor (re-lock) tell the editor screen to drop
 * its own "locking soon" banner: only the pad's banner shows, placed so it covers none
 * of the pad's buttons. `register` returns the cleanup.
 */
export const PadHostContext = createContext<(() => () => void) | null>(null);

/** Registers the calling PIN pad with the editor screen above it (no-op outside one). */
export function useRegisterPad(): void {
  const register = useContext(PadHostContext);
  useEffect(() => register?.(), [register]);
}
