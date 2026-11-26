import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Emoji } from "./Emoji";

describe("Emoji", () => {
  it("is an image named by its label", () => {
    render(<Emoji emoji="🏊" label="Swimming" />);
    const img = screen.getByRole("img", { name: "Swimming" });
    expect(img).toHaveTextContent("🏊");
    expect(img).toHaveClass("font-emoji");
  });

  it.each([undefined, "", "  "])(
    "is decorative (hidden) without a usable label: %j",
    (label) => {
      render(<Emoji emoji="🏊" label={label} />);
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(screen.getByText("🏊")).toHaveAttribute("aria-hidden", "true");
    },
  );

  it("dims itself at night, in the component and not in the callers", () => {
    render(<Emoji emoji="🏊" className="text-title grayscale" />);
    const emoji = screen.getByText("🏊");
    // `night:` = under <html data-theme="night">; filter utilities compose, so the
    // caller's grayscale (past events) still applies.
    expect(emoji).toHaveClass(
      "night:brightness-75",
      "night:saturate-80",
      "grayscale",
      "leading-none",
    );
  });
});
