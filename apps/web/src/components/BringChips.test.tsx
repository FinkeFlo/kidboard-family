import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BringChips, chipMetrics, chipsThatFit } from "./BringChips";
import { iconRowRem, iconsThatFit } from "./iconsThatFit";

const EIGHT = ["🩱", "🧴", "🥽", "👟", "🎨", "👕", "🧢", "🥪"];

/** Makes every observed element report `widthRem` (at a 16px root). */
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

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("iconsThatFit / chipsThatFit", () => {
  const regular = chipMetrics("regular");

  it("draws every chip while they fit, all of them before the row is measured", () => {
    const width = iconRowRem(3, regular);
    expect(chipsThatFit(3, width, "regular")).toBe(3);
    expect(chipsThatFit(3, null, "regular")).toBe(3);
    expect(chipsThatFit(0, 0, "regular")).toBe(0);
    expect(iconRowRem(0, regular)).toBe(0);
  });

  it("keeps room for +N when not every chip fits, drawing only whole chips", () => {
    const width = iconRowRem(3, regular) - 0.01;
    const fit = chipsThatFit(3, width, "regular");
    expect(fit).toBe(
      Math.floor(
        (width - regular.moreRem) / (regular.slotRem + regular.gapRem),
      ),
    );
    expect(fit).toBeLessThan(3);
    expect(
      fit * (regular.slotRem + regular.gapRem) + regular.moreRem,
    ).toBeLessThanOrEqual(width);
  });

  it("never draws a partial chip, a negative count or more than there are, at any width", () => {
    for (const size of ["regular", "large"] as const) {
      const metrics = chipMetrics(size);
      for (let count = 0; count <= 8; count += 1) {
        for (let width = 0; width <= 14; width += 0.0625) {
          const fit = chipsThatFit(count, width, size);
          expect(fit).toBeGreaterThanOrEqual(0);
          expect(fit).toBeLessThanOrEqual(count);
          // What is drawn, plus the "+N" when one is needed, fits the width.
          const used =
            iconRowRem(fit, metrics) +
            (fit < count
              ? (fit > 0 ? metrics.gapRem : 0) + metrics.moreRem
              : 0);
          if (fit > 0 || width >= metrics.moreRem) {
            expect(used).toBeLessThanOrEqual(width + 1e-6);
          }
          // One more whole chip would not have fitted.
          if (fit < count) {
            const more = fit + 1;
            const next =
              iconRowRem(more, metrics) +
              (more < count ? metrics.gapRem + metrics.moreRem : 0);
            expect(next).toBeGreaterThan(width + 1e-6);
          }
        }
      }
    }
  });

  it("counts items without an icon like the strip does", () => {
    const width = iconRowRem(2, regular);
    expect(iconsThatFit(2, 0, width, regular)).toBe(2);
    expect(iconsThatFit(2, 3, width, regular)).toBeLessThan(2);
  });
});

describe("BringChips", () => {
  it("renders every icon as decorative React text chips while unmeasured", () => {
    render(<BringChips bring={["🩱", "🧴", "🥽"]} />);
    const area = screen.getByTestId("bring-chips");
    expect(area).toHaveAttribute("aria-hidden", "true");
    const chips = within(area).getAllByTestId("bring-chip");
    expect(chips.map((chip) => chip.textContent)).toEqual(["🩱", "🧴", "🥽"]);
    // Through the Emoji seam (emoji font, dimmed at night), on the chip disc with a ring
    // (`--color-chip`: lighter than the tile at night, contrast-tested in tokens.test.ts).
    for (const chip of chips) {
      expect(chip.querySelector(".font-emoji")).not.toBeNull();
      expect(chip).toHaveClass("bg-chip", "inset-ring-border", "rounded-pill");
    }
    expect(screen.queryByTestId("bring-chips-more")).toBeNull();
    // Asks for the width of every chip; it shrinks first in a short row.
    expect(area.style.width).toBe(
      `${String(iconRowRem(3, chipMetrics("regular")))}rem`,
    );
    expect(area).toHaveClass("shrink-999", "overflow-hidden");
  });

  it("draws only whole chips that fit the measured width and counts the rest as plain-text +N", () => {
    // Room for two chips beside a "+N".
    const { slotRem, gapRem, moreRem } = chipMetrics("regular");
    stubWidth(2 * (slotRem + gapRem) + moreRem);
    render(<BringChips bring={EIGHT} />);
    const area = screen.getByTestId("bring-chips");
    expect(within(area).getAllByTestId("bring-chip")).toHaveLength(2);
    expect(area).toHaveAttribute("data-drawn", "2");
    expect(area).toHaveAttribute("data-count", "8");
    const more = within(area).getByTestId("bring-chips-more");
    expect(more).toHaveTextContent("+6");
    expect(more.className).not.toMatch(/ring|border|bg-/u);
    // The requested width depends on the list, never on what is drawn.
    expect(area.style.width).toBe(
      `${String(iconRowRem(8, chipMetrics("regular")))}rem`,
    );
  });

  it("shows at least the +N in a row too short for one chip", () => {
    stubWidth(1);
    render(<BringChips bring={["🩱", "🧴"]} size="large" />);
    expect(screen.queryAllByTestId("bring-chip")).toHaveLength(0);
    expect(screen.getByTestId("bring-chips-more")).toHaveTextContent("+2");
    // Never narrower than the "+N" room.
    expect(screen.getByTestId("bring-chips").style.minWidth).toBe(
      `${String(chipMetrics("large").moreRem)}rem`,
    );
  });

  it("renders nothing for an empty list", () => {
    const { container } = render(<BringChips bring={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders markup-looking content as text, never as HTML", () => {
    // The shared schema only lets emoji through; the component must still never parse.
    render(<BringChips bring={["<img src=x onerror=alert(1)>"]} />);
    expect(screen.getByTestId("bring-chip")).toHaveTextContent(
      "<img src=x onerror=alert(1)>",
    );
    expect(document.querySelector("img")).toBeNull();
  });
});
