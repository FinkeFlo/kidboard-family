import type { ApiErrorKind } from "../data";

/** What went wrong, as far as the error card needs to tell a parent. */
export type ErrorCodeCause = ApiErrorKind | "offline" | "render" | "unknown";

/*
 * Short, stable codes for parents and bug reports ("KB-502"). They are identifiers, not
 * words, so they are the same in every language and not part of the locale files; the
 * sentence around them is ("Error code for parents: {{code}}"). They never carry an
 * error message, URL or response body.
 */
const CODES: Record<ErrorCodeCause, string> = {
  network: "KB-NET",
  timeout: "KB-TIME",
  unauthorized: "KB-401",
  "bad-request": "KB-400",
  upstream: "KB-502",
  server: "KB-500",
  http: "KB-HTTP",
  "invalid-response": "KB-DATA",
  offline: "KB-OFF",
  render: "KB-UI",
  unknown: "KB-LOAD",
};

/** Short error code for `cause` (`undefined`: a failure without a known kind). */
export function errorCode(cause: ErrorCodeCause | undefined): string {
  return CODES[cause ?? "unknown"];
}
