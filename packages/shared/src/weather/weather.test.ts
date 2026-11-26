import { describe, expect, it } from "vitest";

import {
  CLOTHING_EMOJI,
  CLOTHING_KEYS,
  CLOTHING_MAX_ITEMS,
  clothingFor,
  CUSTOM_CLOTHING_KEYS,
  isCustomClothingKey,
} from "./clothingFor";
import { type WeatherDay, WeatherResponseSchema } from "./schema";
import { weatherIcon, weatherKind } from "./weatherIcon";

const mild: WeatherDay = {
  date: "2026-05-04",
  code: 3,
  tempMax: 16,
  tempMin: 10,
  feelsMin: 14,
  feelsMax: 16,
  rain: false,
  snow: false,
  uvMax: 1,
};

function keys(
  day: Partial<WeatherDay>,
  unit: "celsius" | "fahrenheit" = "celsius",
): string[] {
  return clothingFor({ ...mild, ...day }, unit).map((i) => i.key);
}

describe("weatherIcon / weatherKind", () => {
  it.each([
    [0, "☀️", "clear"],
    [1, "🌤️", "mostlyClear"],
    [2, "⛅", "partlyCloudy"],
    [3, "☁️", "cloudy"],
    [45, "🌫️", "fog"],
    [48, "🌫️", "fog"],
    [51, "🌦️", "drizzle"],
    [53, "🌦️", "drizzle"],
    [55, "🌦️", "drizzle"],
    [56, "🌦️", "drizzle"],
    [57, "🌦️", "drizzle"],
    [61, "🌧️", "rain"],
    [63, "🌧️", "rain"],
    [65, "🌧️", "rain"],
    [66, "🌧️", "rain"],
    [67, "🌧️", "rain"],
    [71, "❄️", "snow"],
    [73, "❄️", "snow"],
    [75, "❄️", "snow"],
    [77, "❄️", "snow"],
    [80, "🌧️", "rain"],
    [81, "🌧️", "rain"],
    [82, "🌧️", "rain"],
    [85, "❄️", "snow"],
    [86, "❄️", "snow"],
    [95, "⛈️", "thunder"],
    [96, "⛈️", "thunder"],
    [99, "⛈️", "thunder"],
  ])("code %i -> %s (%s)", (code, icon, kind) => {
    expect(weatherIcon(code)).toBe(icon);
    expect(weatherKind(code)).toBe(kind);
  });

  it("tells snow apart from rain", () => {
    expect(weatherIcon(73)).not.toBe(weatherIcon(63));
    expect(weatherIcon(85)).toBe("❄️");
  });

  it("maps unknown codes to a cloud and never to a moon", () => {
    for (const code of [-1, 4, 44, 58, 100, 1.5, Number.NaN]) {
      expect(weatherIcon(code)).toBe("☁️");
      expect(weatherKind(code)).toBe("cloudy");
    }
    for (let code = 0; code <= 99; code += 1) {
      expect(weatherIcon(code)).not.toBe("🌙");
    }
  });
});

