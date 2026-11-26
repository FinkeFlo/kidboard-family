import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BEN, MIA } from "../components/fixtures.test-utils";
import { applyLocale } from "../i18n";
import type { FormatContext } from "../i18n/format";
import {
  BRING_AREA_LAYOUT,
  BRING_AREA_METRICS,
  BringArea,
  bringAreaRem,
  bringAreaRows,
  type BringGroupSize,
  bringGroupsThatFit,
  bringRowRem,
  bringRowsOf,
} from "./BringArea";
import type { BringReminder } from "./buildBringReminder";

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

const format: FormatContext = { locale: "en", timeZone: "Europe/Berlin" };
const formatDe: FormatContext = { locale: "de", timeZone: "Europe/Berlin" };

/** Sunday evening, packing for Monday 2026-11-23. */
const REMINDER: BringReminder = {
  when: "tomorrow",
  date: "2026-11-23",
  groups: [
    { child: null, icons: ["🧺"] },
    { child: MIA, icons: ["🩱", "🧴", "🥽"] },
    { child: BEN, icons: ["👟"] },
  ],
};

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  applyLocale("en");
});

describe("bringGroupsThatFit", () => {
  const GROUPS: BringGroupSize[] = [
    { icons: 2, badge: false },
    { icons: 8, badge: true },
    { icons: 5, badge: true },
  ];
  const total = GROUPS.reduce((sum, group) => sum + group.icons, 0);

  it("draws everything before the row is measured and while it fits", () => {
    expect(bringGroupsThatFit(GROUPS, null)).toEqual({
      drawn: [2, 8, 5],
      hiddenIcons: 0,
    });
    const all = bringRowRem(GROUPS, [2, 8, 5], false);
    expect(bringGroupsThatFit(GROUPS, all)).toEqual({
      drawn: [2, 8, 5],
      hiddenIcons: 0,
    });
    expect(bringGroupsThatFit([], 10)).toEqual({ drawn: [], hiddenIcons: 0 });
  });

  it("shares a short row out fairly, one chip per group in turn", () => {
    const m = BRING_AREA_METRICS;
    const long: BringGroupSize[] = [
      { icons: 4, badge: false },
      { icons: 8, badge: true },
      { icons: 5, badge: true },
    ];
    // Room for every group's badge and "+N" plus exactly two chips per group.
    const width =
      bringRowRem(long, [0, 0, 0], false) + 3 * 2 * (m.chipRem + m.itemGapRem);
    expect(bringGroupsThatFit(long, width)).toEqual({
      drawn: [2, 2, 2],
      hiddenIcons: 0,
    });
    // A group's last chip takes the place of its "+N": it costs no extra room, so a
    // group that completes leaves its share to the others.
    const short =
      bringRowRem(GROUPS, [0, 0, 0], false) +
      3 * 2 * (m.chipRem + m.itemGapRem);
    expect(bringGroupsThatFit(GROUPS, short)).toEqual({
      drawn: [2, 3, 2],
      hiddenIcons: 0,
    });
  });

  it("leaves out the last groups only when not every badge fits, counting them in a trailing +N", () => {
    const width = bringRowRem(GROUPS, [2, 0], true);
    const fit = bringGroupsThatFit(GROUPS, width);
    expect(fit.drawn).toEqual([2, 0]);
    expect(fit.hiddenIcons).toBe(5);
    // Not even the first group: everything is counted.
    expect(bringGroupsThatFit(GROUPS, 0.5)).toEqual({
      drawn: [],
      hiddenIcons: total,
    });
  });

  it('reserves room for a two-digit +N (2rem, as measured for "+12" in the e2e)', () => {
    const m = BRING_AREA_METRICS;
    expect(m.moreRem).toBeGreaterThanOrEqual(2);
    // One child with 20 icons: room for 3 chips plus the "+17" is exactly enough for 3.
    const one: BringGroupSize[] = [{ icons: 20, badge: true }];
    const width = bringRowRem(one, [3], false);
    const fit = bringGroupsThatFit(one, width);
    expect(fit.drawn).toEqual([3]);
    // One chip fewer in the same room would leave the "+N" no less room (it is reserved).
    expect(bringRowRem(one, [4], false)).toBeGreaterThan(width);
    // The row with its drawn chips and "+N" never needs more than the room it was given.
    expect(bringRowRem(one, fit.drawn, false)).toBeLessThanOrEqual(width);
  });

  it("at every width: nothing lost, never wider than the row, no +N while another chip fits", () => {
    for (let tenths = 0; tenths <= 600; tenths += 1) {
      const width = tenths / 10;
      const { drawn, hiddenIcons } = bringGroupsThatFit(GROUPS, width);
      const hidden = drawn.length < GROUPS.length;
      const counted =
        drawn.reduce(
          (sum, count, index) => sum + ((GROUPS[index]?.icons ?? 0) - count),
          0,
        ) + hiddenIcons;
      const shown = drawn.reduce((sum, count) => sum + count, 0);
      expect(shown + counted, `width ${String(width)}`).toBe(total);
      expect(hiddenIcons > 0).toBe(hidden);
      drawn.forEach((count, index) => {
        expect(count).toBeGreaterThanOrEqual(0);
        expect(count).toBeLessThanOrEqual(GROUPS[index]?.icons ?? 0);
      });
      if (drawn.length > 0 || hidden) {
        const used = bringRowRem(GROUPS, drawn, hidden);
        if (drawn.length > 0) {
          expect(used, `width ${String(width)}`).toBeLessThanOrEqual(
            width + 1e-6,
          );
        }
        // No group could draw one more chip in the room left.
        drawn.forEach((count, index) => {
          if (count >= (GROUPS[index]?.icons ?? 0)) return;
          const more = drawn.map((c, i) => (i === index ? c + 1 : c));
          expect(bringRowRem(GROUPS, more, hidden)).toBeGreaterThan(
            width + 1e-6,
          );
        });
      }
    }
  });
});

