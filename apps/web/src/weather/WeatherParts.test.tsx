import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EMOJI_NIGHT_DIM } from "../components/Emoji";
import { applyLocale } from "../i18n";
import type { ClothingRowModel, DayWeather } from "./buildBoardWeather";
import { ClothingIcon } from "./ClothingIcon";
import { CLOTHING_ICON_STEPS, ClothingRow } from "./ClothingRow";
import { FIT_PLANS } from "./TodayWeatherHead";
import { NowChip, temperatureText, WeatherChip } from "./WeatherChip";

const TODAY: DayWeather = {
  date: "2026-11-22",
  icon: "☀️",
  kind: "clear",
  high: 12,
  current: 8,
};
const RAINY: DayWeather = {
  date: "2026-11-23",
  icon: "🌧️",
  kind: "rain",
  high: 7,
};

afterEach(() => {
  applyLocale("en");
});

describe("temperatureText", () => {
  it("uses the real minus sign for negative values only", () => {
    expect(temperatureText(-3)).toBe("−3");
    expect(temperatureText(-12)).toBe("−12");
    expect(temperatureText(0)).toBe("0");
    expect(temperatureText(7)).toBe("7");
    expect(temperatureText(-3)).not.toContain("-");
  });
});

describe("WeatherChip", () => {
  it("today's overview chip: one image with kind, current temperature and high", () => {
    const { rerender } = render(
      <WeatherChip day={TODAY} size="today" showCurrent />,
    );
    const chip = screen.getByRole("img", {
      name: "Sunny, now 8 degrees, high 12 degrees",
    });
    // Shows the current temperature; the icon and number are decorative parts.
    expect(chip).toHaveTextContent("☀️8°");
    expect(within(chip).queryAllByRole("img")).toHaveLength(0);
    applyLocale("de");
    rerender(<WeatherChip day={TODAY} size="today" showCurrent />);
    expect(
      screen.getByRole("img", { name: "Sonnig, jetzt 8 Grad, bis 12 Grad" }),
    ).toBeInTheDocument();
  });

  it("without showCurrent shows and says the high, also for today (week view)", () => {
    render(<WeatherChip day={TODAY} size="week" />);
    expect(
      screen.getByRole("img", { name: "Sunny, high 12 degrees" }),
    ).toHaveTextContent("☀️12°");
  });

  it("sits in the weather pill (page surface and hairline)", () => {
    render(<WeatherChip day={RAINY} size="day" />);
    const chip = screen.getByTestId("weather-chip");
    expect(chip).toHaveClass("rounded-pill", "bg-surface", "inset-ring-border");
  });

  it("shows the high on other days, with singular and negative degrees", () => {
    const { rerender } = render(<WeatherChip day={RAINY} size="day" />);
    const chip = screen.getByRole("img", { name: "Rain, high 7 degrees" });
    expect(chip).toHaveTextContent("🌧️7°");
    rerender(
      <WeatherChip
        day={{ ...RAINY, kind: "snow", icon: "❄️", high: 1 }}
        size="day"
      />,
    );
    expect(
      screen.getByRole("img", { name: "Snow, high 1 degree" }),
    ).toHaveTextContent("1°");
    rerender(
      <WeatherChip
        day={{ ...RAINY, kind: "snow", icon: "❄️", high: -3 }}
        size="day"
      />,
    );
    // Visible text with U+2212; the name stays "-3 degrees" (read as "minus 3").
    const cold = screen.getByRole("img", { name: "Snow, high -3 degrees" });
    expect(cold).toHaveTextContent("❄️−3°");
    expect(cold.textContent).not.toContain("-");
    applyLocale("de");
    rerender(<WeatherChip day={RAINY} size="day" />);
    expect(
      screen.getByRole("img", { name: "Regen, bis 7 Grad" }),
    ).toBeInTheDocument();
  });

  it("can be purely decorative", () => {
    render(<WeatherChip day={RAINY} size="week" decorative />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByTestId("weather-chip")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});

describe("NowChip", () => {
  it("shows only a thermometer and the current temperature, never a day icon", () => {
    const { rerender } = render(<NowChip date="2026-11-22" temperature={8} />);
    const chip = screen.getByRole("img", { name: "Now 8 degrees" });
    expect(chip).toHaveTextContent("🌡️8°");
    expect(chip).toHaveAttribute("data-kind", "now");
    expect(chip.textContent).not.toMatch(/☀️|🌤️|⛅|🌙/u);
    rerender(<NowChip date="2026-11-22" temperature={-2} />);
    expect(
      screen.getByRole("img", { name: "Now -2 degrees" }),
    ).toHaveTextContent("🌡️−2°");
    applyLocale("de");
    rerender(<NowChip date="2026-11-22" temperature={8} />);
    expect(
      screen.getByRole("img", { name: "Jetzt 8 Grad" }),
    ).toBeInTheDocument();
  });
});

describe("ClothingIcon", () => {
  it("draws emoji items through <Emoji> and the hat and sweater as pictograms", () => {
    const { container, rerender } = render(
      <ClothingIcon item={{ key: "jacket", emoji: "🧥" }} className="x-size" />,
    );
    const emoji = container.querySelector(".font-emoji");
    expect(emoji).toHaveTextContent("🧥");
    expect(emoji).toHaveAttribute("aria-hidden", "true");
    expect(emoji).toHaveClass("x-size");
    expect(container.querySelector("svg")).toBeNull();

    for (const key of ["hat", "sweater"] as const) {
      rerender(<ClothingIcon item={{ key }} className="x-size" />);
      const pictogram = screen.getByTestId("clothing-pictogram");
      expect(pictogram).toHaveAttribute("data-key", key);
      expect(pictogram).toHaveAttribute("aria-hidden", "true");
      // Sized by the font size like an emoji, dimmed at night like an emoji.
      expect(pictogram).toHaveClass("x-size", ...EMOJI_NIGHT_DIM.split(" "));
      const svg = pictogram.querySelector("svg");
      expect(svg).toHaveAttribute("width", "1em");
      expect(svg).toHaveAttribute("height", "1em");
      // Colours only through the wear tokens, never raw values.
      const painted = [...pictogram.querySelectorAll("path, rect, circle")];
      expect(painted.length).toBeGreaterThan(3);
      for (const part of painted) {
        expect(part.getAttribute("class")).toMatch(
          /(^| )(fill|stroke)-wear-[a-z-]+/,
        );
        expect(part.getAttribute("fill") ?? "none").toBe("none");
        expect(part.getAttribute("stroke")).toBeNull();
      }
      expect(pictogram.textContent).toBe("");
    }
  });
});

const MORNING: ClothingRowModel = {
  when: "today",
  date: "2026-11-22",
  items: [
    { key: "jacket", emoji: "🧥" },
    { key: "hat" },
    { key: "scarf", emoji: "🧣" },
  ],
};
const EVENING: ClothingRowModel = {
  when: "tomorrow",
  date: "2026-11-23",
  forecast: RAINY,
  items: [
    { key: "umbrella", emoji: "🌂" },
    { key: "rainBoots", emoji: "👢" },
    { key: "jacket", emoji: "🧥" },
  ],
};

describe("ClothingRow", () => {
  it("is a labelled list of today's clothes without a lead", () => {
    const { rerender } = render(<ClothingRow row={MORNING} />);
    const list = screen.getByRole("list", {
      name: "Wear today: jacket, warm hat, and scarf",
    });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.dataset["key"])).toEqual([
      "jacket",
      "hat",
      "scarf",
    ]);
    expect(items.map((item) => item.textContent)).toEqual(["🧥", "", "🧣"]);
    // Every item is named, also the drawn hat.
    expect(within(list).getByRole("img", { name: "scarf" })).toHaveTextContent(
      "🧣",
    );
    expect(
      within(list)
        .getByRole("img", { name: "warm hat" })
        .querySelector("[data-testid=clothing-pictogram]"),
    ).not.toBeNull();
    expect(screen.queryByTestId("clothing-arrow")).toBeNull();
    expect(screen.queryByTestId("clothing-lead")).toBeNull();
    // Not a live region, nothing to press.
    expect(screen.getByTestId("clothing-row")).not.toHaveAttribute("aria-live");
    expect(screen.queryByRole("button")).toBeNull();
    applyLocale("de");
    rerender(<ClothingRow row={MORNING} />);
    expect(
      screen.getByRole("list", {
        name: "Heute anziehen: Jacke, Mütze und Schal",
      }),
    ).toBeInTheDocument();
  });

  it("in the evening leads with tomorrow's weather and says it in the name", () => {
    const { rerender } = render(<ClothingRow row={EVENING} />);
    expect(
      screen.getByRole("list", {
        name: "Tomorrow: Rain, high 7 degrees. Wear: umbrella, rain boots, and jacket",
      }),
    ).toBeInTheDocument();
    const lead = screen.getByTestId("clothing-lead");
    expect(lead).toHaveAttribute("aria-hidden", "true");
    expect(within(lead).getByTestId("clothing-arrow")).toBeInTheDocument();
    expect(screen.getByTestId("clothing-forecast")).toHaveTextContent("🌧️7°");
    expect(screen.getByTestId("clothing-forecast")).toHaveAttribute(
      "data-kind",
      "rain",
    );
    // No weekday text: the 🎒 area carries the day.
    expect(screen.queryByTestId("clothing-day")).toBeNull();
    expect(screen.getByTestId("clothing-row").textContent).toBe("🌧️7°🌂👢🧥");
    applyLocale("de");
    rerender(<ClothingRow row={EVENING} />);
    expect(
      screen.getByRole("list", {
        name: "Morgen: Regen, bis 7 Grad. Anziehen: Regenschirm, Gummistiefel und Jacke",
      }),
    ).toBeInTheDocument();
  });

  it("shows a frosty tomorrow with the real minus sign", () => {
    render(
      <ClothingRow
        row={{
          ...EVENING,
          forecast: { ...RAINY, kind: "snow", icon: "❄️", high: -4 },
        }}
      />,
    );
    expect(screen.getByTestId("clothing-forecast")).toHaveTextContent("❄️−4°");
    expect(
      screen.getByRole("list", { name: /^Tomorrow: Snow, high -4 degrees\./u }),
    ).toBeInTheDocument();
  });

  it("sizes every icon by the given step (2rem by default)", () => {
    const { rerender } = render(<ClothingRow row={MORNING} />);
    const row = screen.getByTestId("clothing-row");
    expect(row).toHaveAttribute("data-icon-rem", "2");
    expect(row.querySelectorAll(".text-\\[2rem\\]")).toHaveLength(3);
    const smallest = CLOTHING_ICON_STEPS[CLOTHING_ICON_STEPS.length - 1];
    if (smallest === undefined) throw new Error("no step");
    rerender(<ClothingRow row={EVENING} step={smallest} />);
    expect(screen.getByTestId("clothing-row")).toHaveAttribute(
      "data-icon-rem",
      "1.5",
    );
    // Three items and the lead's weather icon.
    expect(
      screen
        .getByTestId("clothing-row")
        .querySelectorAll(".text-\\[1\\.5rem\\]"),
    ).toHaveLength(4);
  });

  it("never uses the bag or the moon", () => {
    render(<ClothingRow row={EVENING} />);
    expect(screen.getByTestId("clothing-row").textContent).not.toMatch(
      /🎒|🌙/u,
    );
  });
});

describe("FIT_PLANS (today's heading row, one line)", () => {
  const sizes = (plan: (typeof FIT_PLANS)["today"]): string[] =>
    plan.map(
      (step) =>
        `${String(CLOTHING_ICON_STEPS[step.icons]?.rem)}${step.chip ? "+chip" : ""}`,
    );

  it("evening: 2rem, 1.75rem, then without the 'now' chip, then 1.5rem", () => {
    expect(sizes(FIT_PLANS.tomorrow)).toEqual([
      "2+chip",
      "1.75+chip",
      "1.75",
      "1.5",
    ]);
  });

  it("morning: today's chip stays down to 1.5rem and gives way last", () => {
    expect(sizes(FIT_PLANS.today)).toEqual([
      "2+chip",
      "1.75+chip",
      "1.5+chip",
      "1.5",
    ]);
  });
});
