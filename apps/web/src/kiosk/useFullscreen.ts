import { useCallback, useSyncExternalStore } from "react";

export interface Fullscreen {
  /** The control makes sense: API supported and not already an installed/fullscreen app. */
  available: boolean;
  /** The page is currently in fullscreen. */
  active: boolean;
  /** Enters or leaves fullscreen; never rejects. */
  toggle: () => Promise<void>;
}

const DISPLAY_MODES = ["standalone", "fullscreen"] as const;

/** `matchMedia` is missing in some test/embedded environments; then no mode matches. */
function matchMode(
  mode: (typeof DISPLAY_MODES)[number],
): MediaQueryList | undefined {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(`(display-mode: ${mode})`)
    : undefined;
}

function subscribe(onChange: () => void): () => void {
  document.addEventListener("fullscreenchange", onChange);
  // Installed-app display modes can change at runtime (e.g. window mode switch).
  const queries = DISPLAY_MODES.map((mode) => matchMode(mode));
  for (const query of queries) query?.addEventListener("change", onChange);
  return () => {
    document.removeEventListener("fullscreenchange", onChange);
    for (const query of queries) query?.removeEventListener("change", onChange);
  };
}

/** Whole-state snapshot as a string: `unsupported | hidden | idle | active`. */
function getSnapshot(): "unsupported" | "hidden" | "idle" | "active" {
  const element = document.documentElement;
  if (
    !document.fullscreenEnabled ||
    typeof (element as { requestFullscreen?: unknown }).requestFullscreen !==
      "function"
  ) {
    return "unsupported";
  }
  if (document.fullscreenElement !== null) return "active";
  // Already launched as an installed app (manifest `display: fullscreen`) or as a
  // standalone window: nothing for a parent to switch. While fullscreen was entered
  // through the control the display-mode also reads `fullscreen`, hence the check above.
  const installed = DISPLAY_MODES.some(
    (mode) => matchMode(mode)?.matches === true,
  );
  return installed ? "hidden" : "idle";
}

/**
 * Fullscreen API state and toggle for the whole document. `available` is false where
 * fullscreen is unsupported or the board already runs as an installed app.
 */
export function useFullscreen(): Fullscreen {
  const state = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => "unsupported",
  );
  const active = state === "active";
  const toggle = useCallback(async (): Promise<void> => {
    try {
      if (document.fullscreenElement !== null) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Refused (no user activation, policy): the board keeps working as it is.
    }
  }, []);
  return {
    available: state === "idle" || state === "active",
    active,
    toggle,
  };
}