describe("clothingFor thresholds (celsius)", () => {
  it("jacket below 14, not at 14", () => {
    expect(keys({ feelsMin: 13.9 })).toContain("jacket");
    expect(keys({ feelsMin: 14 })).not.toContain("jacket");
  });
  it("hat below 8, not at 8", () => {
    expect(keys({ feelsMin: 7.9 })).toContain("hat");
    expect(keys({ feelsMin: 8 })).not.toContain("hat");
  });
  it("scarf below 5, not at 5", () => {
    expect(keys({ feelsMin: 4.9 })).toContain("scarf");
    expect(keys({ feelsMin: 5 })).not.toContain("scarf");
  });
  it("gloves below 3 or with snow, not at 3", () => {
    expect(keys({ feelsMin: 2.9 })).toContain("gloves");
    expect(keys({ feelsMin: 3 })).not.toContain("gloves");
    expect(keys({ feelsMin: 3, snow: true })).toContain("gloves");
  });
  it("sweater from 14 to below 18, never with the jacket", () => {
    expect(keys({ feelsMin: 13.9 })).not.toContain("sweater");
    expect(keys({ feelsMin: 14 })).toEqual(["sweater"]);
    expect(keys({ feelsMin: 17.9, feelsMax: 19 })).toEqual(["sweater"]);
    expect(keys({ feelsMin: 18, feelsMax: 19 })).toEqual([]);
  });
  it("T-shirt from 22, shorts from 24", () => {
    expect(keys({ feelsMin: 18, feelsMax: 21.9 })).not.toContain("tshirt");
    expect(keys({ feelsMin: 18, feelsMax: 22 })).toContain("tshirt");
    expect(keys({ feelsMin: 18, feelsMax: 22 })).not.toContain("shorts");
    expect(keys({ feelsMin: 18, feelsMax: 23.9 })).not.toContain("shorts");
    expect(keys({ feelsMin: 18, feelsMax: 24 })).toContain("shorts");
  });
  it("rain gives the closed umbrella, and rain boots only below 20", () => {
    const wet = { rain: true, feelsMin: 18 };
    expect(keys({ ...wet, feelsMax: 19.9 })).toEqual(["umbrella", "rainBoots"]);
    expect(keys({ ...wet, feelsMax: 20 })).toEqual(["umbrella"]);
    // A summer storm: no boots, no sun items.
    expect(keys({ ...wet, code: 95, feelsMax: 30, uvMax: 7 })).toEqual([
      "umbrella",
      "tshirt",
      "shorts",
    ]);
    expect(clothingFor({ ...mild, rain: true })[0]).toEqual({
      key: "umbrella",
      emoji: "🌂",
    });
  });
  it("snow gives winter boots and gloves, and wins over rain boots", () => {
    expect(keys({ snow: true, feelsMin: 18 })).toEqual([
      "winterBoots",
      "gloves",
    ]);
    expect(keys({ snow: true, rain: true, feelsMin: 18 })).toEqual([
      "umbrella",
      "winterBoots",
      "gloves",
    ]);
  });
  it("cap needs a sunny code, UV >= 3 and feelsMax >= 15", () => {
    const sunny = { code: 1, uvMax: 3, feelsMin: 18, feelsMax: 15 };
    expect(keys(sunny)).toContain("cap");
    expect(keys({ ...sunny, uvMax: 2.9 })).not.toContain("cap");
    expect(keys({ ...sunny, feelsMax: 14.9 })).not.toContain("cap");
    expect(keys({ ...sunny, code: 3 })).not.toContain("cap");
    expect(keys({ ...sunny, code: 2 })).toContain("cap");
  });
  it("sunscreen from UV 4 on sunny codes only", () => {
    const sunny = { code: 0, feelsMin: 18 };
    expect(keys({ ...sunny, uvMax: 3.9 })).not.toContain("sunscreen");
    expect(keys({ ...sunny, uvMax: 4 })).toContain("sunscreen");
    // A cool bright day: sunscreen, but no cap below 15.
    expect(keys({ ...sunny, uvMax: 4, feelsMax: 14 })).toEqual(["sunscreen"]);
    for (const code of [3, 45, 61, 80, 95]) {
      expect(keys({ ...sunny, code, uvMax: 9 })).not.toContain("sunscreen");
    }
  });
  it("a warm dry day between 18 and 22 needs nothing", () => {
    expect(clothingFor({ ...mild, feelsMin: 18, feelsMax: 21 })).toEqual([]);
  });
});

