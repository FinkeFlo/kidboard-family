import { errorCode } from "../components/errorCode";
import { ApiError, EditorApiError } from "../data";

/** What went wrong with an editor request, as far as the parent needs to know. */
export type EditorFailureKind =
  | "offline"
  | "timeout"
  | "unauthorized"
  | "locked"
  | "conflict"
  /** A conflict while deleting: the list was refreshed, delete again if still wanted. */
  | "conflictDelete"
  | "limitEntries"
  | "limitSize"
  | "invalid"
  | "notFound"
  | "storage"
  | "tooLarge"
  | "failed";

export interface EditorFailure {
  kind: EditorFailureKind;
  /** Short code in the `KB-*` style of the board (identifiers, not words). */
  code: string;
  /** Field paths of an `invalid_entry` answer (for the form's field marks). */
  issues: { code: string; path: string }[];
}

/*
 * Codes of the editor's failures. Transport problems use the board's codes
 * (`errorCode`); the parent API's own answers get theirs.
 */
const EDITOR_CODES: Partial<Record<EditorFailureKind, string>> = {
  locked: "KB-LOCK",
  conflict: "KB-409",
  conflictDelete: "KB-409",
  limitEntries: "KB-LIMIT",
  limitSize: "KB-SIZE",
  invalid: "KB-422",
  notFound: "KB-404",
  storage: "KB-503",
  tooLarge: "KB-413",
};

function failure(
  kind: EditorFailureKind,
  code: string,
  issues: EditorFailure["issues"] = [],
): EditorFailure {
  return { kind, code: EDITOR_CODES[kind] ?? code, issues };
}

/** Classifies any error of an editor request (never shows its message). */
export function toFailure(error: unknown): EditorFailure {
  if (error instanceof EditorApiError) {
    switch (error.code) {
      case "parent_locked":
        return failure("locked", "");
      case "conflict":
        return failure("conflict", "");
      case "limit_reached":
        return failure(
          error.limit === "size" ? "limitSize" : "limitEntries",
          "",
        );
      case "invalid_entry":
      case "bad_request":
        return failure(
          "invalid",
          "",
          error.issues.map(({ code, path }) => ({ code, path })),
        );
      case "not_found":
        return failure("notFound", "");
      case "storage_unavailable":
        return failure("storage", "");
      case "payload_too_large":
        return failure("tooLarge", "");
      default:
        return failure(
          "failed",
          errorCode(error.status >= 500 ? "server" : "http"),
        );
    }
  }
  if (error instanceof ApiError) {
    switch (error.kind) {
      case "network":
        return failure("offline", errorCode("network"));
      case "timeout":
        return failure("timeout", errorCode("timeout"));
      case "unauthorized":
        return failure("unauthorized", errorCode("unauthorized"));
      default:
        return failure("failed", errorCode(error.kind));
    }
  }
  return failure("failed", errorCode(undefined));
}

/** The list's notice when the app entries could not be read (`storageUnavailable`). */
export const STORAGE_FAILURE: EditorFailure = {
  kind: "storage",
  code: "KB-503",
  issues: [],
};
