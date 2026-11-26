import { env as testEnv } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { editorEnabled, parentPinStatus } from "./pin";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parentPinStatus", () => {
  it.each([
    [undefined, "unset"],
    ["", "unset"],
    ["246813", "valid"],
    ["000000000000", "trivial"], // one repeated digit
    ["111111", "trivial"],
    ["123456", "trivial"], // rising run
    ["23456789", "trivial"],
    ["987654", "trivial"], // falling run
    ["543210", "trivial"],
    ["123457", "valid"],
    ["121212", "valid"],
    ["12345", "invalid"], // too short
    ["1234567890123", "invalid"], // too long
    ["12345a", "invalid"],
    [" 123456", "invalid"], // no trimming
    ["123456\n", "invalid"],
    ["١٢٣٤٥٦", "invalid"], // non-ASCII digits
    ["REPLACE_ME", "invalid"], // template value
    ["replace_me", "invalid"],
  ] as const)("%j → %s", (raw, expected) => {
    expect(parentPinStatus(raw)).toBe(expected);
  });
});

const ACCESS = "TESTONLY-access-token-not-a-secret-0123456789";

describe("editorEnabled", () => {
  it("needs the D1 binding, a valid PIN and an access token", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const db = testEnv.KIDBOARD_DATA;
    const on = {
      KIDBOARD_DATA: db,
      KIDBOARD_PARENT_PIN: "246813",
      KIDBOARD_ACCESS_TOKEN: ACCESS,
    };
    expect(editorEnabled(on)).toBe(true);
    expect(
      editorEnabled({ KIDBOARD_DATA: db, KIDBOARD_ACCESS_TOKEN: ACCESS }),
    ).toBe(false);
    expect(editorEnabled({ ...on, KIDBOARD_PARENT_PIN: "REPLACE_ME" })).toBe(
      false,
    );
    expect(editorEnabled({ ...on, KIDBOARD_PARENT_PIN: "1234" })).toBe(false);
    expect(editorEnabled({ ...on, KIDBOARD_PARENT_PIN: "123456" })).toBe(false);
    expect(
      editorEnabled({
        KIDBOARD_PARENT_PIN: "246813",
        KIDBOARD_ACCESS_TOKEN: ACCESS,
      }),
    ).toBe(false);
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["the template value", "REPLACE_ME-with-a-long-random-token"],
    ["too short", "TESTONLY-short"],
  ])("stays off (fail closed) with the access token %s", (_, token) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const env = {
      KIDBOARD_DATA: testEnv.KIDBOARD_DATA,
      KIDBOARD_PARENT_PIN: "246813",
      ...(token === undefined ? {} : { KIDBOARD_ACCESS_TOKEN: token }),
    };
    expect(editorEnabled(env)).toBe(false);
  });

  it("warns about a misconfiguration without logging the PIN", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    editorEnabled({ KIDBOARD_PARENT_PIN: "98765" });
    editorEnabled({ KIDBOARD_PARENT_PIN: "98765" });
    editorEnabled({ KIDBOARD_PARENT_PIN: "654321" });
    editorEnabled({ KIDBOARD_PARENT_PIN: "975318642" });
    editorEnabled({
      KIDBOARD_PARENT_PIN: "975318642",
      KIDBOARD_DATA: testEnv.KIDBOARD_DATA,
    });
    const lines = warn.mock.calls.map((args) => args.join(" "));
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("KIDBOARD_PARENT_PIN must be 6 to 12 digits");
    expect(lines[1]).toContain("KIDBOARD_PARENT_PIN is too easy to guess");
    expect(lines[2]).toContain("KIDBOARD_DATA is missing");
    expect(lines[3]).toContain(
      "KIDBOARD_ACCESS_TOKEN is not a valid token (32 to 256 characters",
    );
    expect(lines.join("\n")).not.toMatch(/98765|975318642|654321/);
  });
});
