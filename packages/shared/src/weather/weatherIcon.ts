/** Stable weather category, used as i18n key by the web app. */
export type WeatherKind =
  | "clear"
  | "mostlyClear"
  | "partlyCloudy"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "thunder";

interface WeatherCodeRange {
  /** Inclusive WMO code range. */
  from: number;
  to: number;
  kind: WeatherKind;
  icon: string;
}

/**
 * WMO weather interpretation codes as documented by Open-Meteo, mapped to a category and
 * one emoji (Emoji <= 13.0, ADR-0011). Snow is ❄️, clearly apart from the rain cloud at
 * small sizes. Never a moon: the moon counts sleeps (rule 1).
 */
export const WEATHER_CODE_TABLE: readonly WeatherCodeRange[] = [
  { from: 0, to: 0, kind: "clear", icon: "☀️" },
  { from: 1, to: 1, kind: "mostlyClear", icon: "🌤️" },
  { from: 2, to: 2, kind: "partlyCloudy", icon: "⛅" },
  { from: 3, to: 3, kind: "cloudy", icon: "☁️" },
  { from: 45, to: 48, kind: "fog", icon: "🌫️" },
  { from: 51, to: 57, kind: "drizzle", icon: "🌦️" },
  { from: 61, to: 67, kind: "rain", icon: "🌧️" },
  { from: 71, to: 77, kind: "snow", icon: "❄️" },
  { from: 80, to: 82, kind: "rain", icon: "🌧️" },
  { from: 85, to: 86, kind: "snow", icon: "❄️" },
  { from: 95, to: 99, kind: "thunder", icon: "⛈️" },
];

const FALLBACK: Pick<WeatherCodeRange, "kind" | "icon"> = {
  kind: "cloudy",
  icon: "☁️",
};

function lookup(code: number): Pick<WeatherCodeRange, "kind" | "icon"> {
  return (
    WEATHER_CODE_TABLE.find(
      (range) =>
        Number.isInteger(code) && code >= range.from && code <= range.to,
    ) ?? FALLBACK
  );
}

/** Category of a WMO code; unknown codes are `cloudy`. */
export function weatherKind(code: number): WeatherKind {
  return lookup(code).kind;
}

/** One emoji for a WMO code; unknown codes give ☁️. */
export function weatherIcon(code: number): string {
  return lookup(code).icon;
}
