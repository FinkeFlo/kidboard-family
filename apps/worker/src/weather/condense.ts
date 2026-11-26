import { tzOffset } from "@date-fns/tz";
import {
  DateStringSchema,
  type TemperatureUnit,
  WEATHER_MAX_DAYS,
  type WeatherDay,
  weatherKind,
  type WeatherResponse,
  WeatherResponseSchema,
} from "@kidboard/shared";

import { type Forecast, WeatherResponseError } from "./openMeteo";

/**
 * Daytime of the clothing rules: 07:00-19:00 wall time in the config zone.
 *
 * Open-Meteo resolves the requested zone's UTC offset once, at request time
 * (`utc_offset_seconds`), and ignores DST changes within the forecast range (docs of the
 * `timezone` parameter, https://open-meteo.com/en/docs). After a DST switch inside the
 * 7 days its local hours and daily boundaries would be off by one hour. The forecast is
 * therefore requested with `timeformat=unixtime`, and every hourly timestamp is
 * converted to the config zone's date and hour with `@date-fns/tz` (DST-aware), so the
 * window always follows the config zone.
 *
 * Daily entries (`weather_code`, `temperature_2m_max/min`, `uv_index_max`) are
 * Open-Meteo's aggregates over a midnight-to-midnight day at the request-time offset.
 * Each is labelled with the date of its timestamp shifted by `utc_offset_seconds`, as the
 * docs prescribe to reproduce the API's dates. After a DST switch such a day spans
 * 01:00-01:00 or 23:00-23:00 config-zone time; that hour lies in the night and does not
 * matter for a day's symbol, high/low or UV maximum, so these stay daily values (no
 * extra hourly variables in the payload). Everything the clothing rules read for the
 * daytime (feels-like, rain and snow amounts, UV fallback) comes from the hourly values
 * grouped in the config zone.
 *
 * Per the Open-Meteo forecast API docs (table "Hourly Parameter Definition"),
 * `apparent_temperature` is an instant value, while `precipitation`,
 * `precipitation_probability`, `snowfall` and `uv_index` describe the preceding hour:
 *
 * - Instant values (`apparent_temperature`) count at 07:00 … 19:00 inclusive.
 * - Preceding-hour values count at 08:00 … 19:00, i.e. exactly the hours that fall
 *   within 07:00-19:00.
 */
export const DAYTIME_START_HOUR = 7;
export const DAYTIME_END_HOUR = 19;

/**
 * Rain rule (PLAN T-48, used by `clothingFor` for ☔ + 👢): the day's WMO code is drizzle,
 * rain (incl. freezing rain and showers) or thunder, **or** the daytime precipitation
 * probability reaches {@link RAIN_PROBABILITY_FROM} % **and** the daytime precipitation
 * sum reaches {@link RAIN_SUM_FROM_MM} mm.
 */
export const RAIN_PROBABILITY_FROM = 50;
export const RAIN_SUM_FROM_MM = 0.5;

/**
 * Snow rule (🧤 + 👢): the day's WMO code is a snow code (snow fall, snow grains, snow
 * showers), **or** the daytime snowfall sum is above {@link SNOW_SUM_ABOVE_CM} cm. Snow
 * that falls only at night does not count by amount.
 */
export const SNOW_SUM_ABOVE_CM = 0;

const MINUTE_MS = 60_000;
const SECOND_MS = 1000;

/** Whole degrees; never `-0`. */
function whole(value: number): number {
  return Math.round(value) || 0;
}

function present(values: readonly (number | null)[]): number[] {
  return values.filter((v): v is number => v !== null);
}

