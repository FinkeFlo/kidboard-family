import type { TemperatureUnit } from "@kidboard/shared";
import { z } from "zod";

import { fetchFeed } from "../feeds/fetchFeed";

/**
 * Open-Meteo endpoints (ADR-0015). The request URLs carry the place or the coordinates,
 * so they are only ever passed to `fetch`: never logged, returned or put into an error.
 */
export const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
export const GEOCODING_ENDPOINT =
  "https://geocoding-api.open-meteo.com/v1/search";

/** PLAN T-48: upstream timeout per request (headers and body). */
export const WEATHER_TIMEOUT_MS = 5000;
/** PLAN T-48: maximum response size in bytes. */
export const WEATHER_MAX_BYTES = 1024 * 1024;

/** Variables requested per section (ADR-0015); `condense` reads exactly these. */
export const CURRENT_VARIABLES = ["temperature_2m", "weather_code"] as const;
export const HOURLY_VARIABLES = [
  "apparent_temperature",
  "precipitation_probability",
  "precipitation",
  "snowfall",
  "uv_index",
] as const;
export const DAILY_VARIABLES = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "uv_index_max",
] as const;

/** Forecast days requested (the DTO holds at most `WEATHER_MAX_DAYS` = 7). */
export const FORECAST_DAYS = 7;

/** Open-Meteo marks missing data with `null`; a missing array counts as all `null`. */
const Series = z.array(z.number().nullable()).default([]);

/** Unix seconds (`timeformat=unixtime`). */
const UnixTimes = z.array(z.number());

/**
 * The part of the forecast response KidBoard reads (requested with
 * `timeformat=unixtime`). Objects are not strict: Open-Meteo adds keys (`*_units`,
 * `generationtime_ms`, `elevation`, `current.time`, …) that are ignored.
 *
 * Per the Open-Meteo docs (`timezone` and `timeformat` parameters), the UTC offset of
 * the requested zone *at request time* is returned as `utc_offset_seconds` and fixes the
 * daily boundaries of the whole response; DST changes within the range are ignored.
 * Hence `condense` groups hourly values by the config-zone wall time of each timestamp
 * (DST-aware) and only labels daily entries via `utc_offset_seconds`.
 */
export const ForecastSchema = z.object({
  utc_offset_seconds: z.number().int(),
  current: z.object({
    temperature_2m: z.number().nullable(),
    weather_code: z.number().nullable(),
  }),
  hourly: z.object({
    /** Start of each hour, unix seconds (hours at the request-time offset). */
    time: UnixTimes,
    apparent_temperature: Series,
    precipitation_probability: Series,
    precipitation: Series,
    snowfall: Series,
    uv_index: Series,
  }),
  daily: z.object({
    /** Midnight at the request-time offset (`utc_offset_seconds`), unix seconds. */
    time: UnixTimes,
    weather_code: Series,
    temperature_2m_max: Series,
    temperature_2m_min: Series,
    uv_index_max: Series,
  }),
});
export type Forecast = z.infer<typeof ForecastSchema>;

/** Geocoding response: without a match Open-Meteo omits `results`. */
export const GeocodingSchema = z.object({
  results: z
    .array(
      z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }),
    )
    .optional(),
});

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Why a weather upstream call failed (log codes; never upstream text). */
export type WeatherUpstreamFailure = "invalid-json" | "invalid-shape";

/**
 * The upstream answered 2xx, but not with the documented JSON. The message is fixed:
 * it never quotes the body or a zod issue (which could echo values).
 */
export class WeatherResponseError extends Error {
  override readonly name = "WeatherResponseError";
  readonly reason: WeatherUpstreamFailure;

  constructor(reason: WeatherUpstreamFailure) {
    super("Weather service returned an unexpected response");
    this.reason = reason;
  }
}

export interface UpstreamLimits {
  timeoutMs: number;
  maxBytes: number;
}

/**
 * GET + parse + validate with the feed downloader's limits (timeout, streamed size cap).
 * Non-2xx (e.g. Open-Meteo's `400 { error, reason }`) throws a `FeedFetchError` without
 * reading the body, so upstream text never travels further.
 */
async function fetchJson<T>(
  url: string,
  schema: z.ZodType<T>,
  limits: UpstreamLimits,
): Promise<T> {
  const text = await fetchFeed(url, {
    timeoutMs: limits.timeoutMs,
    maxBytes: limits.maxBytes,
    accept: "application/json",
  });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new WeatherResponseError("invalid-json");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new WeatherResponseError("invalid-shape");
  }
  return parsed.data;
}

/** Geocoding request URL (first match, optional country filter). */
export function geocodingUrl(
  place: string,
  country: string | undefined,
  language: "de" | "en",
): string {
  const url = new URL(GEOCODING_ENDPOINT);
  url.searchParams.set("name", place);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", language);
  url.searchParams.set("format", "json");
  if (country !== undefined) {
    url.searchParams.set("countryCode", country);
  }
  return url.toString();
}

/** First geocoding match of `place`, or `null` when Open-Meteo knows no such place. */
export async function geocode(
  place: string,
  country: string | undefined,
  language: "de" | "en",
  limits: UpstreamLimits,
): Promise<Coordinates | null> {
  const body = await fetchJson(
    geocodingUrl(place, country, language),
    GeocodingSchema,
    limits,
  );
  const first = body.results?.[0];
  return first === undefined
    ? null
    : { latitude: first.latitude, longitude: first.longitude };
}

/**
 * Forecast request URL: days in `timeZone`, timestamps as unix seconds (DST-aware
 * conversion happens in `condense`), temperatures in `unit`.
 */
export function forecastUrl(
  at: Coordinates,
  timeZone: string,
  unit: TemperatureUnit,
): string {
  const url = new URL(FORECAST_ENDPOINT);
  url.searchParams.set("latitude", String(at.latitude));
  url.searchParams.set("longitude", String(at.longitude));
  url.searchParams.set("timezone", timeZone);
  url.searchParams.set("timeformat", "unixtime");
  url.searchParams.set("forecast_days", String(FORECAST_DAYS));
  url.searchParams.set("current", CURRENT_VARIABLES.join(","));
  url.searchParams.set("hourly", HOURLY_VARIABLES.join(","));
  url.searchParams.set("daily", DAILY_VARIABLES.join(","));
  url.searchParams.set("temperature_unit", unit);
  return url.toString();
}

/** Downloads and validates the forecast (precipitation stays in mm, snowfall in cm). */
export function fetchForecast(
  at: Coordinates,
  timeZone: string,
  unit: TemperatureUnit,
  limits: UpstreamLimits,
): Promise<Forecast> {
  return fetchJson(forecastUrl(at, timeZone, unit), ForecastSchema, limits);
}
