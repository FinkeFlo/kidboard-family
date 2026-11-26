import { describe, expect, it } from "vitest";

import { ApiError, EditorApiError } from "../data";
import { toFailure } from "./failure";

function editorError(
  status: number,
  body: Record<string, unknown>,
): EditorApiError {
  return new EditorApiError("/api/parent/entries", status, {
    error: String(body["error"]),
    message: "",
    ...body,
  });
}

describe("toFailure (calm KB-* codes)", () => {
  it.each([
    [editorError(403, { error: "parent_locked" }), "locked", "KB-LOCK"],
    [
      editorError(409, { error: "conflict", revision: 4 }),
      "conflict",
      "KB-409",
    ],
    [
      editorError(422, { error: "limit_reached", limit: "entries" }),
      "limitEntries",
      "KB-LIMIT",
    ],
    [
      editorError(422, { error: "limit_reached", limit: "size" }),
      "limitSize",
      "KB-SIZE",
    ],
    [editorError(404, { error: "not_found" }), "notFound", "KB-404"],
    [editorError(503, { error: "storage_unavailable" }), "storage", "KB-503"],
    [editorError(413, { error: "payload_too_large" }), "tooLarge", "KB-413"],
    [editorError(500, { error: "server_misconfigured" }), "failed", "KB-500"],
    [editorError(418, { error: "teapot" }), "failed", "KB-HTTP"],
    [new ApiError("network", "/api/parent/entries"), "offline", "KB-NET"],
    [new ApiError("timeout", "/api/parent/entries"), "timeout", "KB-TIME"],
    [
      new ApiError("unauthorized", "/api/parent/entries", 401),
      "unauthorized",
      "KB-401",
    ],
    [
      new ApiError("invalid-response", "/api/parent/entries", 200),
      "failed",
      "KB-DATA",
    ],
    [new Error("boom"), "failed", "KB-LOAD"],
  ] as const)("%s → %s (%s)", (error, kind, code) => {
    expect(toFailure(error)).toMatchObject({ kind, code });
  });

  it("keeps the field paths of an invalid entry", () => {
    const failure = toFailure(
      editorError(422, {
        error: "invalid_entry",
        issues: [
          { code: "unknown_child", path: "childIds.0", message: "x" },
          { code: "invalid", path: "title", message: "y" },
        ],
      }),
    );
    expect(failure).toEqual({
      kind: "invalid",
      code: "KB-422",
      issues: [
        { code: "unknown_child", path: "childIds.0" },
        { code: "invalid", path: "title" },
      ],
    });
  });
});