function total(values: readonly (number | null)[]): number {
  return present(values).reduce((sum, v) => sum + v, 0);
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

interface WallTime {
  date: string;
  hour: number;
}

/** Date and hour of a shifted instant, read through UTC getters (no device zone). */
function utcWallTime(shiftedMs: number): WallTime | null {
  const at = new Date(shiftedMs);
  if (Number.isNaN(at.getTime())) {
    return null;
  }
  return {
    date: `${pad(at.getUTCFullYear(), 4)}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`,
    hour: at.getUTCHours(),
  };
}

/** Wall time of `unixSeconds` in `timeZone` (DST-aware); `null` for an invalid instant. */
function wallTimeInZone(
  unixSeconds: number,
  timeZone: string,
): WallTime | null {
  if (!Number.isSafeInteger(unixSeconds)) {
    return null;
  }
  const ms = unixSeconds * SECOND_MS;
  const offset = tzOffset(timeZone, new Date(ms));
  if (Number.isNaN(offset)) {
    return null;
  }
  return utcWallTime(ms + Math.round(offset) * MINUTE_MS);
}

/** Open-Meteo's date of a daily entry: its timestamp at the request-time offset. */
function dailyDate(
  unixSeconds: number | undefined,
  offsetSeconds: number,
): string | null {
  if (unixSeconds === undefined || !Number.isSafeInteger(unixSeconds)) {
    return null;
  }
  return utcWallTime((unixSeconds + offsetSeconds) * SECOND_MS)?.date ?? null;
}

interface DaytimeValues {
  feels: (number | null)[];
  uv: (number | null)[];
  precipitation: (number | null)[];
  probability: (number | null)[];
  snowfall: (number | null)[];
}

/** Hourly values per config-zone date, restricted to the daytime windows above. */
function daytimeByDate(
  hourly: Forecast["hourly"],
  timeZone: string,
): Map<string, DaytimeValues> {
  const byDate = new Map<string, DaytimeValues>();
  hourly.time.forEach((time, i) => {
    const wall = wallTimeInZone(time, timeZone);
    if (
      wall === null ||
      wall.hour < DAYTIME_START_HOUR ||
      wall.hour > DAYTIME_END_HOUR
    ) {
      return;
    }
    let values = byDate.get(wall.date);
    if (values === undefined) {
      values = {
        feels: [],
        uv: [],
        precipitation: [],
        probability: [],
        snowfall: [],
      };
      byDate.set(wall.date, values);
    }
    values.feels.push(hourly.apparent_temperature[i] ?? null);
    if (wall.hour > DAYTIME_START_HOUR) {
      values.uv.push(hourly.uv_index[i] ?? null);
      values.precipitation.push(hourly.precipitation[i] ?? null);
      values.probability.push(hourly.precipitation_probability[i] ?? null);
      values.snowfall.push(hourly.snowfall[i] ?? null);
    }
  });
  return byDate;
}

function isRainCode(code: number): boolean {
  const kind = weatherKind(code);
  return kind === "drizzle" || kind === "rain" || kind === "thunder";
}

/**
 * One day, or `null` when a core value is missing (date, code, high, low, or no daytime
 * feels-like value at all): such a day is skipped instead of failing the forecast.
 */
function condenseDay(
  forecast: Forecast,
  i: number,
  daytime: Map<string, DaytimeValues>,
): WeatherDay | null {
  const { daily } = forecast;
  const date = dailyDate(daily.time[i], forecast.utc_offset_seconds);
  const code = daily.weather_code[i] ?? null;
  const tempMax = daily.temperature_2m_max[i] ?? null;
  const tempMin = daily.temperature_2m_min[i] ?? null;
  if (
    date === null ||
    !DateStringSchema.safeParse(date).success ||
    code === null ||
    !Number.isInteger(code) ||
    code < 0 ||
    tempMax === null ||
    tempMin === null
  ) {
    return null;
  }
  const hours = daytime.get(date);
  const feels = present(hours?.feels ?? []);
  if (feels.length === 0) {
    return null;
  }

  const probabilityMax = Math.max(0, ...present(hours?.probability ?? []));
  const rain =
    isRainCode(code) ||
    (probabilityMax >= RAIN_PROBABILITY_FROM &&
      total(hours?.precipitation ?? []) >= RAIN_SUM_FROM_MM);
  const snow =
    weatherKind(code) === "snow" ||
    total(hours?.snowfall ?? []) > SNOW_SUM_ABOVE_CM;

  // Daily UV maximum; without it the daytime hourly maximum; without both 0.
  const uvRaw =
    daily.uv_index_max[i] ?? Math.max(0, ...present(hours?.uv ?? []));
  const uvMax = Math.max(0, Math.round(uvRaw * 10) / 10);

  return {
    date,
    code,
    tempMax: whole(tempMax),
    tempMin: whole(tempMin),
    feelsMin: whole(Math.min(...feels)),
    feelsMax: whole(Math.max(...feels)),
    rain,
    snow,
    uvMax,
  };
}

/**
 * Condenses a validated Open-Meteo forecast (requested for `timeZone` with
 * `timeformat=unixtime`) to the `/api/weather` DTO (without the place or coordinates).
 * Throws {@link WeatherResponseError} when the current values are missing or no day is
 * usable.
 */
export function condenseForecast(
  forecast: Forecast,
  timeZone: string,
  unit: TemperatureUnit,
  fetchedAtMs: number,
): WeatherResponse {
  const { temperature_2m: temperature, weather_code: code } = forecast.current;
  if (
    temperature === null ||
    code === null ||
    !Number.isInteger(code) ||
    code < 0
  ) {
    throw new WeatherResponseError("invalid-shape");
  }
  const daytime = daytimeByDate(forecast.hourly, timeZone);
  const days: WeatherDay[] = [];
  for (
    let i = 0;
    i < forecast.daily.time.length && days.length < WEATHER_MAX_DAYS;
    i += 1
  ) {
    const day = condenseDay(forecast, i, daytime);
    if (day !== null && !days.some((d) => d.date === day.date)) {
      days.push(day);
    }
  }
  if (days.length === 0) {
    throw new WeatherResponseError("invalid-shape");
  }
  const parsed = WeatherResponseSchema.safeParse({
    fetchedAt: new Date(fetchedAtMs).toISOString(),
    unit,
    current: { temperature: whole(temperature), code },
    days,
    stale: false,
  });
  if (!parsed.success) {
    throw new WeatherResponseError("invalid-shape");
  }
  return parsed.data;
}
