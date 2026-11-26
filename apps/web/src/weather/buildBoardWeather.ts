import {
  addCalendarDays,
  clothingFor,
  type ClothingItem,
  dateKeyInZone,
  type PublicConfig,
  type TemperatureUnit,
  type WeatherDay,
  weatherIcon,
  type WeatherKind,
  weatherKind,
  type WeatherResponse,
} from "@kidboard/shared";

import { ApiError } from "../data/apiClient";
import { minuteOfDay, minutesOfTime } from "../time";

/*
 * What the board shows of the weather (T-49, ADR-0015). Pure: every instant is read in
 * `config.timeZone`, never in the device zone.
 */

const HOUR_MS = 60 * 60_000;

/** A forecast fetched longer ago than this is not shown at all. */
export const WEATHER_MAX_AGE_MS = 24 * HOUR_MS;

/**
 * Today's chip says "now 8°" only while the current temperature is at most this old;
 * an older one (the board was offline) shows the day's high like the other days. The
 * board refetches every 30 minutes, so a working board always shows "now".
 */
export const CURRENT_MAX_AGE_MS = 2 * HOUR_MS;

/**
 * The forecast the board may show after the last `/api/weather` request: a failed
 * request without an answer (offline, timeout) keeps the persisted forecast (the age and
 * date checks of {@link buildBoardWeather} still apply); an answer with an error status
 * (404 `weather_off`, 503 `weather_place_unknown`, any other) or an unusable body hides it.
 */
export function forecastToShow(
  data: WeatherResponse | undefined,
  error: unknown,
): WeatherResponse | undefined {
  if (error === null || error === undefined) return data;
  const noAnswer =
    error instanceof ApiError &&
    (error.kind === "network" || error.kind === "timeout");
  return noAnswer ? data : undefined;
}

/** One day's chip. */
export interface DayWeather {
  /** `YYYY-MM-DD` in the config zone. */
  date: string;
  icon: string;
  kind: WeatherKind;
  /** Daily high, whole degrees of the forecast's unit. */
  high: number;
  /** Today only, while fresh ({@link CURRENT_MAX_AGE_MS}): the current temperature. */
  current?: number;
}

/**
 * What to wear: until `bands.eveningStart` for today, from then until midnight for
 * tomorrow (as the 🎒 area, so it can be laid out the evening before).
 */
export type ClothingRowModel =
  | {
      when: "today";
      /** The day the clothes are for (`YYYY-MM-DD`, config zone). */
      date: string;
      /** One to five items in the fixed order of `clothingFor`. */
      items: ClothingItem[];
    }
  | {
      when: "tomorrow";
      date: string;
      items: ClothingItem[];
      /** Tomorrow's weather (icon and high), the lead of the evening pill. */
      forecast: DayWeather;
    };

/**
 * Today's chip on the overview: the day's weather (icon; "now" while fresh, else the
 * high) until `bands.eveningStart`; from then only the current temperature (🌡️), never
 * the day's icon (no sun after dark next to tomorrow's rain clothes).
 */
export type TodayChipModel =
  | { type: "day"; day: DayWeather }
  | { type: "now"; date: string; temperature: number };

export interface BoardWeather {
  unit: TemperatureUnit;
  /**
   * Chips by date, from today on (days before today are dropped); icon and high, today
   * also the current temperature while fresh. The week view shows the high everywhere.
   */
  days: ReadonlyMap<string, DayWeather>;
  /**
   * Today's overview chip; `undefined` in the evening when the current temperature is
   * too old ({@link CURRENT_MAX_AGE_MS}) or today is not in the forecast.
   */
  todayChip: TodayChipModel | undefined;
  /** Today's clothing row; `undefined` when there is nothing to wear or no forecast. */
  clothing: ClothingRowModel | undefined;
}

export type BoardWeatherConfig = Pick<PublicConfig, "timeZone" | "bands">;

function chip(day: WeatherDay): DayWeather {
  return {
    date: day.date,
    icon: weatherIcon(day.code),
    kind: weatherKind(day.code),
    high: day.tempMax,
  };
}

/**
 * The board's weather at `now` (epoch ms), or `undefined` when there is nothing to show:
 * no forecast, or one fetched more than {@link WEATHER_MAX_AGE_MS} away from `now`
 * (either way, so a wrong clock never shows an old forecast as today's). Days before
 * today (config zone) are dropped. Today's entry carries the current temperature while it
 * is fresh; the icon is always the day's (the current code may be a night code). From
 * `bands.eveningStart` today's overview chip says "now" only and the clothes are
 * tomorrow's, led by tomorrow's weather.
 */
export function buildBoardWeather(
  response: WeatherResponse | undefined,
  config: BoardWeatherConfig,
  now: number,
): BoardWeather | undefined {
  if (response === undefined) return undefined;
  const age = now - Date.parse(response.fetchedAt);
  if (!Number.isFinite(age) || Math.abs(age) > WEATHER_MAX_AGE_MS) {
    return undefined;
  }
  const today = dateKeyInZone(now, config.timeZone);
  const days = new Map<string, DayWeather>();
  for (const day of response.days) {
    if (day.date < today || days.has(day.date)) continue;
    days.set(day.date, chip(day));
  }
  const todayChip = days.get(today);
  if (todayChip !== undefined && Math.abs(age) <= CURRENT_MAX_AGE_MS) {
    days.set(today, { ...todayChip, current: response.current.temperature });
  }

  const evening =
    minuteOfDay(now, config.timeZone) >=
    minutesOfTime(config.bands.eveningStart);
  const date = evening ? addCalendarDays(today, 1) : today;
  const forecast = response.days.find((day) => day.date === date);
  const items =
    forecast === undefined ? [] : clothingFor(forecast, response.unit);
  const current = days.get(today)?.current;
  return {
    unit: response.unit,
    days,
    todayChip: todayChipOf(days.get(today), evening, current),
    clothing:
      items.length === 0 || forecast === undefined
        ? undefined
        : evening
          ? { when: "tomorrow", date, items, forecast: chip(forecast) }
          : { when: "today", date, items },
  };
}

function todayChipOf(
  day: DayWeather | undefined,
  evening: boolean,
  current: number | undefined,
): TodayChipModel | undefined {
  if (day === undefined) return undefined;
  if (!evening) return { type: "day", day };
  return current === undefined
    ? undefined
    : { type: "now", date: day.date, temperature: current };
}
