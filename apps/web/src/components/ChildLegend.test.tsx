import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import en from "../i18n/locales/en.json";
import { ChildLegend } from "./ChildLegend";
import { BEN, MIA } from "./fixtures.test-utils";

describe("ChildLegend", () => {
  it("lists every child with avatar and name", () => {
    render(<ChildLegend childList={[MIA, BEN]} />);
    const list = screen.getByRole("list", { name: en.legend.label });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Mia");
    expect(
      within(items[1] as HTMLElement).queryByRole("img"),
    ).not.toBeInTheDocument();
    expect(within(items[1] as HTMLElement).getByText("🐻")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    // As high as the countdown pill (h-16, 48px sign); not a touch target, it is not
    // interactive.
    expect(items[0]).toHaveClass("h-16");
    expect(items[0]?.querySelector(".size-12")).not.toBeNull();
    expect(items[0]?.querySelector("button")).toBeNull();
  });

  it("renders nothing without children", () => {
    const { container } = render(<ChildLegend childList={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a hostile name as text", () => {
    const { container } = render(
      <ChildLegend childList={[{ ...MIA, name: "<b>Mia</b>" }]} />,
    );
    expect(screen.getByText("<b>Mia</b>")).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
  });
});
