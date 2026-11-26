import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { eventFixture } from "../components/fixtures.test-utils";
import {
  PastStrip,
  STRIP_MORE_REM,
  stripIconsThatFit,
} from "./ColumnSummaries";

/** `n` finished events with distinct titles and icons. */
const past = (n: number): ReturnType<typeof eventFixture>[] =>
  Array.from({ length: n }, (_, i) =>
    eventFixture({
      id: `p${String(i)}`,
      title: `Past ${String(i)}`,
      icon: ["🏊", "🏫", "👵", "⚽", "🎹", "🛁", "📖", "🦷", "🥛"][i] ?? "📌",
    }),
  );

/** Makes the strip's icon area report `widthRem` (at a 16px root). */
function stubWidth(widthRem: number): void {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(
        private readonly callback: (
          entries: { contentRect: { width: number } }[],
        ) => void,
      ) {}
      observe(): void {
        this.callback([{ contentRect: { width: widthRem * 16 } }]);
      }
      disconnect(): void {}
    },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stripIconsThatFit", () => {
  // Day: 1.875rem icons in 1.25em slots (2.34375rem) with 0.625rem gaps.
  const DAY_SLOT = 1.875 * 1.25;
  const DAY_GAP = 0.625;

  it("draws every icon while they fit, without room for a +N", () => {
    const width = 7 * DAY_SLOT + 6 * DAY_GAP;
    expect(stripIconsThatFit(7, 0, width, "day")).toBe(7);
    expect(stripIconsThatFit(0, 0, 0, "day")).toBe(0);
  });

  it("keeps room for +N when not all fit, drawing only whole icons", () => {
    // One rem short of seven: as many as fit beside a +N.
    const width = 7 * DAY_SLOT + 6 * DAY_GAP - 1;
    const fit = stripIconsThatFit(7, 0, width, "day");
    expect(fit).toBe(
      Math.floor((width - STRIP_MORE_REM) / (DAY_SLOT + DAY_GAP)),
    );
    expect(fit * (DAY_SLOT + DAY_GAP) + STRIP_MORE_REM).toBeLessThanOrEqual(
      width,
    );
  });

  it("needs room for the +N of events that have no icon anyway", () => {
    const width = 2 * DAY_SLOT + DAY_GAP;
    expect(stripIconsThatFit(2, 0, width, "day")).toBe(2);
    expect(stripIconsThatFit(2, 3, width, "day")).toBeLessThan(2);
  });

  it("never draws a partial icon or a negative count, at any width", () => {
    for (let width = 0; width <= 30; width += 0.25) {
      for (const variant of ["day", "week"] as const) {
        const fit = stripIconsThatFit(8, 0, width, variant);
        expect(fit).toBeGreaterThanOrEqual(0);
        expect(fit).toBeLessThanOrEqual(8);
      }
    }
  });

  it("draws all icons until measured", () => {
    expect(stripIconsThatFit(8, 2, null, "week")).toBe(8);
  });
});

describe("PastStrip", () => {
  it("never clips an icon: a narrow strip draws fewer and counts the rest, naming every title", () => {
    // Room for three day icons and the +N (3 * 2.97 + 2 = 10.9 rem).
    stubWidth(11);
    const items = past(7);
    render(<PastStrip items={items} icons={items} hidden={0} />);
    const strip = screen.getByTestId("past-strip");
    expect(within(strip).getAllByTestId("past-strip-icon")).toHaveLength(3);
    expect(strip).toHaveAttribute("data-drawn", "3");
    const more = within(strip).getByTestId("past-strip-more");
    expect(within(more).getByText("+4")).toHaveAttribute("aria-hidden", "true");
    expect(within(more).getByText("4 more already over")).toHaveClass(
      "sr-only",
    );
    // drawn + counted === folded (nothing hidden silently).
    expect(strip).toHaveAttribute("data-count", String(3 + 4));
    expect(strip).toHaveAccessibleName(
      `Already over: ${new Intl.ListFormat("en", { type: "conjunction" }).format(items.map((event) => event.title))}`,
    );
  });

  it("draws every icon (no +N) when the strip is wide enough", () => {
    stubWidth(40);
    const items = past(7);
    render(<PastStrip items={items} icons={items} hidden={0} />);
    const strip = screen.getByTestId("past-strip");
    expect(within(strip).getAllByTestId("past-strip-icon")).toHaveLength(7);
    expect(within(strip).queryByTestId("past-strip-more")).toBeNull();
  });

  it("adds icons cut for width to those already without one", () => {
    stubWidth(6);
    const items = past(5);
    render(
      <PastStrip
        variant="week"
        items={items}
        icons={items.slice(0, 2)}
        hidden={3}
      />,
    );
    const strip = screen.getByTestId("past-strip");
    const drawn = within(strip).queryAllByTestId("past-strip-icon").length;
    expect(drawn).toBeLessThan(2);
    expect(
      within(strip).getByText(`+${String(5 - drawn)}`),
    ).toBeInTheDocument();
  });
});
