import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { Emoji } from "../components/Emoji";
import type { DayWeather } from "./buildBoardWeather";
import { EMOJI_BOX } from "./ClothingIcon";

/** The thermometer of the evening chip ("now" only, never the day's weather icon). */
const THERMOMETER = "🌡️";

/** U+2212, the real minus sign: wider and easier to see than the hyphen of `-3`. */
const MINUS = "−";

/** A whole temperature for the screen: "8", "0", "−3" (real minus sign). */
export function temperatureText(value: number): string {
  return value < 0 ? `${MINUS}${String(Math.abs(value))}` : String(value);
}

/**
 * Full spoken name of a chip: "Sunny, now 8 degrees, high 12 degrees" (with `current`,
 * today's overview chip while fresh) or "Rain, high 9 degrees". Negative values are
 * spoken as "-3 degrees" (screen readers say "minus").
 */
export function weatherName(
  t: TFunction,
  day: DayWeather,
  { current = true }: { current?: boolean } = {},
): string {
  const kind = t(`weather.kind.${day.kind}`);
  const high = t("weather.degrees", { count: day.high });
  return !current || day.current === undefined
    ? t("weather.high", { kind, high })
    : t("weather.nowAndHigh", {
        kind,
        now: t("weather.degrees", { count: day.current }),
        high,
      });
}

/**
 * The subtle pill every weather chip sits in (page surface with a hairline), so a chip
 * reads as "weather", apart from the ☀️ Today button and the time-of-day icons.
 */
export const WEATHER_PILL =
  "rounded-pill bg-surface inset-ring-border flex shrink-0 items-center gap-1 inset-ring-1";

/**
 * Sizes: `today` (overview, today's heading row: icon 1.75rem, temperature as a title),
 * `day` (overview, the other days' date line: icon 1.75rem), `week` (week header:
 * icon 1.75rem). Full class names so Tailwind can see them.
 */
const SIZES = {
  today: {
    box: "h-9 ps-1.5 pe-2.5",
    icon: "text-[1.75rem]",
    temperature: "text-title",
  },
  day: {
    box: "h-8 ps-1 pe-2",
    icon: "text-[1.75rem]",
    temperature: "text-tile",
  },
  week: {
    box: "h-8 ps-1 pe-2",
    icon: "text-[1.75rem]",
    temperature: "text-body font-black",
  },
} as const;

export type WeatherChipSize = keyof typeof SIZES;

/**
 * The weather of one day: its icon (never 🌙, rule 1) and a temperature: with
 * `showCurrent` (today's overview chip) the current one while fresh, else the day's high
 * (week view: always the high). One image for assistive tech with the full name
 * ({@link weatherName}); its parts are decorative. `decorative` hides the whole chip
 * (the week header says the name in its heading instead). Not interactive.
 */
export function WeatherChip({
  day,
  size,
  decorative = false,
  showCurrent = false,
}: {
  day: DayWeather;
  size: WeatherChipSize;
  decorative?: boolean;
  showCurrent?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const classes = SIZES[size];
  const value =
    showCurrent && day.current !== undefined ? day.current : day.high;
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={
        decorative ? undefined : weatherName(t, day, { current: showCurrent })
      }
      aria-hidden={decorative ? true : undefined}
      data-testid="weather-chip"
      data-date={day.date}
      data-kind={day.kind}
      className={`${WEATHER_PILL} ${classes.box}`}
    >
      <Emoji emoji={day.icon} className={classes.icon} />
      <span
        aria-hidden="true"
        data-testid="weather-temperature"
        className={`${classes.temperature} leading-none whitespace-nowrap`}
      >
        {t("weather.temperature", { value: temperatureText(value) })}
      </span>
    </span>
  );
}

/**
 * Today's chip from `bands.eveningStart`: only the current temperature behind a
 * thermometer, never the day's icon (no sun after dark next to tomorrow's clothes, whose
 * pill carries tomorrow's weather). One image named "Now 8 degrees".
 */
export function NowChip({
  date,
  temperature,
}: {
  date: string;
  temperature: number;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={t("weather.now", {
        now: t("weather.degrees", { count: temperature }),
      })}
      data-testid="weather-chip"
      data-date={date}
      data-kind="now"
      className={`${WEATHER_PILL} h-9 gap-0.5 ps-1 pe-2`}
    >
      <Emoji emoji={THERMOMETER} className={`${EMOJI_BOX} text-[1.375rem]`} />
      <span
        aria-hidden="true"
        data-testid="weather-temperature"
        className="text-body leading-none font-black tracking-tight whitespace-nowrap"
      >
        {t("weather.temperature", { value: temperatureText(temperature) })}
      </span>
    </span>
  );
}
