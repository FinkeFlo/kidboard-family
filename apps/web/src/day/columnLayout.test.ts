import { describe, expect, it } from "vitest";

import { columnLayout, MIN_TILES, STRIP_ICONS_MAX } from "./columnLayout";

type Status = "past" | "current" | "upcoming";

/** Items in time order: `p` past, `c` current, `u` upcoming, e.g. "pppcuu". */
function items(pattern: string): { id: string; status: Status }[] {
  const statuses: Record<string, Status> = {
    p: "past",
    c: "current",
    u: "upcoming",
  };
  return Array.from(pattern).map((char, i) => ({
    id: `${char}${String(i)}`,
    status: statuses[char] ?? "upcoming",
  }));
}

function summary(pattern: string, tiles: number): unknown {
  const layout = columnLayout(items(pattern), tiles);
  return {
    strip: layout.pastStrip.map((item) => item.id).join(","),
    visible: layout.visible.map((item) => item.id).join(","),
    earlier: layout.hiddenEarlier,
    later: layout.later.map((item) => item.id).join(","),
  };
}

describe("columnLayout", () => {
  it("shows everything as tiles when every event gets one (past ones too)", () => {
    expect(summary("ppcuu", 5)).toEqual({
      strip: "",
      visible: "p0,p1,c2,u3,u4",
      earlier: 0,
      later: "",
    });
    expect(summary("", 4)).toEqual({
      strip: "",
      visible: "",
      earlier: 0,
      later: "",
    });
  });

  it("folds all past events at once, never only some of them", () => {
    // 7 events, 6 tiles: one too many, still every past event folds.
    expect(summary("pppcuuu", 6)).toEqual({
      strip: "p0,p1,p2",
      visible: "c3,u4,u5,u6",
      earlier: 0,
      later: "",
    });
    // Late evening: everything is over and does not fit, so it all folds.
    expect(summary("pppppppp", 4)).toEqual({
      strip: "p0,p1,p2,p3,p4,p5,p6,p7",
      visible: "",
      earlier: 0,
      later: "",
    });
  });

  it("sums up the latest upcoming events when folding is not enough", () => {
    expect(summary("ppuuuuuuuu", 4)).toEqual({
      strip: "p0,p1",
      visible: "u2,u3,u4,u5",
      earlier: 0,
      later: "u6,u7,u8,u9",
    });
    // Nothing past: no strip, only "+N".
    expect(summary("cuuuuuuu", 3)).toEqual({
      strip: "",
      visible: "c0,u1,u2",
      earlier: 0,
      later: "u3,u4,u5,u6,u7",
    });
  });

  it("keeps every folded event in pastStrip and counts icons beyond the strip's width", () => {
    const pattern = "p".repeat(STRIP_ICONS_MAX + 3) + "cuu";
    const layout = columnLayout(items(pattern), 1);
    // All folded titles stay available for the strip's accessible name.
    expect(layout.pastStrip).toHaveLength(STRIP_ICONS_MAX + 3);
    expect(layout.stripIcons).toEqual(
      layout.pastStrip.slice(0, STRIP_ICONS_MAX),
    );
    expect(layout.hiddenEarlier).toBe(3);
    expect(layout.visible.map((i) => i.id)).toEqual([
      `c${String(STRIP_ICONS_MAX + 3)}`,
    ]);
    expect(layout.hiddenLater).toBe(2);
  });

  it("treats tile counts below MIN_TILES (and non-numbers) as MIN_TILES", () => {
    for (const tiles of [0, -3, Number.NaN, 0.4, Number.POSITIVE_INFINITY]) {
      expect(summary("ppcuu", tiles)).toEqual(summary("ppcuu", MIN_TILES));
    }
    expect(summary("ppcuu", 0)).toEqual({
      strip: "p0,p1",
      visible: "c2",
      earlier: 0,
      later: "u3,u4",
    });
    // A single past event that fits stays a tile.
    expect(summary("p", 0)).toEqual({
      strip: "",
      visible: "p0",
      earlier: 0,
      later: "",
    });
  });

  it("never hides or folds a current event", () => {
    // Several current events: they stay even when that exceeds the tile count.
    const layout = columnLayout(items("pccccuuu"), 3);
    expect(layout.visible.map((i) => i.id)).toEqual(["c1", "c2", "c3", "c4"]);
    expect(layout.hiddenLater).toBe(3);
    expect(summary("pcu", 3)).toEqual({
      strip: "",
      visible: "p0,c1,u2",
      earlier: 0,
      later: "",
    });
  });

  it("keeps the counts exact, the order and the priorities for any mix", () => {
    const patterns: string[] = [];
    for (let past = 0; past <= 12; past += 1) {
      for (let rest = 0; rest <= 12; rest += 1) {
        for (const cur of ["", "c"]) {
          patterns.push("p".repeat(past) + cur + "u".repeat(rest));
        }
      }
    }
    for (const pattern of patterns) {
      for (let tiles = 1; tiles <= 14; tiles += 1) {
        const all = items(pattern);
        const layout = columnLayout(all, tiles);
        const shown = layout.visible.length;
        const stripped = layout.pastStrip.length;
        const past = all.filter((i) => i.status === "past").length;
        // Nothing is lost, and every folded item is retrievable.
        expect(shown + stripped + layout.hiddenLater).toBe(all.length);
        expect(layout.later).toHaveLength(layout.hiddenLater);
        expect(layout.stripIcons.length + layout.hiddenEarlier).toBe(stripped);
        expect(layout.stripIcons).toEqual(
          layout.pastStrip.slice(0, STRIP_ICONS_MAX),
        );
        // At most `tiles` tiles (a single current event always fits in one).
        expect(shown).toBeLessThanOrEqual(tiles);
        // One rule for the past: all tiles when everything fits, else all folded.
        if (all.length <= tiles) {
          expect(stripped + layout.hiddenLater).toBe(0);
        } else {
          expect(stripped).toBe(past);
          expect(layout.visible.some((i) => i.status === "past")).toBe(false);
        }
        // Only past events fold, only upcoming ones are summed up, the current stays.
        expect(layout.pastStrip.every((i) => i.status === "past")).toBe(true);
        expect(layout.later.every((i) => i.status === "upcoming")).toBe(true);
        expect(
          layout.visible.filter((i) => i.status === "current"),
        ).toHaveLength(pattern.includes("c") ? 1 : 0);
        // "+N" holds the latest: nothing summed up comes before a visible tile.
        const lastVisible = Math.max(
          -1,
          ...layout.visible.map((i) => all.indexOf(i)),
        );
        for (const item of layout.later) {
          expect(all.indexOf(item)).toBeGreaterThan(lastVisible);
        }
        // Time order everywhere.
        for (const list of [layout.pastStrip, layout.visible, layout.later]) {
          const order = list.map((i) => all.indexOf(i));
          expect(order).toEqual([...order].sort((x, y) => x - y));
        }
      }
    }
  });
});
