import { describe, expect, it } from "vitest";

import { childColorStyle, resolveChildColor } from "./childColor";

describe("resolveChildColor", () => {
  it.each([
    ["child-1", "var(--color-child-1)"],
    ["child-6", "var(--color-child-6)"],
    [" child-3 ", "var(--color-child-3)"],
    ["#e4572e", "#e4572e"],
    ["#abc", "#abc"],
    ["#E4572E", "#E4572E"],
  ])("accepts %s", (input, expected) => {
    expect(resolveChildColor(input)).toBe(expected);
  });

  it.each([
    "child-7",
    "",
    "#12",
    "red; background: url(x)",
    "url(https://example.invalid/x)",
    "rgb(var(--x))",
    "red}</style><script>",
    "calc(1px)",
    "inherit",
    "initial",
    "unset",
    "currentcolor",
    "transparent",
    "notacolor",
    "tomato",
    "rgb(10, 20, 30)",
    "#12345678",
    "#abcd",
    "#ggg",
  ])("falls back to the neutral colour for %j", (input) => {
    expect(resolveChildColor(input)).toBe("var(--color-border)");
  });

  it("falls back for undefined and exposes a custom property", () => {
    expect(resolveChildColor(undefined)).toBe("var(--color-border)");
    expect(childColorStyle("child-2")).toEqual({
      "--child-color": "var(--color-child-2)",
    });
  });
});
