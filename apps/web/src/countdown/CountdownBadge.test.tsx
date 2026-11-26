import type { CalendarEvent } from "@kidboard/shared";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BEN, eventFixture, MIA } from "../components/fixtures.test-utils";
import { applyLocale } from "../i18n";
import type { Countdown } from "./buildCountdown";
import {
  CountdownBadge,
  MAX_INDIVIDUAL_MOONS,
  moonRows,
} from "./CountdownBadge";

const MOON = "🌙";

function party(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return eventFixture({
    id: "party",
    title: "Birthday party",
    icon: "🎂",
    countdown: true,
    ...overrides,
  });
}

function renderBadge(
  nights: number,
  events: CalendarEvent[] = [party()],
): HTMLElement {
  const countdown: Countdown = { date: "2026-11-25", nights, events };
  render(<CountdownBadge countdown={countdown} />);
  return screen.getByRole("region", { name: /How many sleeps|Wie oft/ });
}

/** Visible moon symbols (each one an emoji element). */
function moonCount(badge: HTMLElement): number {
  return [...badge.querySelectorAll(".font-emoji")].filter(
    (el) => el.textContent === MOON,
  ).length;
}

afterEach(() => {
  act(() => {
    applyLocale("en");
  });
});

describe("moonRows", () => {
  it("splits nights into rows of a week", () => {
    expect(moonRows(0)).toEqual([]);
    expect(moonRows(1)).toEqual([1]);
    expect(moonRows(7)).toEqual([7]);
    expect(moonRows(10)).toEqual([7, 3]);
    expect(moonRows(14)).toEqual([7, 7]);
  });
});

