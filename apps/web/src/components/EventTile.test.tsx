import type { Child } from "@kidboard/shared";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { FormatContext } from "../i18n/format";
import de from "../i18n/locales/de.json";
import en from "../i18n/locales/en.json";
import tokensCss from "../styles/tokens.css?raw";
import {
  BRING_EXTRA_REM,
  type EventStatus,
  EventTile,
  showsBring,
  TILE_CHIP_SIZE,
  TILE_HEIGHT_REM,
  type TileSize,
} from "./EventTile";
import { tileClasses } from "./eventTileSizes";
import { BEN, eventFixture, MIA } from "./fixtures.test-utils";

const format: FormatContext = { locale: "en", timeZone: "Europe/Berlin" };
const LEO: Child = { id: "leo", name: "Leo", color: "child-3", avatar: "🦁" };
const ZOE: Child = { id: "zoe", name: "Zoe", color: "child-4", avatar: "🐼" };

const tile = (): HTMLElement => screen.getByTestId("event-tile");
const badges = (): HTMLElement => screen.getByTestId("child-badges");

describe("EventTile", () => {
  it("shows icon, one-line title and the time in the configured zone; named title, time, children", () => {
    render(
      <EventTile
        event={eventFixture({ childIds: ["mia"] })}
        childList={[MIA, BEN]}
        format={format}
        timeOfDay="midday"
      />,
    );
    const article = screen.getByRole("article", {
      name: "Swimming, 2:30 PM, For Mia",
    });
    expect(article).toBeVisible();
    // Decorative icon: the title is announced once, via the article name.
    expect(screen.getByText("🏊")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("2:30 PM")).toBeInTheDocument();
    // Up to two lines, then clamped; the title is plain text.
    expect(screen.getByTestId("tile-title")).toHaveTextContent("Swimming");
    expect(screen.getByTestId("tile-title").parentElement).toHaveClass(
      "line-clamp-2",
    );
    // The emoji sits on a light disc (pale glyphs stay visible), the time-of-day icon
    // is at least 1.5rem.
    expect(within(tile()).getByTestId("emoji-disc")).toHaveClass(
      "bg-surface-sunken",
      "inset-ring-border",
    );
    expect(within(tile()).getByText("🌞")).toHaveClass("text-[1.5rem]");
  });

  it("uses the zone, not the instant's offset or device zone", () => {
    render(
      <EventTile
        event={eventFixture({ start: "2026-11-22T13:30:00Z" })}
        childList={[]}
        format={format}
      />,
    );
    expect(screen.getByText("2:30 PM")).toBeInTheDocument();
  });

  it("shows the time-of-day symbol: 🌅 morning, 🌞 midday, 🌆 evening, never the moon", () => {
    const { rerender } = render(
      <EventTile
        event={eventFixture()}
        childList={[]}
        format={format}
        timeOfDay="morning"
      />,
    );
    const seen: string[] = [];
    for (const timeOfDay of ["morning", "midday", "evening"] as const) {
      rerender(
        <EventTile
          event={eventFixture()}
          childList={[]}
          format={format}
          timeOfDay={timeOfDay}
        />,
      );
      const symbols = [...tile().querySelectorAll(".font-emoji")].map(
        (el) => el.textContent,
      );
      seen.push(symbols[1] ?? "");
      expect(symbols).not.toContain("🌙");
      expect(symbols).not.toContain("☀️");
    }
    expect(seen).toEqual(["🌅", "🌞", "🌆"]);
  });

  it("gives all-day events the all-day icon and label, never a formatted date key", () => {
    render(
      <EventTile
        event={eventFixture({
          allDay: true,
          start: "2026-11-22",
          end: "2026-11-23",
        })}
        childList={[]}
        format={format}
      />,
    );
    expect(screen.getByText(en.event.allDay)).toBeInTheDocument();
    expect(tile()).toHaveAttribute("data-all-day", "true");
    expect(screen.getByTestId("all-day-icon")).toBeInTheDocument();
    expect(tile().querySelectorAll(".font-emoji")).toHaveLength(1);
  });

  it("one child: the child's tint, an edge in the child colour and one badge", () => {
    render(
      <EventTile
        event={eventFixture({ childIds: ["mia", "ghost"] })}
        childList={[MIA, BEN]}
        format={format}
      />,
    );
    expect(tile()).toHaveAttribute("data-tint", "single");
    expect(tile().style.background).toBe("var(--color-child-1-tint)");
    expect(tile().style.getPropertyValue("--child-color")).toBe(
      "var(--color-child-1)",
    );
    // The edge is an overlay above the content, so the emoji never paints over it.
    expect(tile()).toHaveClass(
      "relative",
      "after:absolute",
      "after:inset-0",
      "after:inset-ring-4",
    );
    expect(within(badges()).getByText("🦊")).toBeInTheDocument();
    expect(badges()).toHaveAttribute("aria-hidden", "true");
  });

  it("puts the badges inside the tile, floated beside the title's first line only", () => {
    const { unmount } = render(
      <EventTile
        event={eventFixture({ title: "Swimming", childIds: ["mia"] })}
        childList={[MIA, BEN]}
        format={format}
      />,
    );
    const float = screen.getByTestId("badge-float");
    // A small gap between the title and the badges.
    expect(float).toHaveClass("float-end", "ms-2");
    // Inside the tile (no corner overlay any more) and inside the title paragraph.
    expect(tile()).toContainElement(float);
    expect(float.parentElement).toContainElement(
      screen.getByTestId("tile-title"),
    );
    expect(float.parentElement?.className).not.toMatch(/\bpe-/u);
    unmount();
    render(
      <EventTile
        event={eventFixture({ title: "Swimming", childIds: [] })}
        childList={[MIA, BEN]}
        format={format}
      />,
    );
    expect(screen.queryByTestId("badge-float")).toBeNull();
  });

  it("two children: neutral fill with a colour stripe per child, side-by-side badges overlapping a quarter", () => {
    render(
      <EventTile
        event={eventFixture({ childIds: ["mia", "ben"] })}
        childList={[MIA, BEN]}
        format={format}
      />,
    );
    expect(tile()).toHaveAttribute("data-tint", "split");
    // No half-and-half fill that reads as a progress bar.
    expect(tile().style.background).toBe("var(--color-surface-raised)");
    expect(tile()).toHaveClass("after:inset-ring-border");
    const stripes = within(tile()).getByTestId("tile-stripes");
    expect(stripes).toHaveAttribute("aria-hidden", "true");
    expect(stripes.style.background).toContain("linear-gradient(90deg");
    expect(stripes.style.background).toContain("var(--color-child-1)");
    const shown = [...badges().children];
    expect(shown.map((badge) => badge.textContent)).toEqual(["🦊", "🐻"]);
    // size-6.5 (1.625rem) overlapping by 0.375rem: less than a quarter.
    expect(shown[0]).toHaveClass("size-6.5");
    expect(shown[1]).toHaveClass("-ms-1.5");
    expect(tile()).toHaveAccessibleName("Swimming, 2:30 PM, For Mia and Ben");
  });

  it("badges overlap by at most a quarter at every size, prominent ones included", () => {
    const sizes = [
      "large",
      "medium",
      "dense",
      "compact",
      "compact-dense",
      "week",
      "week-dense",
      "week-small",
      "week-slim",
    ] as const;
    for (const size of sizes) {
      for (const prominent of [false, true]) {
        const { badge, badgeOverlap } = tileClasses(size, prominent);
        const width = Number(/^size-([\d.]+)$/u.exec(badge)?.[1]);
        const overlap = Number(/^-ms-([\d.]+)$/u.exec(badgeOverlap)?.[1]);
        expect(width, `${size} ${badge}`).toBeGreaterThan(0);
        expect(overlap / width, `${size} ${badgeOverlap}`).toBeGreaterThan(0);
        expect(overlap / width, `${size} ${badgeOverlap}`).toBeLessThanOrEqual(
          0.25,
        );
      }
    }
  });

  it("three and more children: neutral fill, three badges, then +N; the name lists all", () => {
    render(
      <EventTile
        event={eventFixture({ childIds: ["mia", "ben", "leo", "zoe"] })}
        childList={[MIA, BEN, LEO, ZOE]}
        format={format}
      />,
    );
    expect(tile()).toHaveAttribute("data-tint", "neutral");
    expect(tile().style.background).toBe("var(--color-surface-raised)");
    expect(within(badges()).getByTestId("child-badges-more")).toHaveTextContent(
      "+1",
    );
    expect(within(badges()).queryByText("🐼")).toBeNull();
    expect(tile()).toHaveAccessibleName(
      "Swimming, 2:30 PM, For Mia, Ben, Leo, and Zoe",
    );
  });

  it("names events without a configured child 'for everyone', without badges", () => {
    render(
      <EventTile
        event={eventFixture({ childIds: ["ghost"] })}
        childList={[MIA]}
        format={format}
      />,
    );
    expect(tile()).toHaveAccessibleName("Swimming, 2:30 PM, For everyone");
    expect(screen.queryByTestId("child-badges")).toBeNull();
    expect(tile()).toHaveAttribute("data-tint", "none");
  });

  it("past events recede through tokens, not opacity; current has a ring; next is emphasised", () => {
    const { rerender } = render(
      <EventTile
        event={eventFixture({ childIds: ["mia"] })}
        childList={[MIA]}
        format={format}
        status="past"
      />,
    );
    expect(tile()).toHaveAttribute("data-status", "past");
    expect(tile()).toHaveClass("bg-surface-sunken", "text-text-muted");
    expect(tile().className).not.toMatch(/opacity/);
    expect(tile().style.background).toBe("");
    expect(tile()).toHaveAccessibleName(
      `Swimming, 2:30 PM, For Mia, ${en.event.status.past}`,
    );

    rerender(
      <EventTile
        event={eventFixture()}
        childList={[]}
        format={format}
        status="current"
      />,
    );
    // Person-neutral "now": the ink ring and a clock cue, never a child-like accent.
    expect(tile()).toHaveClass("ring-4", "ring-now");
    expect(tile().className).not.toMatch(/accent/u);
    expect(within(tile()).getByTestId("now-cue")).toBeInTheDocument();
    expect(tile()).toHaveAccessibleName(
      `Swimming, 2:30 PM, For everyone, ${en.event.status.current}`,
    );

    rerender(
      <EventTile event={eventFixture()} childList={[]} format={format} next />,
    );
    expect(tile()).toHaveAttribute("data-next", "true");
    // "Next" is not the gold of today's column: a dashed outline in the "now" ink and
    // an outlined ▶ cue (now: solid ring and filled clock).
    expect(tile()).toHaveClass("outline-dashed", "outline-now", "outline-3");
    expect(tile().className).not.toMatch(/today-ring/u);
    expect(within(tile()).queryByTestId("now-cue")).toBeNull();
    const cue = within(tile()).getByTestId("next-cue");
    expect(cue).toHaveClass("bg-surface", "text-now", "ring-now");
    expect(within(cue).getByTestId("next-icon")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(tile()).toHaveAccessibleName(
      `Swimming, 2:30 PM, For everyone, ${en.event.status.next}`,
    );
  });

  it("keeps today's emoji at 3.5rem (large), 3rem (medium) and 2.75rem (dense)", () => {
    const expected = {
      large: "text-[3.5rem]",
      medium: "text-[3rem]",
      dense: "text-[2.75rem]",
    } as const;
    for (const size of ["large", "medium", "dense"] as const) {
      const { unmount } = render(
        <EventTile
          event={eventFixture()}
          childList={[]}
          format={format}
          size={size}
        />,
      );
      expect(screen.getByText("🏊")).toHaveClass(expected[size]);
      expect(tile()).toHaveAttribute("data-size", size);
      expect(tile()).toHaveAttribute("data-prominent", "false");
      unmount();
    }
  });

  it("a prominent tile in today's column is taller with a larger emoji; elsewhere it is ignored", () => {
    const { rerender } = render(
      <EventTile
        event={eventFixture()}
        childList={[]}
        format={format}
        size="large"
        prominent
      />,
    );
    expect(tile()).toHaveAttribute("data-prominent", "true");
    expect(tile()).toHaveClass("h-[6.5rem]");
    expect(screen.getByText("🏊")).toHaveClass("text-[4.5rem]");
    rerender(
      <EventTile
        event={eventFixture()}
        childList={[]}
        format={format}
        size="compact"
        prominent
      />,
    );
    expect(tile()).toHaveAttribute("data-prominent", "false");
    expect(tile()).toHaveClass("h-tile-compact");
    expect(screen.getByText("🏊")).toHaveClass("text-[2.5rem]");
  });

  it("breaks titles between words only: no automatic hyphenation, long words end in …", () => {
    for (const size of ["large", "compact", "dense", "slim"] as const) {
      const { unmount } = render(
        <EventTile
          event={eventFixture({ title: "Swimming", childIds: ["mia"] })}
          childList={[MIA]}
          format={format}
          size={size}
        />,
      );
      const title = screen.getByTestId("tile-title").closest("p");
      expect(title?.className).not.toMatch(/hyphens-auto|break-word/u);
      expect(title?.className).toMatch(/hyphens-manual|truncate/u);
      expect(title?.className).toMatch(/text-ellipsis|truncate/u);
      unmount();
    }
  });

  it("slim (last today step): title, badges and time in one row, 2rem emoji, no prominence", () => {
    render(
      <EventTile
        event={eventFixture({ childIds: ["mia"] })}
        childList={[MIA]}
        format={format}
        timeOfDay="midday"
        size="slim"
        next
        prominent
      />,
    );
    expect(tile()).toHaveAttribute("data-size", "slim");
    expect(tile()).toHaveAttribute("data-prominent", "false");
    expect(tile()).toHaveClass("h-11");
    expect(screen.getByText("🏊")).toHaveClass("text-[2rem]");
    const title = screen.getByTestId("tile-title").parentElement;
    expect(title).toHaveClass("truncate");
    // One row: the title, the badges and the time share a parent.
    const row = title?.parentElement;
    expect(row).toHaveClass("items-center");
    expect(row).toContainElement(screen.getByTestId("child-badges"));
    expect(row).toContainElement(screen.getByText("2:30 PM"));
    // The next cue scales down with the disc.
    expect(screen.getByTestId("next-cue")).toHaveClass("size-4");
    expect(tile()).toHaveAccessibleName(
      `Swimming, 2:30 PM, For Mia, ${en.event.status.next}`,
    );
  });

  it("uses the tile height tokens it reports for the column capacity", () => {
    const token = (name: string): number =>
      parseFloat(
        new RegExp(`${name}:\\s*([\\d.]+)rem`).exec(tokensCss)?.[1] ?? "NaN",
      );
    expect(TILE_HEIGHT_REM.large).toBe(token("--spacing-tile"));
    expect(TILE_HEIGHT_REM.compact).toBe(token("--spacing-tile-compact"));
    // Today shrinks large > medium > dense; dense still holds the 2.75rem emoji line
    // box inside the 4px edge on both sides (0.25rem each at the 16px baseline).
    expect(TILE_HEIGHT_REM.medium).toBeLessThan(TILE_HEIGHT_REM.large);
    expect(TILE_HEIGHT_REM.dense).toBeLessThan(TILE_HEIGHT_REM.medium);
    expect(TILE_HEIGHT_REM.dense).toBeGreaterThanOrEqual(2.75 + 2 * 0.25);
    // Slim keeps its 2.25rem disc (size-9) inside the 4px edge on both sides.
    expect(TILE_HEIGHT_REM.slim).toBeLessThan(TILE_HEIGHT_REM.dense);
    expect(TILE_HEIGHT_REM.slim).toBeGreaterThanOrEqual(2.25 + 2 * 0.25);
    expect(tileClasses("slim", false).disc).toBe("size-9");
    expect(TILE_HEIGHT_REM["compact-dense"]).toBeLessThan(
      TILE_HEIGHT_REM.compact,
    );
  });

  it("week sizes stack emoji, a title and the time, and keep the name", () => {
    render(
      <EventTile
        event={eventFixture({ childIds: ["mia"] })}
        childList={[MIA]}
        format={format}
        timeOfDay="midday"
        size="week"
      />,
    );
    expect(tile()).toHaveAttribute("data-size", "week");
    expect(tile().className).toContain("flex-col");
    // Up to two lines, broken at spaces and never hyphenated automatically; shown only
    // where the week column is wide enough.
    const title = within(tile()).getByTestId("tile-title");
    expect(title).toHaveTextContent("Swimming");
    expect(title).toHaveClass("line-clamp-2", "break-words");
    const line = title.parentElement as HTMLElement;
    expect(line).toHaveClass("hidden", "@min-[5.5rem]:block", "hyphens-manual");
    expect(line.className).not.toContain("hyphens-auto");
    expect(tile()).toHaveAccessibleName("Swimming, 2:30 PM, For Mia");
    const icon = within(tile()).getByText("🌞");
    // The time-of-day icon is as large as in the overview (>= 1.5rem).
    expect(icon).toHaveClass("text-[1.5rem]");
    // No disc on the narrow week tiles; the badges sit in their own grid column beside
    // the emoji (never on top of it, never pinned into the corner).
    expect(within(tile()).queryByTestId("emoji-disc")).toBeNull();
    const head = within(tile()).getByTestId("tile-head");
    expect(head).toHaveClass("grid", "grid-cols-[1fr_auto_1fr]", "gap-1");
    expect(head).toContainElement(badges());
    expect(badges().parentElement).toHaveClass("col-start-3");
    expect(badges().parentElement?.className).not.toContain("absolute");
    expect(within(head).getByText("🏊").parentElement).toHaveClass(
      "col-start-2",
    );
    // Emoji + two title lines (1.25 line height) + time row (1.5rem icon) + gaps, inside
    // the 4px edge on both sides.
    expect(TILE_HEIGHT_REM.week).toBeGreaterThanOrEqual(
      2.5 + 2 * 1.25 + 1.5 + 0.25 + 0.5,
    );
  });

  it("shrinks through dense and small stacked week tiles, each keeping a one-line title", () => {
    for (const size of ["week-dense", "week-small"] as const) {
      const { unmount } = render(
        <EventTile
          event={eventFixture()}
          childList={[]}
          format={format}
          timeOfDay="midday"
          size={size}
        />,
      );
      const title = within(tile()).getByTestId("tile-title");
      expect(title).toHaveTextContent("Swimming");
      expect(title).toHaveClass("block", "truncate");
      expect(tile()).toHaveAccessibleName("Swimming, 2:30 PM, For everyone");
      unmount();
    }
    expect(TILE_HEIGHT_REM["week-dense"]).toBeLessThan(TILE_HEIGHT_REM.week);
    expect(TILE_HEIGHT_REM["week-small"]).toBeLessThan(
      TILE_HEIGHT_REM["week-dense"],
    );
    // dense: emoji 2 + title 1.09 + time 1.5; small: emoji 1.75 + title 1.09 + time
    // 1.125 (rem), plus gaps and the 4px edge.
    expect(TILE_HEIGHT_REM["week-dense"]).toBeGreaterThanOrEqual(
      2 + 1.09 + 1.5 + 0.25 + 0.25,
    );
    expect(TILE_HEIGHT_REM["week-small"]).toBeGreaterThanOrEqual(
      1.75 + 1.09 + 1.125 + 0.25 + 0.5,
    );
  });

  it("slimmest week tile: small emoji with its time-of-day icon, title with badges, then the time", () => {
    render(
      <EventTile
        event={eventFixture({ childIds: ["mia"] })}
        childList={[MIA]}
        format={format}
        timeOfDay="midday"
        size="week-slim"
      />,
    );
    expect(tile()).toHaveAttribute("data-size", "week-slim");
    expect(tile().className).not.toContain("flex-col");
    const title = within(tile()).getByTestId("tile-title");
    expect(title).toHaveTextContent("Swimming");
    // Shown where the column leaves the text room for it.
    expect(title.parentElement).toHaveClass("hidden", "@min-[7rem]:block");
    // The badges end the title's row; the time-of-day icon sits on the emoji's corner.
    expect(title.parentElement?.parentElement).toContainElement(badges());
    const corner = within(tile()).getByTestId("tile-time-of-day");
    expect(corner).toHaveClass("absolute");
    expect(within(corner).getByText("🌞")).toBeInTheDocument();
    expect(within(tile()).getAllByText("🌞")).toHaveLength(1);
    expect(within(tile()).getByText("2:30 PM")).toBeInTheDocument();
    expect(tile()).toHaveAccessibleName("Swimming, 2:30 PM, For Mia");
    expect(TILE_HEIGHT_REM["week-slim"]).toBeLessThan(
      TILE_HEIGHT_REM["week-small"],
    );
    // Title row (1.25rem badge) + time row (1.09rem) inside the 4px edge.
    expect(TILE_HEIGHT_REM["week-slim"]).toBeGreaterThanOrEqual(
      1.25 + 1.09 + 0.5,
    );
  });

  it("slimmest week tile, all day: the icon alone in the time row, the badges there too", () => {
    render(
      <EventTile
        event={eventFixture({
          allDay: true,
          start: "2026-11-22",
          end: "2026-11-23",
          childIds: ["mia", "ben"],
        })}
        childList={[MIA, BEN]}
        format={format}
        size="week-slim"
      />,
    );
    // Too narrow for the word: it stays in the accessible name only.
    expect(within(tile()).queryByText("All day")).toBeNull();
    expect(tile()).toHaveAccessibleName("Swimming, All day, For Mia and Ben");
    const icon = within(tile()).getByTestId("all-day-icon");
    // The title's row keeps its width: the badges move to the time row.
    expect(icon.parentElement).toContainElement(badges());
    expect(
      within(tile()).getByTestId("tile-title").parentElement?.parentElement,
    ).not.toContainElement(badges());
  });

  it("cuts a long time label in a narrow week tile instead of pushing it out", () => {
    render(
      <EventTile
        event={eventFixture({
          allDay: true,
          start: "2026-11-22",
          end: "2026-11-23",
        })}
        childList={[]}
        format={format}
        size="week-small"
      />,
    );
    const label = within(tile()).getByText("All day");
    expect(label).toHaveClass("min-w-0", "truncate");
    // The row spans the tile, so truncation has a width to work with.
    expect(label.parentElement?.parentElement).toHaveClass("w-full", "min-w-0");
  });

  it("keeps a shared week tile's title clear of its stripes", () => {
    render(
      <EventTile
        event={eventFixture({ childIds: ["mia", "ben"] })}
        childList={[MIA, BEN]}
        format={format}
        size="week-dense"
      />,
    );
    const line = within(tile()).getByTestId("tile-title")
      .parentElement as HTMLElement;
    expect(line).toHaveClass("ps-2", "text-caption");
    expect(within(tile()).getByTestId("tile-stripes")).toBeInTheDocument();
  });

  it("renders an HTML-looking title as text, never as markup", () => {
    const evil = '<img src=x onerror="alert(1)"><b>hi</b>';
    const { container } = render(
      <EventTile
        event={eventFixture({ title: evil })}
        childList={[]}
        format={format}
      />,
    );
    expect(screen.getByText(evil)).toBeInTheDocument();
    expect(container.querySelector("img, b")).toBeNull();
  });

  it("does not let a hostile child colour inject styles or markup", () => {
    const hostile = { ...MIA, color: "red; background:url(x)" };
    render(
      <EventTile
        event={eventFixture({ childIds: ["mia"] })}
        childList={[hostile]}
        format={format}
      />,
    );
    expect(tile().style.getPropertyValue("--child-color")).toBe(
      "var(--color-border)",
    );
    expect(tile().style.background).toBe("var(--color-surface-raised)");
  });

  it("shows a continues hint instead of the original start for a continuing event", () => {
    render(
      <EventTile
        event={eventFixture({ start: "2026-11-21T20:00:00+01:00" })}
        childList={[]}
        format={format}
        continues
      />,
    );
    expect(screen.getByText(en.event.continues)).toBeInTheDocument();
    expect(screen.queryByText("8:00 PM")).toBeNull();
  });
});

describe("EventTile bring chips", () => {
  const BRING = ["👟", "🩱"];
  const ALL_SIZES: TileSize[] = [
    "large",
    "medium",
    "dense",
    "slim",
    "compact",
    "compact-dense",
    "week",
    "week-dense",
    "week-small",
    "week-slim",
  ];
  const TODAY_SIZES: TileSize[] = ["large", "medium", "dense", "slim"];

  it.each(ALL_SIZES)(
    "%s: shows the bring list as decorative chips and one accessible description",
    (size) => {
      render(
        <EventTile
          event={eventFixture({ childIds: ["mia"], bring: BRING })}
          childList={[MIA]}
          format={format}
          timeOfDay="midday"
          size={size}
        />,
      );
      const article = screen.getByRole("article", {
        name: "Swimming, 2:30 PM, For Mia",
      });
      // One description listing every icon; the chips themselves are hidden.
      expect(article).toHaveAccessibleDescription("Bring along: 👟 🩱");
      const area = within(article).getByTestId("bring-chips");
      expect(area).toHaveAttribute("aria-hidden", "true");
      expect(
        within(area)
          .getAllByTestId("bring-chip")
          .map((chip) => chip.textContent),
      ).toEqual(BRING);
      // Today's tiles keep their height (chips in the time row); the narrow ones grow
      // by their chip row, exactly what the capacity steps count.
      if (TODAY_SIZES.includes(size)) {
        expect(BRING_EXTRA_REM[size]).toBe(0);
        expect(article).toHaveAttribute("data-bring", "inline");
        expect(article.style.height).toBe("");
      } else {
        expect(BRING_EXTRA_REM[size]).toBeGreaterThan(0);
        expect(article).toHaveAttribute("data-bring", "row");
        expect(article.style.height).toBe(
          `${String(TILE_HEIGHT_REM[size] + BRING_EXTRA_REM[size])}rem`,
        );
        expect(within(article).getByTestId("bring-row")).toContainElement(area);
      }
    },
  );

  it("today's sizes put the chips at the end of the time row (slim: of its one row)", () => {
    render(
      <EventTile
        event={eventFixture({ bring: BRING })}
        childList={[]}
        format={format}
        timeOfDay="midday"
        size="large"
      />,
    );
    const area = screen.getByTestId("bring-chips");
    expect(area.parentElement).toContainElement(screen.getByText("2:30 PM"));
    expect(area).toHaveClass("ms-auto", "justify-end");
  });

  it("describes the list in German too", async () => {
    const { default: i18n } = await import("i18next");
    await i18n.changeLanguage("de");
    try {
      render(
        <EventTile
          event={eventFixture({ bring: BRING })}
          childList={[]}
          format={{ locale: "de", timeZone: "Europe/Berlin" }}
        />,
      );
      expect(screen.getByRole("article")).toHaveAccessibleDescription(
        de.event.bring.replace("{{icons}}", "👟 🩱"),
      );
      expect(de.event.bring).toBe("Mitbringen: {{icons}}");
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it.each(["compact", "compact-dense", "week-slim"] as const)(
    "%s with a chip row: the title keeps the whole width, the badges end the chip row, padding keeps it off the edge",
    (size) => {
      render(
        <EventTile
          event={eventFixture({ childIds: ["mia", "ben"], bring: BRING })}
          childList={[MIA, BEN]}
          format={format}
          timeOfDay="midday"
          size={size}
        />,
      );
      const row = screen.getByTestId("bring-row");
      // Badges at the end of the chip row, after the chips, never beside the title.
      expect(within(row).getByTestId("row-badges")).toContainElement(badges());
      expect(screen.getAllByTestId("child-badges")).toHaveLength(1);
      expect(screen.queryByTestId("badge-float")).toBeNull();
      const main = screen.getByTestId("tile-main");
      expect(main).not.toContainElement(badges());
      expect(main).toContainElement(screen.getByTestId("tile-title"));
      expect(main.compareDocumentPosition(row)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      // A column with vertical padding; the chip row clears the shared tile's stripes.
      expect(tile().className).toMatch(/\bflex-col\b/u);
      expect(tile().className).toMatch(/\b(py|pt)-/u);
      expect(row).toHaveClass("ps-2.5");
      // 28px chips, except the slimmest week tile (24px, see TILE_CHIP_SIZE).
      const chip = within(row).getAllByTestId("bring-chip")[0];
      expect(chip).toHaveClass(size === "week-slim" ? "size-6" : "size-7");
    },
  );

  it("stacked week tiles keep the badges beside the emoji and get 28px chips", () => {
    for (const size of ["week", "week-dense", "week-small"] as const) {
      const { unmount } = render(
        <EventTile
          event={eventFixture({ childIds: ["mia"], bring: BRING })}
          childList={[MIA]}
          format={format}
          size={size}
        />,
      );
      expect(screen.getByTestId("tile-head")).toContainElement(badges());
      expect(screen.queryByTestId("row-badges")).toBeNull();
      expect(screen.getAllByTestId("bring-chip")[0]).toHaveClass("size-7");
      unmount();
    }
  });

  it("the narrow sizes' chips are 28px (size-7) where the tile is wide enough, today's 24px", () => {
    expect(TILE_CHIP_SIZE.compact).toBe("large");
    expect(TILE_CHIP_SIZE["compact-dense"]).toBe("large");
    expect(TILE_CHIP_SIZE.week).toBe("large");
    expect(TILE_CHIP_SIZE["week-dense"]).toBe("large");
    expect(TILE_CHIP_SIZE["week-small"]).toBe("large");
    expect(TILE_CHIP_SIZE["week-slim"]).toBe("regular");
    for (const size of ["large", "medium", "dense", "slim"] as const) {
      expect(TILE_CHIP_SIZE[size]).toBe("regular");
    }
    // A chip row is at least as tall as its chips (1.75rem / 1.5rem) plus a gap.
    for (const size of [
      "compact",
      "compact-dense",
      "week",
      "week-dense",
      "week-small",
    ] as const) {
      expect(BRING_EXTRA_REM[size]).toBeGreaterThanOrEqual(1.75 - 0.5);
    }
  });

  it("past tiles show no chips, no description and keep their height", () => {
    for (const size of ["large", "compact", "week"] as const) {
      const { unmount } = render(
        <EventTile
          event={eventFixture({ bring: BRING })}
          childList={[]}
          format={format}
          status="past"
          size={size}
        />,
      );
      expect(screen.queryByTestId("bring-chips")).toBeNull();
      expect(tile()).not.toHaveAttribute("aria-describedby");
      expect(tile()).not.toHaveAttribute("data-bring");
      expect(tile().style.height).toBe("");
      unmount();
    }
  });

  it("no list, an empty list: no chips, no description, no extra height", () => {
    for (const bring of [undefined, []]) {
      const { unmount } = render(
        <EventTile
          event={eventFixture(bring === undefined ? {} : { bring })}
          childList={[]}
          format={format}
          size="week"
        />,
      );
      expect(screen.queryByTestId("bring-chips")).toBeNull();
      expect(tile()).not.toHaveAttribute("aria-describedby");
      expect(tile().style.height).toBe("");
      unmount();
    }
  });

  it("showsBring: a non-empty list on a tile that is not over yet", () => {
    const statuses: EventStatus[] = ["upcoming", "current", "past"];
    expect(
      statuses.map((status) =>
        showsBring(eventFixture({ bring: BRING }), status),
      ),
    ).toEqual([true, true, false]);
    expect(showsBring(eventFixture({ bring: [] }), "upcoming")).toBe(false);
    expect(showsBring(eventFixture(), "upcoming")).toBe(false);
  });

  it("leaves the now / next cues, the child tint and the badges unchanged", () => {
    const states = [
      { status: "current" as const, next: false, cue: "now-cue" },
      { status: "upcoming" as const, next: true, cue: "next-cue" },
    ];
    for (const { status, next, cue } of states) {
      const looks = [undefined, BRING].map((bring) => {
        const { unmount } = render(
          <EventTile
            event={eventFixture({
              childIds: ["mia"],
              ...(bring === undefined ? {} : { bring }),
            })}
            childList={[MIA]}
            format={format}
            status={status}
            next={next}
            size="large"
          />,
        );
        const look = {
          className: tile().className,
          tint: tile().getAttribute("data-tint"),
          background: tile().style.background,
          edge: tile().style.getPropertyValue("--child-color"),
          badges: badges().innerHTML,
          cue: screen.getByTestId(cue).className,
        };
        unmount();
        return look;
      });
      expect(looks[1]).toEqual(looks[0]);
    }
  });

  it("renders an XSS-looking title together with a bring list as text", () => {
    const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const { container } = render(
      <EventTile
        event={eventFixture({ title: evil, bring: ["🩱", "🧴", "🥽"] })}
        childList={[MIA]}
        format={format}
        size="compact"
      />,
    );
    expect(screen.getByText(evil)).toBeInTheDocument();
    expect(container.querySelector("img, script")).toBeNull();
    expect(screen.getAllByTestId("bring-chip")).toHaveLength(3);
    expect(tile()).toHaveAccessibleDescription("Bring along: 🩱 🧴 🥽");
    expect(tile()).toHaveAccessibleName(`${evil}, 2:30 PM, For everyone`);
  });
});