describe("clothingFor misc", () => {
  it("a mild day gets the sweater", () => {
    expect(clothingFor(mild, "celsius")).toEqual([{ key: "sweater" }]);
  });

  it("the custom items carry no emoji, every other item has its emoji", () => {
    for (const key of CLOTHING_KEYS) {
      expect(isCustomClothingKey(key)).toBe(
        (CUSTOM_CLOTHING_KEYS as readonly string[]).includes(key),
      );
      if (!isCustomClothingKey(key)) expect(CLOTHING_EMOJI[key]).toBeTruthy();
    }
    expect(Object.keys(CLOTHING_EMOJI)).toHaveLength(
      CLOTHING_KEYS.length - CUSTOM_CLOTHING_KEYS.length,
    );
    const cold = clothingFor({ ...mild, feelsMin: 6, feelsMax: 9 });
    expect(cold).toEqual([{ key: "jacket", emoji: "🧥" }, { key: "hat" }]);
    expect(cold[1]).not.toHaveProperty("emoji");
  });

  it("cool morning + hot afternoon gives jacket and T-shirt", () => {
    expect(keys({ feelsMin: 8, feelsMax: 23 })).toEqual(["jacket", "tshirt"]);
  });

  it("converts Fahrenheit thresholds (57.2F = 14C)", () => {
    expect(keys({ feelsMin: 57 }, "fahrenheit")).toContain("jacket");
    expect(keys({ feelsMin: 58 }, "fahrenheit")).not.toContain("jacket");
    expect(keys({ feelsMin: 58 }, "fahrenheit")).toContain("sweater");
    expect(keys({ feelsMin: 64 }, "fahrenheit")).toContain("sweater");
    expect(keys({ feelsMin: 65 }, "fahrenheit")).not.toContain("sweater");
    expect(keys({ feelsMin: 46 }, "fahrenheit")).toContain("hat");
    expect(keys({ feelsMin: 47 }, "fahrenheit")).not.toContain("hat");
    expect(keys({ feelsMin: 40 }, "fahrenheit")).toContain("scarf");
    expect(keys({ feelsMin: 41 }, "fahrenheit")).not.toContain("scarf");
    expect(keys({ feelsMin: 37 }, "fahrenheit")).toContain("gloves");
    expect(keys({ feelsMin: 38 }, "fahrenheit")).not.toContain("gloves");
    expect(keys({ feelsMin: 65, feelsMax: 71 }, "fahrenheit")).not.toContain(
      "tshirt",
    );
    expect(keys({ feelsMin: 65, feelsMax: 72 }, "fahrenheit")).toContain(
      "tshirt",
    );
    expect(keys({ feelsMin: 65, feelsMax: 75 }, "fahrenheit")).not.toContain(
      "shorts",
    );
    expect(keys({ feelsMin: 65, feelsMax: 76 }, "fahrenheit")).toContain(
      "shorts",
    );
    // 67F = 19.4C: rain boots; 68F = 20C: none.
    expect(
      keys({ rain: true, feelsMin: 65, feelsMax: 67 }, "fahrenheit"),
    ).toContain("rainBoots");
    expect(
      keys({ rain: true, feelsMin: 65, feelsMax: 68 }, "fahrenheit"),
    ).not.toContain("rainBoots");
    // 20 is cold in Celsius but warm in Fahrenheit input.
    expect(keys({ feelsMin: 20, feelsMax: 20 }, "fahrenheit")).toContain(
      "gloves",
    );
    expect(keys({ feelsMin: 20, feelsMax: 20 }, "celsius")).not.toContain(
      "gloves",
    );
  });

  it("caps at 5 items and keeps protection before comfort", () => {
    const all = clothingFor(
      {
        code: 0,
        feelsMin: -3,
        feelsMax: 25,
        rain: true,
        snow: true,
        uvMax: 8,
      },
      "celsius",
    );
    expect(all).toHaveLength(CLOTHING_MAX_ITEMS);
    expect(all.map((i) => i.key)).toEqual([
      "umbrella",
      "winterBoots",
      "jacket",
      "hat",
      "gloves",
    ]);
    // A cold rainy day: the scarf is the one dropped.
    expect(keys({ rain: true, feelsMin: 1, feelsMax: 4 })).toEqual([
      "umbrella",
      "rainBoots",
      "jacket",
      "hat",
      "gloves",
    ]);
  });

  it("has no duplicates and the fixed order", () => {
    const items = clothingFor({ ...mild, feelsMin: -5, snow: true });
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
    expect(items.map((i) => i.key)).toEqual([
      "winterBoots",
      "jacket",
      "hat",
      "gloves",
      "scarf",
    ]);
    expect(items.map((i) => i.emoji)).toEqual([
      "🥾",
      "🧥",
      undefined,
      "🧤",
      "🧣",
    ]);
  });

  it("returns fresh objects", () => {
    const [first] = clothingFor({ ...mild, rain: true });
    if (first?.key !== "umbrella") {
      throw new Error("expected the umbrella");
    }
    first.emoji = "x";
    expect(clothingFor({ ...mild, rain: true })[0]?.emoji).toBe("🌂");
  });
});

describe("WeatherResponseSchema", () => {
  const valid = {
    fetchedAt: "2026-05-04T08:00:00Z",
    unit: "celsius",
    current: { temperature: 12, code: 3 },
    days: [mild],
  };

  it("parses, defaults stale to false and ignores unknown keys", () => {
    const parsed = WeatherResponseSchema.parse({ ...valid, future: 1 });
    expect(parsed.stale).toBe(false);
    expect(parsed).not.toHaveProperty("future");
    expect(WeatherResponseSchema.parse({ ...valid, stale: true }).stale).toBe(
      true,
    );
  });

  it("rejects fractional temperatures, bad dates, bad unit and > 7 days", () => {
    const bad = (patch: Record<string, unknown>): boolean =>
      WeatherResponseSchema.safeParse({ ...valid, ...patch }).success;
    expect(bad({ current: { temperature: 12.5, code: 3 } })).toBe(false);
    expect(bad({ days: [{ ...mild, feelsMin: 1.5 }] })).toBe(false);
    expect(bad({ days: [{ ...mild, date: "04.05.2026" }] })).toBe(false);
    expect(bad({ unit: "kelvin" })).toBe(false);
    expect(bad({ days: Array.from({ length: 7 }, () => mild) })).toBe(true);
    expect(bad({ days: Array.from({ length: 8 }, () => mild) })).toBe(false);
    expect(bad({ fetchedAt: "yesterday" })).toBe(false);
  });
});