describe("bringAreaRem / bringAreaRows / bringRowsOf", () => {
  const l = BRING_AREA_LAYOUT;
  const stack = (rows: number): number =>
    rows * l.rowRem + (rows - 1) * l.rowGapRem;

  it("the height is the padding plus the taller of the rows and the head beside them", () => {
    // Evening: the head (🎒, arrow and weekday, label) is taller than one row …
    expect(l.headTomorrowRem).toBeGreaterThan(stack(1));
    expect(bringAreaRem(1, "tomorrow")).toBeCloseTo(
      2 * l.padRem + l.headTomorrowRem,
    );
    // … but no taller than two, so two children cost no more than the head.
    expect(l.headTomorrowRem).toBeLessThanOrEqual(stack(2));
    expect(bringAreaRem(2, "tomorrow")).toBeCloseTo(2 * l.padRem + stack(2));
    expect(
      bringAreaRem(3, "tomorrow") - bringAreaRem(2, "tomorrow"),
    ).toBeCloseTo(l.rowGapRem + l.rowRem);
    // Morning: a shorter head (no arrow, no weekday).
    expect(bringAreaRem(1, "today")).toBeLessThan(bringAreaRem(1, "tomorrow"));
    expect(bringAreaRem(2, "today")).toBe(bringAreaRem(2, "tomorrow"));
    // Never less than one row.
    expect(bringAreaRem(0, "today")).toBe(bringAreaRem(1, "today"));
  });

  it("one row per group while the budget allows, at least one, all when unmeasured", () => {
    expect(bringAreaRows(0, 100, "tomorrow")).toBe(0);
    expect(bringAreaRows(3, null, "tomorrow")).toBe(3);
    const three = bringAreaRem(3, "tomorrow");
    expect(bringAreaRows(3, three, "tomorrow")).toBe(3);
    expect(bringAreaRows(3, three - 0.01, "tomorrow")).toBe(2);
    expect(bringAreaRows(3, bringAreaRem(2, "tomorrow"), "tomorrow")).toBe(2);
    expect(bringAreaRows(3, bringAreaRem(1, "tomorrow"), "tomorrow")).toBe(1);
    expect(bringAreaRows(3, 0, "today")).toBe(1);
    expect(bringAreaRows(2, 1000, "today")).toBe(2);
    // Never taller than the budget, unless even one row does not fit.
    for (const when of ["tomorrow", "today"] as const) {
      for (let tenths = 0; tenths <= 200; tenths += 1) {
        const budget = tenths / 10;
        const rows = bringAreaRows(4, budget, when);
        expect(rows).toBeGreaterThanOrEqual(1);
        if (rows > 1) {
          expect(bringAreaRem(rows, when)).toBeLessThanOrEqual(budget);
        }
        if (rows < 4) {
          expect(bringAreaRem(rows + 1, when)).toBeGreaterThan(budget);
        }
      }
    }
  });

  it("splits groups into rows, the last row holding the rest, nothing lost", () => {
    expect(bringRowsOf(3, 3)).toEqual([[0], [1], [2]]);
    expect(bringRowsOf(3, 5)).toEqual([[0], [1], [2]]);
    expect(bringRowsOf(4, 2)).toEqual([[0], [1, 2, 3]]);
    expect(bringRowsOf(4, 1)).toEqual([[0, 1, 2, 3]]);
    expect(bringRowsOf(0, 2)).toEqual([]);
    for (let groups = 1; groups <= 6; groups += 1) {
      for (let rows = 1; rows <= 6; rows += 1) {
        expect(bringRowsOf(groups, rows).flat()).toEqual(
          Array.from({ length: groups }, (_, index) => index),
        );
      }
    }
  });
});

