import { describe, expect, it } from "vitest";

import { errorCode, type ErrorCodeCause } from "./errorCode";

const CAUSES: ErrorCodeCause[] = [
  "network",
  "timeout",
  "unauthorized",
  "bad-request",
  "upstream",
  "server",
  "http",
  "invalid-response",
  "offline",
  "render",
  "unknown",
];

describe("errorCode", () => {
  it("names HTTP failures by their status", () => {
    expect(errorCode("upstream")).toBe("KB-502");
    expect(errorCode("server")).toBe("KB-500");
    expect(errorCode("unauthorized")).toBe("KB-401");
    expect(errorCode("bad-request")).toBe("KB-400");
  });

  it("falls back to a generic load code without a known cause", () => {
    expect(errorCode(undefined)).toBe("KB-LOAD");
    expect(errorCode("unknown")).toBe("KB-LOAD");
  });

  it("gives every cause its own short code", () => {
    const codes = CAUSES.map(errorCode);
    expect(new Set(codes).size).toBe(CAUSES.length);
    for (const code of codes) {
      expect(code).toMatch(/^KB-[A-Z0-9]{2,4}$/);
    }
  });
});
