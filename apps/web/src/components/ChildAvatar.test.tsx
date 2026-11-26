import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChildAvatar } from "./ChildAvatar";
import { MIA } from "./fixtures.test-utils";

describe("ChildAvatar", () => {
  it("is named by the child by default", () => {
    render(<ChildAvatar child={MIA} />);
    expect(screen.getByRole("img", { name: "Mia" })).toHaveTextContent("🦊");
  });

  it("is hidden from assistive tech when decorative", () => {
    render(<ChildAvatar child={MIA} decorative />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