describe("BringArea", () => {
  it("is a labelled region (not a live region) naming every child and icon", () => {
    render(<BringArea reminder={REMINDER} format={format} />);
    const area = screen.getByRole("region", {
      name: "Pack for tomorrow: Everyone 🧺, Mia 🩱 🧴 🥽, and Ben 👟",
    });
    expect(area).toHaveAttribute("data-when", "tomorrow");
    expect(area).not.toHaveAttribute("aria-live");
    expect(area.querySelector("[aria-live]")).toBeNull();
    // Nothing to touch.
    expect(within(area).queryAllByRole("button")).toEqual([]);
    expect(area.querySelector("a, button, [tabindex]")).toBeNull();
  });

  it("the morning variant and German", () => {
    const { rerender } = render(
      <BringArea reminder={{ ...REMINDER, when: "today" }} format={format} />,
    );
    expect(
      screen.getByRole("region", {
        name: "Today bring: Everyone 🧺, Mia 🩱 🧴 🥽, and Ben 👟",
      }),
    ).toBeInTheDocument();
    applyLocale("de");
    rerender(<BringArea reminder={REMINDER} format={formatDe} />);
    expect(
      screen.getByRole("region", {
        name: "Für morgen einpacken: Alle 🧺, Mia 🩱 🧴 🥽 und Ben 👟",
      }),
    ).toBeInTheDocument();
    rerender(
      <BringArea reminder={{ ...REMINDER, when: "today" }} format={formatDe} />,
    );
    expect(
      screen.getByRole("region", {
        name: "Heute mitbringen: Alle 🧺, Mia 🩱 🧴 🥽 und Ben 👟",
      }),
    ).toBeInTheDocument();
  });

  it("leads with 🎒, then one group per child (badge, tint, edge), the neutral one first", () => {
    render(<BringArea reminder={REMINDER} format={format} />);
    const area = screen.getByTestId("bring-area");
    const first = area.querySelector(".font-emoji");
    expect(first?.textContent).toBe("🎒");
    expect(first).toHaveAttribute("aria-hidden", "true");
    const groups = within(area).getAllByTestId("bring-group");
    expect(groups.map((group) => group.dataset["child"])).toEqual([
      "",
      "mia",
      "ben",
    ]);
    // Neutral group: no badge, a raised pill; child groups: avatar badge on their tint.
    expect(groups[0]?.querySelectorAll(".font-emoji")).toHaveLength(1);
    expect(groups[0]).toHaveClass("bg-surface-raised");
    expect(groups[1]?.textContent).toContain("🦊");
    expect(groups[1]?.getAttribute("style")).toContain(
      "var(--color-child-1-tint)",
    );
    expect(groups[2]?.textContent).toContain("🐻");
    const chips = within(area).getAllByTestId("bring-area-chip");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "🧺",
      "🩱",
      "🧴",
      "🥽",
      "👟",
    ]);
    for (const chip of chips) {
      expect(chip).toHaveClass("bg-chip", "inset-ring-border", "rounded-pill");
      expect(chip.querySelector(".font-emoji")).not.toBeNull();
    }
    // The visual row is decorative; the region's name carries the content.
    expect(screen.getByTestId("bring-groups")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(within(area).queryByTestId("bring-group-more")).toBeNull();
    expect(within(area).queryByTestId("bring-area-more")).toBeNull();
  });

  it("one row per group, each child's icons side by side; height fixed by the row count", () => {
    render(<BringArea reminder={REMINDER} format={format} />);
    const area = screen.getByTestId("bring-area");
    expect(area).toHaveClass("shrink-0", "overflow-hidden");
    expect(area).toHaveAttribute("data-rows", "3");
    expect(area.style.height).toBe(`${String(bringAreaRem(3, "tomorrow"))}rem`);
    const rows = within(area).getAllByTestId("bring-area-row");
    expect(
      rows.map((row) =>
        within(row)
          .getAllByTestId("bring-group")
          .map((group) => group.dataset["child"]),
      ),
    ).toEqual([[""], ["mia"], ["ben"]]);
    for (const row of rows) {
      expect(row).toHaveClass("h-9", "overflow-hidden", "min-w-0");
      expect(row).not.toHaveClass("flex-wrap");
    }
  });

  it("the head says which day: evening an arrow, tomorrow's short weekday and Tomorrow; morning Today", () => {
    const { rerender } = render(
      <BringArea reminder={REMINDER} format={format} />,
    );
    const head = screen.getByTestId("bring-head");
    expect(head).toHaveAttribute("aria-hidden", "true");
    expect(head.querySelector(".font-emoji")?.textContent).toBe("🎒");
    expect(within(head).getByTestId("bring-arrow")).toBeInTheDocument();
    // Monday 2026-11-23, in the config zone.
    expect(within(head).getByTestId("bring-day")).toHaveTextContent("Mon");
    expect(within(head).getByTestId("bring-cue")).toHaveTextContent("Tomorrow");
    // Never a moon: 🌙 only counts sleeps (merge rule 1).
    expect(screen.getByTestId("bring-area").textContent).not.toMatch(/🌙/u);
    rerender(
      <BringArea
        reminder={{ ...REMINDER, when: "today", date: "2026-11-22" }}
        format={format}
      />,
    );
    expect(screen.queryByTestId("bring-arrow")).toBeNull();
    expect(screen.queryByTestId("bring-day")).toBeNull();
    expect(screen.getByTestId("bring-cue")).toHaveTextContent("Today");
    applyLocale("de");
    rerender(<BringArea reminder={REMINDER} format={formatDe} />);
    expect(screen.getByTestId("bring-day")).toHaveTextContent("Mo");
    expect(screen.getByTestId("bring-cue")).toHaveTextContent("Morgen");
    rerender(
      <BringArea
        reminder={{ ...REMINDER, when: "today", date: "2026-11-22" }}
        format={formatDe}
      />,
    );
    expect(screen.getByTestId("bring-cue")).toHaveTextContent("Heute");
  });

  it("with fewer rows than groups, the last row holds the rest side by side", () => {
    render(<BringArea reminder={REMINDER} format={format} maxRows={2} />);
    const area = screen.getByTestId("bring-area");
    expect(area).toHaveAttribute("data-rows", "2");
    expect(area.style.height).toBe(`${String(bringAreaRem(2, "tomorrow"))}rem`);
    const rows = within(area).getAllByTestId("bring-area-row");
    expect(
      rows.map((row) =>
        within(row)
          .getAllByTestId("bring-group")
          .map((group) => group.dataset["child"]),
      ),
    ).toEqual([[""], ["mia", "ben"]]);
    // Still every icon, and the name lists them all.
    expect(within(area).getAllByTestId("bring-area-chip")).toHaveLength(5);
    expect(area).toHaveAccessibleName(
      "Pack for tomorrow: Everyone 🧺, Mia 🩱 🧴 🥽, and Ben 👟",
    );
  });

  it("a row too short for a long list draws its first (earliest) icons whole and counts the rest", () => {
    const m = BRING_AREA_METRICS;
    // Room for a badge, one chip and a "+N": Mia's row draws 🩱 and "+2"; the single-icon
    // groups complete (their chip is narrower than a "+N").
    stubWidth(
      bringRowRem([{ icons: 3, badge: true }], [0], false) +
        m.chipRem +
        m.itemGapRem,
    );
    render(<BringArea reminder={REMINDER} format={format} />);
    const groups = screen.getAllByTestId("bring-group");
    expect(groups.map((group) => group.dataset["drawn"])).toEqual([
      "1",
      "1",
      "1",
    ]);
    const mia = groups[1] as HTMLElement;
    expect(
      within(mia)
        .getAllByTestId("bring-area-chip")
        .map((chip) => chip.textContent),
    ).toEqual(["🩱"]);
    expect(within(mia).getByTestId("bring-group-more")).toHaveTextContent("+2");
    // The name still lists every icon.
    expect(screen.getByRole("region")).toHaveAccessibleName(
      "Pack for tomorrow: Everyone 🧺, Mia 🩱 🧴 🥽, and Ben 👟",
    );
  });

  it("in a single shared row, counts groups without room in a trailing +N", () => {
    const sizes = REMINDER.groups.map((group) => ({
      icons: group.icons.length,
      badge: group.child !== null,
    }));
    // Room for the neutral group and Mia's badge with their "+N" (the neutral icon then
    // fits whole, as a chip is narrower than a "+N"), but not Ben's badge.
    stubWidth(bringRowRem(sizes, [0, 0], true) + 0.05);
    const { unmount } = render(
      <BringArea reminder={REMINDER} format={format} maxRows={1} />,
    );
    expect(
      screen.getAllByTestId("bring-group").map((g) => g.dataset["child"]),
    ).toEqual(["", "mia"]);
    expect(screen.getByTestId("bring-group-more")).toHaveTextContent("+3");
    expect(screen.getByTestId("bring-area-more")).toHaveTextContent("+1");
    unmount();
    // Too narrow for any group: one "+N" counts every icon.
    stubWidth(1);
    render(<BringArea reminder={REMINDER} format={format} maxRows={1} />);
    expect(screen.queryAllByTestId("bring-group")).toEqual([]);
    expect(screen.getByTestId("bring-area-more")).toHaveTextContent("+5");
  });

  it("renders nothing when there is nothing to pack", () => {
    const { container } = render(
      <BringArea
        reminder={{ when: "tomorrow", date: "2026-11-23", groups: [] }}
        format={format}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
