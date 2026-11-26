import { describe, expect, it } from "vitest";

import {
  SECRET_TOKEN_MAX_LENGTH,
  SECRET_TOKEN_MIN_LENGTH,
  secretTokenStatus,
} from "./secretToken";

const VALID = "TESTONLY-secret-token-not-a-secret-0123456789";

describe("secretTokenStatus", () => {
  it.each<[string | undefined, string]>([
    [undefined, "unset"],
    ["", "unset"],
    [VALID, "valid"],
    ["a".repeat(SECRET_TOKEN_MIN_LENGTH), "valid"],
    ["a".repeat(SECRET_TOKEN_MIN_LENGTH - 1), "invalid"],
    ["a".repeat(SECRET_TOKEN_MAX_LENGTH), "valid"],
    ["a".repeat(SECRET_TOKEN_MAX_LENGTH + 1), "invalid"],
    // The `.dev.vars.example` template, also padded to a valid length, any case.
    ["REPLACE_ME", "invalid"],
    [`REPLACE_ME-${"a".repeat(40)}`, "invalid"],
    [`${"a".repeat(40)}replace_me`, "invalid"],
    // Characters that would need percent-encoding in a path segment.
    [`${"a".repeat(40)}/b`, "invalid"],
    [`${"a".repeat(40)}.ics`, "invalid"],
    [`${"a".repeat(40)} `, "invalid"],
    [`${"a".repeat(40)}%2F`, "invalid"],
    [`${"a".repeat(40)}ä`, "invalid"],
  ])("%j → %s", (raw, expected) => {
    expect(secretTokenStatus(raw)).toBe(expected);
  });
});
