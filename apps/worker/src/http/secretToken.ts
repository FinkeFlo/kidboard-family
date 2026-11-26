/**
 * Marker of the template value in `.dev.vars.example`. "Deploy to Cloudflare" offers that
 * file's values as defaults, so a secret still containing it is publicly known and is
 * never accepted.
 */
export const PLACEHOLDER_TOKEN_MARKER = "REPLACE_ME";

/** Shortest accepted secret token (e.g. `openssl rand -hex 32` gives 64 characters). */
export const SECRET_TOKEN_MIN_LENGTH = 32;
/** Longest accepted secret token (keeps URLs short for calendar apps). */
export const SECRET_TOKEN_MAX_LENGTH = 256;

/**
 * Hex and base64url characters only: a token travels as a query value, so it must
 * survive calendar apps and copy/paste without any percent-encoding.
 */
const SECRET_TOKEN_RE = /^[A-Za-z0-9_-]+$/;

export type SecretTokenStatus = "unset" | "invalid" | "valid";

/**
 * Classifies a secret token (`KIDBOARD_ACCESS_TOKEN`, `KIDBOARD_FEED_TOKEN`). Unset or
 * empty → `unset`; shorter than {@link SECRET_TOKEN_MIN_LENGTH}, longer than
 * {@link SECRET_TOKEN_MAX_LENGTH}, other characters than `A-Z a-z 0-9 _ -`, or still
 * containing the template marker → `invalid` (fail closed). Taken as is, no trimming.
 */
export function secretTokenStatus(raw: string | undefined): SecretTokenStatus {
  if (raw === undefined || raw === "") {
    return "unset";
  }
  if (raw.toUpperCase().includes(PLACEHOLDER_TOKEN_MARKER)) {
    return "invalid";
  }
  return raw.length >= SECRET_TOKEN_MIN_LENGTH &&
    raw.length <= SECRET_TOKEN_MAX_LENGTH &&
    SECRET_TOKEN_RE.test(raw)
    ? "valid"
    : "invalid";
}
