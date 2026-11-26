import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { applyLocale } from "../i18n";
import { ViewToggle } from "./ViewToggle";

describe("ViewToggle", () => {
  it("shows a sun with 'Today' and seven bars with 'Week'; the word is the name", () => {
    render(<ViewToggle view="day" onChange={vi.fn()} />);
    const day = screen.getByRole("button", { name: "Today" });
    const week = screen.getByRole("button", { name: "Week" });
    expect(within(day).getByText("☀️")).toHaveAttribute("aria-hidden", "true");
    expect(within(week).getByTestId("week-bars")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(day).toHaveAttribute("aria-pressed", "true");
    expect(week).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("group", { name: "View" })).toBeInTheDocument();
  });

  it("has German names", () => {
    applyLocale("de");
    render(<ViewToggle view="week" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Woche" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Heute" })).toBeInTheDocument();
    applyLocale("en");
  });

  it("reports the chosen view", () => {
    const onChange = vi.fn();
    render(<ViewToggle view="day" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(onChange).toHaveBeenCalledWith("week");
  });

  it("keeps the sun on 'Today' (no moon at night) and marks the active one by fill, not colour alone", () => {
    render(<ViewToggle view="week" onChange={vi.fn()} />);
    const day = screen.getByRole("button", { name: "Today" });
    const week = screen.getByRole("button", { name: "Week" });
    expect(day).not.toHaveTextContent("🌙");
    expect(week).toHaveClass("bg-nav-active", "text-on-nav-active");
    expect(day).toHaveClass("bg-surface-raised", "inset-ring-3");
  });

  it("puts the active button's sun on a dark disc at night, so it stays visible on the light fill", () => {
    const { rerender } = render(<ViewToggle view="day" onChange={vi.fn()} />);
    const sun = (): HTMLElement =>
      within(screen.getByRole("button", { name: "Today" })).getByTestId(
        "today-sun",
      );
    expect(sun()).toHaveClass("night:bg-surface", "rounded-pill");
    expect(sun()).toContainElement(screen.getByText("☀️"));
    // Inactive: no disc (the button itself is dark at night).
    rerender(<ViewToggle view="week" onChange={vi.fn()} />);
    expect(sun().className).not.toContain("bg-");
    // The same flow height either way, so the label does not move.
    expect(sun()).toHaveClass("size-10", "-my-1");
  });

  it("makes both buttons rail-sized (>= 64 px touch minimum) with press feedback that respects reduced motion", () => {
    render(<ViewToggle view="day" onChange={vi.fn()} />);
    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveClass(
        "w-nav",
        "h-30",
        "min-h-touch",
        "active:scale-[0.97]",
        "motion-reduce:transition-none",
      );
    }
  });
});
