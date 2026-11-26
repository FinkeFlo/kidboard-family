import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ApiError } from "../data";
import { useApiClient } from "../data/apiContext";
import {
  PARENT_IDLE_LOCK_MS,
  PARENT_IDLE_WARNING_MS,
  PARENT_LOCK_CHECK_MS,
  type ParentGate,
  ParentGateContext,
  type ParentSession,
  type ParentStage,
  sessionLockAt,
  type UnlockOutcome,
} from "./parentGate";

/** Input that counts as "a parent is still using the editor". */
const ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "touchstart",
  "keydown",
] as const;

type GateState =
  | { stage: Exclude<ParentStage, "editor"> }
  | { stage: "editor"; session: ParentSession };

/**
 * Auto-lock while the gate is open (ADR-0013): after {@link PARENT_IDLE_LOCK_MS} without
 * pointer, touch or key input, at the session's `lockAt`, and as soon as the tab is
 * hidden. Idle time and expiry are compared with `Date.now()` on a short tick instead of
 * one long timer, so a tablet whose timers were suspended (screen off) still locks at
 * once when it wakes up. From {@link PARENT_IDLE_WARNING_MS} before the idle lock,
 * `warn(secondsLeft)` shows the "locking soon" warning with the real seconds left;
 * any input (or `stayActive`) hides it (`warn(null)`).
 */
function useAutoLock(
  open: boolean,
  lockAt: number | undefined,
  lock: () => void,
  warn: (secondsLeft: number | null) => void,
): { stayActive: () => void } {
  const lastActivity = useRef(0);
  const stayActive = useCallback(() => {
    lastActivity.current = Date.now();
    warn(null);
  }, [warn]);
  useEffect(() => {
    if (!open) return undefined;
    lastActivity.current = Date.now();
    const touch = stayActive;
    const check = (): void => {
      const now = Date.now();
      const idle = now - lastActivity.current;
      if (
        idle >= PARENT_IDLE_LOCK_MS ||
        (lockAt !== undefined && now >= lockAt)
      ) {
        lock();
        return;
      }
      warn(
        idle >= PARENT_IDLE_LOCK_MS - PARENT_IDLE_WARNING_MS
          ? Math.max(1, Math.ceil((PARENT_IDLE_LOCK_MS - idle) / 1000))
          : null,
      );
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") {
        lock();
      } else {
        check();
      }
    };
    for (const name of ACTIVITY_EVENTS) {
      document.addEventListener(name, touch, { capture: true, passive: true });
    }
    document.addEventListener("visibilitychange", onVisibility);
    const timer = setInterval(check, PARENT_LOCK_CHECK_MS);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const name of ACTIVITY_EVENTS) {
        document.removeEventListener(name, touch, { capture: true });
      }
    };
  }, [open, lockAt, lock, warn, stayActive]);
  return { stayActive };
}

/**
 * Parent lock state (ADR-0013): board → PIN pad → editor. The session token lives only
 * in this component's state (never in storage) and is dropped on every lock. Unlock
 * calls go through the app's {@link ApiClient} (same access token as the board) but are
 * no TanStack queries, so a 403 or 429 never wipes the board's data or token.
 */
export function ParentGateProvider({
  children,
}: {
  children?: ReactNode;
}): React.JSX.Element {
  const api = useApiClient();
  const [state, setState] = useState<GateState>({ stage: "closed" });
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  // Seconds until the idle lock while the warning shows, else `null`.
  const [idleSecondsLeft, setIdleSecondsLeft] = useState<number | null>(null);
  // Mirrors `idleSecondsLeft`, so frequent input (pointermove) re-renders nothing.
  const idleShown = useRef<number | null>(null);
  const warn = useCallback((secondsLeft: number | null) => {
    if (idleShown.current === secondsLeft) return;
    idleShown.current = secondsLeft;
    setIdleSecondsLeft(secondsLeft);
  }, []);
  // Bumped on every lock: an unlock answer that arrives later is discarded.
  const generation = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  const lock = useCallback(() => {
    generation.current += 1;
    inFlight.current?.abort();
    inFlight.current = null;
    warn(null);
    setState({ stage: "closed" });
  }, [warn]);

  const entryRef = useRef<HTMLButtonElement | null>(null);
  // Set by `close`: move focus to the entry after the board is no longer inert.
  const focusEntry = useRef(false);
  const close = useCallback(() => {
    focusEntry.current = true;
    lock();
  }, [lock]);
  useEffect(() => {
    if (state.stage !== "closed") {
      focusEntry.current = false;
      return;
    }
    if (!focusEntry.current) return;
    focusEntry.current = false;
    // Runs after the commit that removed `inert`; a missing entry is fine (no-op).
    entryRef.current?.focus();
  }, [state.stage]);

  const openPin = useCallback(() => {
    setState((current) =>
      current.stage === "closed" ? { stage: "pin" } : current,
    );
  }, []);

  const unlock = useCallback(
    async (pin: string): Promise<UnlockOutcome> => {
      const started = generation.current;
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      try {
        const result = await api.unlockParent(pin, controller.signal);
        if (generation.current !== started || controller.signal.aborted) {
          return { kind: "cancelled" };
        }
        switch (result.kind) {
          case "unlocked": {
            const session: ParentSession = {
              token: result.token,
              lockAt: sessionLockAt(Date.now(), result.expiresAt),
            };
            setLockoutUntil(null);
            setState({ stage: "editor", session });
            return { kind: "unlocked" };
          }
          case "wrong-pin":
            return { kind: "wrong-pin", attemptsLeft: result.attemptsLeft };
          case "lockout":
            break;
        }
        const until = Date.now() + result.retryAfterSeconds * 1000;
        setLockoutUntil(until);
        return { kind: "lockout", until };
      } catch (error) {
        if (generation.current !== started || controller.signal.aborted) {
          return { kind: "cancelled" };
        }
        if (error instanceof ApiError && error.kind === "unauthorized") {
          return { kind: "error", error: "unauthorized" };
        }
        if (error instanceof ApiError && error.status === 404) {
          return { kind: "error", error: "unavailable" };
        }
        return { kind: "error", error: "failed" };
      } finally {
        if (inFlight.current === controller) inFlight.current = null;
      }
    },
    [api],
  );

  // Abort a pending unlock when the provider goes away.
  useEffect(
    () => () => {
      inFlight.current?.abort();
    },
    [],
  );

  const session = state.stage === "editor" ? state.session : null;
  const { stayActive } = useAutoLock(
    state.stage !== "closed",
    session?.lockAt,
    lock,
    warn,
  );

  const value = useMemo<ParentGate>(
    () => ({
      stage: state.stage,
      session,
      lockoutUntil,
      idleWarning: state.stage !== "closed" && idleSecondsLeft !== null,
      idleSecondsLeft:
        state.stage !== "closed" && idleSecondsLeft !== null
          ? idleSecondsLeft
          : 0,
      stayActive,
      openPin,
      unlock,
      lock,
      close,
      entryRef,
    }),
    [
      state.stage,
      session,
      lockoutUntil,
      idleSecondsLeft,
      stayActive,
      openPin,
      unlock,
      lock,
      close,
    ],
  );
  return <ParentGateContext value={value}>{children}</ParentGateContext>;
}
