import type { Env } from "../env";
import {
  SECRET_TOKEN_MAX_LENGTH,
  SECRET_TOKEN_MIN_LENGTH,
  secretTokenStatus,
} from "../http/secretToken";
import { logWarn } from "../log";

/** Whether the invalid-token warning was logged in this isolate. */
let warned = false;

/**
 * The feed token when the feed is configured, else `undefined`. An unusable value logs
 * one warning per isolate (never the value).
 */
export function configuredFeedToken(
  env: Pick<Env, "KIDBOARD_FEED_TOKEN">,
): string | undefined {
  const raw = env.KIDBOARD_FEED_TOKEN;
  const status = secretTokenStatus(raw);
  if (status === "invalid" && !warned) {
    warned = true;
    logWarn(
      `KIDBOARD_FEED_TOKEN must be ${String(SECRET_TOKEN_MIN_LENGTH)} to ${String(SECRET_TOKEN_MAX_LENGTH)} characters of A-Z, a-z, 0-9, _ or - (not the template value); the phone feed stays off`,
    );
  }
  return status === "valid" ? raw : undefined;
}

/** Test hook: lets the next invalid token log its warning again. */
export function resetFeedTokenWarning(): void {
  warned = false;
}
