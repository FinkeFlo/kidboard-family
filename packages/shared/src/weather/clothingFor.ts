import type { TemperatureUnit, WeatherDay } from "./schema";

/**
 * Clothing items, in display order (= priority when capped at {@link CLOTHING_MAX_ITEMS}):
 * protection first, comfort last.
 */
export const CLOTHING_KEYS = [
  "umbrella",
  "rainBoots",
  "winterBoots",
  "jacket",
  "hat",
  "gloves",
  "scarf",
  "sweater",
  "tshirt",
  "shorts",
  "cap",
  "sunscreen",
] as const;

export type ClothingKey = (typeof CLOTHING_KEYS)[number];

/**
 * Items without any emoji up to the ADR-0011 baseline (Emoji 13.0): a knitted hat and a
 * sweater. The web app draws them itself (ADR-0015); here they carry no emoji at all.
 */
export const CUSTOM_CLOTHING_KEYS = ["hat", "sweater"] as const;

export type CustomClothingKey = (typeof CUSTOM_CLOTHING_KEYS)[number];
export type EmojiClothingKey = Exclude<ClothingKey, CustomClothingKey>;

/** The emoji of every item that has one (Emoji 13.0 or older, ADR-0011). */
export const CLOTHING_EMOJI: Readonly<Record<EmojiClothingKey, string>> = {
  // The closed umbrella is the object to take along; ☔ reads as weather.
  umbrella: "🌂",
  rainBoots: "👢",
  winterBoots: "🥾",
  jacket: "🧥",
  gloves: "🧤",
  scarf: "🧣",
  tshirt: "👕",
  shorts: "🩳",
  cap: "🧢",
  sunscreen: "🧴",
};

/** One item: an emoji item, or one the app draws itself (no emoji). */
export type ClothingItem =
  | { key: EmojiClothingKey; emoji: string }
  | { key: CustomClothingKey; emoji?: undefined };

/** True for the items the app draws itself (no emoji up to Emoji 13.0). */
export function isCustomClothingKey(
  key: ClothingKey,
): key is CustomClothingKey {
  return (CUSTOM_CLOTHING_KEYS as readonly ClothingKey[]).includes(key);
}

/**
 * Thresholds in degrees Celsius (feels-like over 07:00-19:00); Fahrenheit input is
 * converted to Celsius before comparing. "Below" = strictly less, "from" = greater or equal.
 * Values for children of 3-8, who stand still more and cool down faster than adults.
 */
export const CLOTHING_THRESHOLDS = {
  /** 🧥 when `feelsMin` is below this. */
  jacketBelow: 14,
  /** Knitted hat when `feelsMin` is below this. */
  hatBelow: 8,
  /** 🧣 when `feelsMin` is below this. */
  scarfBelow: 5,
  /** 🧤 when `feelsMin` is below this (or snow). */
  glovesBelow: 3,
  /** Sweater when `feelsMin` is at least `jacketBelow` and below this (no jacket). */
  sweaterBelow: 18,
  /** 👕 when `feelsMax` is at least this. */
  tshirtFrom: 22,
  /** 🩳 when `feelsMax` is at least this. */
  shortsFrom: 24,
  /** 👢 for rain only when `feelsMax` is below this (no boots in summer storms). */
  rainBootsBelow: 20,
  /** 🧢 needs `feelsMax` at least this, a sunny code and `capUvFrom`. */
  capFeelsFrom: 15,
  /** 🧢 needs a UV index at least this. */
  capUvFrom: 3,
  /** 🧴 needs a UV index at least this and a sunny code. */
  sunscreenUvFrom: 4,
  /** 🧢 and 🧴 only for WMO codes up to this (clear to partly cloudy). */
  sunnyMaxCode: 2,
} as const;

/** Most items shown. */
export const CLOTHING_MAX_ITEMS = 5;

function toCelsius(value: number, unit: TemperatureUnit): number {
  return unit === "fahrenheit" ? ((value - 32) * 5) / 9 : value;
}

function itemOf(key: ClothingKey): ClothingItem {
  return isCustomClothingKey(key)
    ? { key }
    : { key, emoji: CLOTHING_EMOJI[key] };
}

/**
 * What to wear on `day` (temperatures in `unit`): at most {@link CLOTHING_MAX_ITEMS}
 * items in the fixed order of {@link CLOTHING_KEYS}, which is also the priority when
 * capped (protection before comfort). Snow wins over rain for the boots (one pair only).
 */
export function clothingFor(
  day: Pick<
    WeatherDay,
    "code" | "feelsMin" | "feelsMax" | "rain" | "snow" | "uvMax"
  >,
  unit: TemperatureUnit = "celsius",
): ClothingItem[] {
  const t = CLOTHING_THRESHOLDS;
  const min = toCelsius(day.feelsMin, unit);
  const max = toCelsius(day.feelsMax, unit);
  const sunny = day.code <= t.sunnyMaxCode;
  const wanted = new Set<ClothingKey>();

  if (day.rain) wanted.add("umbrella");
  if (day.snow) {
    wanted.add("winterBoots");
    wanted.add("gloves");
  } else if (day.rain && max < t.rainBootsBelow) {
    wanted.add("rainBoots");
  }
  if (min < t.jacketBelow) wanted.add("jacket");
  else if (min < t.sweaterBelow) wanted.add("sweater");
  if (min < t.hatBelow) wanted.add("hat");
  if (min < t.scarfBelow) wanted.add("scarf");
  if (min < t.glovesBelow) wanted.add("gloves");
  if (max >= t.tshirtFrom) wanted.add("tshirt");
  if (max >= t.shortsFrom) wanted.add("shorts");
  if (sunny && day.uvMax >= t.capUvFrom && max >= t.capFeelsFrom) {
    wanted.add("cap");
  }
  if (sunny && day.uvMax >= t.sunscreenUvFrom) wanted.add("sunscreen");

  return CLOTHING_KEYS.filter((key) => wanted.has(key))
    .slice(0, CLOTHING_MAX_ITEMS)
    .map(itemOf);
}
