import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { mealFixture } from "../components/fixtures.test-utils";
import en from "../i18n/locales/en.json";
import { MealPlates, platesOf } from "./MealPlates";

const BREAKFAST = mealFixture({
  id: "b",
  slot: "breakfast",
  title: "Oatmeal",
  icon: "🥣",
});
const LUNCH = mealFixture({ id: "l", slot: "lunch", title: "Pasta" });
const SNACK = mealFixture({
  id: "s",
  slot: "unspecified",
  title: "Apple slices",
  icon: "🍎",
});
const SECOND_LUNCH = mealFixture({
  id: "l2",
  slot: "lunch",
  title: "Salad",
  icon: "🥗",
});

describe("platesOf", () => {
  it("keeps breakfast, lunch and dinner at fixed places, empty when missing, unspecified last", () => {
    expect(
      platesOf([SNACK, LUNCH, SECOND_LUNCH]).map(
        (plate) => plate.meal?.id ?? plate.key,
      ),
    ).toEqual(["empty-breakfast", "l", "l2", "empty-dinner", "s"]);
    expect(platesOf([BREAKFAST]).map((plate) => plate.key)).toEqual([
      "b",
      "empty-lunch",
      "empty-dinner",
    ]);
  });
});

describe("MealPlates", () => {
  it("names every plate 'slot: title' and gives the unspecified slot a place without a time badge", () => {
    render(<MealPlates meals={[BREAKFAST, LUNCH, SNACK]} today={false} />);
    const list = screen.getByRole("list", { name: en.day.meals });
    expect(
      within(list)
        .getAllByRole("img")
        .map((plate) => plate.getAttribute("aria-label")),
    ).toEqual(["Breakfast: Oatmeal", "Lunch: Pasta", "Meal: Apple slices"]);
    const items = list.querySelectorAll("li");
    expect([...items].map((item) => item.dataset["slot"])).toEqual([
      "breakfast",
      "lunch",
      "empty",
      "unspecified",
    ]);
    // Time-of-day badges: 🌅 breakfast, 🌞 lunch, none for unspecified; never a moon.
    const symbols = (item: Element | undefined): string[] =>
      [...(item?.querySelectorAll("[aria-hidden=true].font-emoji") ?? [])].map(
        (el) => el.textContent,
      );
    expect(symbols(items[0])).toEqual(["🌅"]);
    expect(symbols(items[1])).toEqual(["🌞"]);
    expect(symbols(items[3])).toEqual([]);
    expect(list.textContent).not.toContain("🌙");
    expect(items[2]).toHaveAttribute("aria-hidden", "true");
    // Short names only in today's column.
    expect(screen.queryByText("Pasta")).toBeNull();
  });

  it("shows the short names in today's column (decorative, the plate is named)", () => {
    render(<MealPlates meals={[LUNCH]} today />);
    expect(screen.getByText("Pasta")).toHaveAttribute("aria-hidden", "true");
    // Up to two small lines instead of a one-line cut.
    expect(screen.getByText("Pasta")).toHaveClass(
      "line-clamp-2",
      "text-caption",
      // Broken between words only, never hyphenated; a too long word ends in "…".
      "hyphens-manual",
      "text-ellipsis",
    );
    expect(screen.getByText("Pasta").className).not.toMatch(
      /hyphens-auto|break-word/u,
    );
  });

  it("renders nothing without meals and titles only as text", () => {
    const { container, rerender } = render(<MealPlates meals={[]} today />);
    expect(container).toBeEmptyDOMElement();
    const evil = "<b>soup</b>";
    rerender(<MealPlates meals={[{ ...LUNCH, title: evil }]} today />);
    expect(screen.getByText(evil)).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
  });
});