describe("CountdownBadge", () => {
  it("shows one moon per night up to 14, with a pluralized label", () => {
    const one = renderBadge(1);
    expect(moonCount(one)).toBe(1);
    expect(one).toHaveTextContent("1 more sleep until Birthday party");
    expect(one).toHaveAttribute("data-nights", "1");
    cleanup();

    const three = renderBadge(3);
    expect(moonCount(three)).toBe(3);
    expect(three).toHaveTextContent("3 more sleeps until Birthday party");
    cleanup();

    const max = renderBadge(MAX_INDIVIDUAL_MOONS);
    expect(moonCount(max)).toBe(14);
    expect(max.querySelector('[data-testid="countdown-grouped"]')).toBeNull();
  });

  it("groups beyond 14 nights: the number and one moon", () => {
    const badge = renderBadge(15);
    expect(moonCount(badge)).toBe(1);
    expect(screen.getByTestId("countdown-grouped")).toBeInTheDocument();
    expect(screen.getByTestId("countdown-count")).toHaveTextContent("15 ×");
    expect(badge).toHaveTextContent("15 more sleeps until Birthday party");
    cleanup();
    renderBadge(30, [party()]);
    expect(screen.getByTestId("countdown-count")).toHaveTextContent("30 ×");
  });

  it("reads from start to goal: number, moons, arrow, the goal's icon and short name", () => {
    const badge = renderBadge(6);
    const order = [
      "countdown-count",
      "countdown-arrow",
      "countdown-target",
      "countdown-name",
    ].map((id) => within(badge).getByTestId(id));
    const firstMoon = [...badge.querySelectorAll(".font-emoji")].find(
      (el) => el.textContent === MOON,
    );
    const sequence = [order[0], firstMoon, ...order.slice(1)];
    for (let i = 1; i < sequence.length; i += 1) {
      const before = sequence[i - 1] as Element;
      const after = sequence[i] as Element;
      expect(
        before.compareDocumentPosition(after) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(within(badge).getByTestId("countdown-count")).toHaveTextContent(
      /^6 ×$/u,
    );
    const name = within(badge).getByTestId("countdown-name");
    expect(name).toHaveTextContent("Birthday party");
    // One line, cut short when long; decorative (the label reads the full titles).
    expect(name).toHaveClass("truncate");
    expect(name).toHaveAttribute("aria-hidden", "true");
  });

  it("is as high as the name chips (h-16)", () => {
    expect(renderBadge(14, [party()])).toHaveClass("h-16");
  });

  it("draws 8 to 14 moons in two smaller rows so they fit the pill", () => {
    const badge = renderBadge(14);
    const moons = [...badge.querySelectorAll(".font-emoji")].filter(
      (el) => el.textContent === MOON,
    );
    expect(moons).toHaveLength(14);
    for (const moon of moons) expect(moon).toHaveClass("text-title");
    cleanup();
    const week = renderBadge(7);
    for (const moon of [...week.querySelectorAll(".font-emoji")].filter(
      (el) => el.textContent === MOON,
    )) {
      expect(moon).toHaveClass("text-heading");
    }
  });

  it("shows the today state without moons but with a pictorial 🎉 cue", () => {
    const badge = renderBadge(0, [party()]);
    expect(moonCount(badge)).toBe(0);
    expect(badge).toHaveTextContent("Today!");
    expect(badge).toHaveTextContent("Today is the day: Birthday party!");
    const cue = screen.getByTestId("countdown-today");
    expect(cue).toHaveTextContent("🎉");
    // A picture for children, decorative for assistive tech (the label says it).
    expect(cue.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("has no 🎉 cue while nights are left", () => {
    renderBadge(1);
    expect(screen.queryByTestId("countdown-today")).toBeNull();
    expect(screen.queryByText("🎉")).toBeNull();
  });

  it("names several events of the same day as a localized list, at most 3 icons", () => {
    const events = [
      party({ id: "a", title: "Advent", icon: "🎄" }),
      party({ id: "b", title: "Birthday", icon: "🎂" }),
      party({ id: "c", title: "Cinema", icon: "🎉" }),
      party({ id: "d", title: "Doughnuts", icon: "🎁" }),
    ];
    const badge = renderBadge(2, events);
    expect(badge).toHaveTextContent(
      "2 more sleeps until Advent, Birthday, Cinema, and Doughnuts",
    );
    expect(
      within(badge)
        .getAllByTestId("countdown-target")
        .map((icon) => icon.textContent),
    ).toEqual(["🎄", "🎂", "🎉"]);
    // The short name is the first event's title.
    expect(within(badge).getByTestId("countdown-name")).toHaveTextContent(
      /^Advent$/u,
    );
  });

  it("hides the visuals from assistive tech; only the label is read", () => {
    const badge = renderBadge(5);
    const label = badge.querySelector("p.sr-only");
    expect(label).toHaveTextContent("5 more sleeps until Birthday party");
    for (const child of badge.children) {
      if (child !== label) {
        expect(child).toHaveAttribute("aria-hidden", "true");
      }
    }
    // Plain text: markup in a title is rendered as text, never as HTML.
    cleanup();
    const evil = renderBadge(2, [party({ title: "<b>x</b>" })]);
    expect(evil.querySelector("b")).toBeNull();
    expect(evil).toHaveTextContent("2 more sleeps until <b>x</b>");
  });

  it("uses German plural rules and list formatting", () => {
    act(() => {
      applyLocale("de");
    });
    const one = renderBadge(1);
    expect(one).toHaveAccessibleName("Wie oft noch schlafen?");
    expect(one).toHaveTextContent("Noch einmal schlafen bis Birthday party");
    cleanup();
    const many = renderBadge(4, [
      party({ id: "a", title: "Nikolaus" }),
      party({ id: "b", title: "Kino" }),
    ]);
    expect(many).toHaveTextContent("Noch 4 Mal schlafen bis Nikolaus und Kino");
    cleanup();
    expect(renderBadge(0)).toHaveTextContent(
      "Heute ist es so weit: Birthday party!",
    );
  });

  it("has one size in both views: title-sized event icon, body-sized name", () => {
    const badge = renderBadge(2, [party()]);
    expect(badge).not.toHaveAttribute("data-variant");
    const icon = [...badge.querySelectorAll(".font-emoji")].find(
      (el) => el.textContent === "🎂",
    );
    expect(icon).toHaveClass("text-title");
    expect(within(badge).getByTestId("countdown-name")).toHaveClass(
      "text-body",
    );
  });

  it("draws the moons large (heading size), not body size", () => {
    const compact = renderBadge(3, [party()]);
    const moonEls = [...compact.querySelectorAll(".font-emoji")].filter(
      (el) => el.textContent === MOON,
    );
    expect(moonEls).toHaveLength(3);
    for (const el of moonEls) {
      expect(el).toHaveClass("text-heading");
      expect(el).not.toHaveClass("text-body");
    }
    cleanup();
    // Grouped (> 14 nights) uses the same moon size.
    renderBadge(20, [party()]);
    const grouped = screen.getByTestId("countdown-grouped");
    expect(grouped.querySelector(".font-emoji")).toHaveClass("text-heading");
  });

  it("puts the awaited event in its child's tint and edge (neutral without a child)", () => {
    const countdown: Countdown = {
      date: "2026-11-25",
      nights: 3,
      events: [
        party({ childIds: ["mia"] }),
        party({ id: "fair", icon: "🎡", childIds: [] }),
      ],
    };
    render(<CountdownBadge countdown={countdown} childList={[MIA, BEN]} />);
    const [mine, everyone] = screen.getAllByTestId("countdown-target");
    expect(mine).toHaveAttribute("data-tint", "single");
    expect(mine?.style.background).toBe("var(--color-child-1-tint)");
    expect(mine?.style.getPropertyValue("--child-color")).toBe(
      "var(--color-child-1)",
    );
    expect(mine).toHaveClass("inset-ring-(color:--child-color)");
    expect(everyone).toHaveAttribute("data-tint", "none");
    expect(everyone).toHaveClass("inset-ring-border");
  });

  it("marks the 0-night state with the today ring besides 🎉", () => {
    const badge = renderBadge(0);
    expect(badge).toHaveClass("ring-today-ring");
    cleanup();
    expect(renderBadge(2)).not.toHaveClass("ring-today-ring");
  });
});
