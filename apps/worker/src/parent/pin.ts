import type { Env } from "../env";
import { secretTokenStatus } from "../http/secretToken";
import { logWarn } from "../log";

/** ADR-0013: the parent PIN is 6 to 12 ASCII digits. */
const PIN_RE = /^[0-9]{6,12}$/;

export type ParentPinStatus = "unset" | "invalid" | "trivial" | "valid";

/**
 * A PIN made of one repeated digit (`000000`) or a run that rises or falls by one per
 * digit (`123456`, `987654`) is guessed first by anyone, so it is refused.
 */
function isTrivialPin(pin: string): boolean {
  const step = pin.charCodeAt(1) - pin.charCodeAt(0);
  if (Math.abs(step) > 1) {
    return false;
  }
  for (let i = 2; i < pin.length; i += 1) {
    if (pin.charCodeAt(i) - pin.charCodeAt(i - 1) !== step) {
      return false;
    }
  }
  return true;
}

/**
 * Classifies `KIDBOARD_PARENT_PIN` (ADR-0013). Unset or empty → `unset`; anything other
 * than 6-12 ASCII digits (so also the `.dev.vars.example` template value) → `invalid`;
 * a repeated digit or a rising/falling run → `trivial` (both fail closed). The value is
 * taken as is (no trimming), exactly as it will be compared.
 */
export function parentPinStatus(raw: string | undefined): ParentPinStatus {
  if (raw === undefined || raw === "") {
    return "unset";
  }
  if (!PIN_RE.test(raw)) {
    return "invalid";
  }
  return isTrivialPin(raw) ? "trivial" : "valid";
}

/** Last logged misconfiguration, so each one is logged once per isolate. */
let warnedAbout: string | undefined;

function warnOnce(key: string, message: string): void {
  if (warnedAbout !== key) {
    warnedAbout = key;
    logWarn(message);
  }
}

/**
 * Whether the parent editor (and with it the app sources on the board and the phone
 * feed) is available (ADR-0013, ADR-0014): only with the D1 binding `KIDBOARD_DATA`, a
 * valid `KIDBOARD_PARENT_PIN` and a valid access token `KIDBOARD_ACCESS_TOKEN` (fail closed:
 * without the token anyone who finds the URL could try PINs and the lockout would
 * lock the parents out). A set but unusable PIN, or a valid PIN without the binding or
 * the token, logs a configuration warning (never the PIN or the token). The read-only
 * board does not depend on this.
 */
export function editorEnabled(
  env: Pick<
    Env,
    "KIDBOARD_DATA" | "KIDBOARD_PARENT_PIN" | "KIDBOARD_ACCESS_TOKEN"
  >,
): boolean {
  const status = parentPinStatus(env.KIDBOARD_PARENT_PIN);
  if (status === "invalid") {
    warnOnce(
      "invalid-pin",
      "KIDBOARD_PARENT_PIN must be 6 to 12 digits (not the template value); the editor stays off",
    );
    return false;
  }
  if (status === "trivial") {
    warnOnce(
      "trivial-pin",
      "KIDBOARD_PARENT_PIN is too easy to guess (one repeated digit or a run like 123456); choose another PIN, the editor stays off",
    );
    return false;
  }
  if (status === "unset") {
    return false;
  }
  if (env.KIDBOARD_DATA === undefined) {
    warnOnce(
      "missing-d1",
      "KIDBOARD_PARENT_PIN is set but the D1 binding KIDBOARD_DATA is missing; the editor stays off",
    );
    return false;
  }
  if (secretTokenStatus(env.KIDBOARD_ACCESS_TOKEN) !== "valid") {
    warnOnce(
      "missing-access-token",
      "KIDBOARD_PARENT_PIN is set but KIDBOARD_ACCESS_TOKEN is not a valid token (32 to 256 characters of A-Z, a-z, 0-9, _ or -); the editor and the phone feed stay off",
    );
    return false;
  }
  return true;
}
