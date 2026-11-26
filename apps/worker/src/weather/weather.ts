import {
  type AppConfig,
  DateTimeStringSchema,
  FLIGHT_MARGIN_MS,
  todayInZone,
  type WeatherResponse,
  WeatherResponseSchema,
} from "@kidboard/shared";
import { z } from "zod";

import { type BoardRequest, defer } from "../agenda/board";
import { sha256Hex } from "../config/loadConfig";
import type { Env } from "../env";
import { FeedFetchError } from "../feeds/fetchFeed";
import {
  DeadlineError,
  FlightPausedError,
  SingleFlight,
} from "../feeds/flight";
import {
  cacheBackend,
  kvBackend,
  SourceStore,
  type StoreBackend,
} from "../feeds/sourceStore";
import { errorName } from "../http/errors";
import { logWarn } from "../log";
import {
  WEATHER_FRESH_SECONDS,
  WEATHER_GEOCODE_TTL_SECONDS,
  WEATHER_LAST_GOOD_SECONDS,
  WEATHER_PLACE_MISS_TTL_SECONDS,
  WEATHER_RETRY_AFTER_FAILURE_SECONDS,
} from "./budget";
import { condenseForecast } from "./condense";
import {
  type Coordinates,
  fetchForecast,
  geocode,
  type UpstreamLimits,
  WEATHER_MAX_BYTES,
  WEATHER_TIMEOUT_MS,
  WeatherResponseError,
} from "./openMeteo";

/** Outcome of {@link WeatherService.load}; the route maps it to a response. */
export type WeatherResult =
  | { kind: "off" }
  | { kind: "ok"; body: WeatherResponse }
  | { kind: "place-unknown" }
  | { kind: "unavailable" };

export interface WeatherService {
  load(c: BoardRequest, config: AppConfig): Promise<WeatherResult>;
}

export interface WeatherOptions {
  /** Clock (epoch ms). */
  now: () => number;
  /** Cache API cache used without a KV binding. */
  openCache: () => Promise<Cache>;
  /** Per-request upstream timeout (default 5 s). */
  timeoutMs?: number | undefined;
  /** Upstream size limit (default 1 MB). */
  maxBytes?: number | undefined;
}

/** Version of the stored entries; a different version is a miss. */
const ENTRY_VERSION = 1;

const ForecastEntrySchema = z.object({
  v: z.literal(ENTRY_VERSION),
  forecast: WeatherResponseSchema,
});
type ForecastEntry = z.infer<typeof ForecastEntrySchema>;

/**
 * Result of geocoding a place (stored server-side only, never returned or logged):
 * its coordinates (kept 30 days) or `null` when Open-Meteo knows no such place (a miss,
 * kept 1 hour so a wrong place does not hit the geocoder on every request).
 */
const PlaceEntrySchema = z.object({
  v: z.literal(ENTRY_VERSION),
  resolvedAt: DateTimeStringSchema,
  found: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    })
    .nullable(),
});
type PlaceEntry = z.infer<typeof PlaceEntrySchema>;

function placeTtlSeconds(entry: PlaceEntry): number {
  return entry.found === null
    ? WEATHER_PLACE_MISS_TTL_SECONDS
    : WEATHER_GEOCODE_TTL_SECONDS;
}

/** Thrown inside a flight when the geocoding API has no match for the place. */
class PlaceUnknownError extends Error {
  override readonly name = "PlaceUnknownError";
  constructor() {
    super("Weather place not found");
  }
}

/** Memory entries per isolate (one forecast and one place per config, a few configs). */
const MEMORY_LIMIT = 8;

/** Geocoding language from the config locale (`auto` → English names). */
function geocodingLanguage(config: AppConfig): "de" | "en" {
  return config.locale === "de" ? "de" : "en";
}

function describeFailure(error: unknown): string {
  if (error instanceof FeedFetchError) {
    return error.status === undefined
      ? error.reason
      : `${error.reason} ${String(error.status)}`;
  }
  if (error instanceof WeatherResponseError) {
    return error.reason;
  }
  if (error instanceof DeadlineError) {
    return "timeout";
  }
  // Unexpected error: its type only (messages may quote upstream URLs).
  return `internal ${errorName(error)}`;
}

function fetchedAtMs(entry: ForecastEntry): number {
  return Date.parse(entry.forecast.fetchedAt);
}

/**
 * `/api/weather` (PLAN T-48, ADR-0015): resolves the place (cached 30 days), fetches and
 * condenses the forecast (fresh 30 min) and serves the last good one for up to 24 h
 * when Open-Meteo fails. Cache layers as for the feeds (ADR-0006): a small memory map
 * per isolate in front of KV (`KIDBOARD_CACHE`) or the Cache API, and one upstream load
 * per isolate at a time (single flight). Keys are hashes: the place and the coordinates
 * never appear in a key, response, error or log line.
 */
export function createWeather(options: WeatherOptions): WeatherService {
  const limits: UpstreamLimits = {
    timeoutMs: options.timeoutMs ?? WEATHER_TIMEOUT_MS,
    maxBytes: options.maxBytes ?? WEATHER_MAX_BYTES,
  };
  // Geocoding and forecast run one after the other inside a flight.
  const maxFlightMs = 2 * limits.timeoutMs + FLIGHT_MARGIN_MS;
  const fallbackBackend = cacheBackend(options.openCache);
  const backendFor = (env: Env): StoreBackend =>
    env.KIDBOARD_CACHE === undefined
      ? fallbackBackend
      : kvBackend(env.KIDBOARD_CACHE);
  const store = new SourceStore(MEMORY_LIMIT);
  // One upstream load per forecast key at a time; after a failure no new attempt for
  // 5 minutes (a place the geocoder does not know is not a failure of the upstream).
  const flights = new SingleFlight<WeatherResponse>({
    now: options.now,
    pauseAfterFailureMs: WEATHER_RETRY_AFTER_FAILURE_SECONDS * 1000,
    pauseOn: (error) => !(error instanceof PlaceUnknownError),
    memoryLimit: MEMORY_LIMIT,
  });

  /** Remembers at once; the backend write runs past the response. One write per call. */
  function write(
    c: BoardRequest,
    backend: StoreBackend,
    key: string,
    entry: unknown,
    expiresAtMs: number,
    ttlSeconds: number,
  ): void {
    defer(
      c,
      store.put(backend, key, entry, expiresAtMs, ttlSeconds).catch(() => {
        logWarn(`weather: ${backend.kind} cache write failed`);
      }),
    );
  }

  async function coordinates(
    c: BoardRequest,
    config: AppConfig,
    backend: StoreBackend,
    nowMs: number,
  ): Promise<Coordinates> {
    const weather = config.weather;
    if (weather === undefined) {
      throw new PlaceUnknownError();
    }
    if (weather.latitude !== undefined && weather.longitude !== undefined) {
      return { latitude: weather.latitude, longitude: weather.longitude };
    }
    const place = weather.place ?? "";
    const language = geocodingLanguage(config);
    const key = `v1/weather/place/${(
      await sha256Hex(
        JSON.stringify(["place", place, weather.country ?? "", language]),
      )
    ).slice(0, 32)}`;
    const placeExpiry = (entry: PlaceEntry): number =>
      Date.parse(entry.resolvedAt) + placeTtlSeconds(entry) * 1000;
    const cached = await store.get(
      backend,
      key,
      PlaceEntrySchema,
      placeExpiry,
      nowMs,
    );
    const entry: PlaceEntry = cached ?? {
      v: ENTRY_VERSION,
      resolvedAt: new Date(nowMs).toISOString(),
      found: await geocode(place, weather.country, language, limits),
    };
    if (cached === null) {
      write(c, backend, key, entry, placeExpiry(entry), placeTtlSeconds(entry));
      if (entry.found === null) {
        // Logged once per lookup, not on every request served from the cached miss.
        logWarn("weather: the configured place was not found");
      }
    }
    if (entry.found === null) {
      throw new PlaceUnknownError();
    }
    return { ...entry.found };
  }

  return {
    async load(c, config) {
      const weather = config.weather;
      if (weather === undefined) {
        return { kind: "off" };
      }
      const nowMs = options.now();
      const today = todayInZone(nowMs, config.timeZone);
      const backend = backendFor(c.env);
      // Everything the forecast depends on, hashed: a changed place, unit or zone starts
      // over, while edits elsewhere in the config keep the cached forecast.
      const key = `v1/weather/forecast/${(
        await sha256Hex(
          JSON.stringify([
            "forecast",
            weather,
            config.timeZone,
            geocodingLanguage(config),
          ]),
        )
      ).slice(0, 32)}`;
      const lastGoodExpiry = (entry: ForecastEntry): number =>
        fetchedAtMs(entry) + WEATHER_LAST_GOOD_SECONDS * 1000;
      const cached = await store.get(
        backend,
        key,
        ForecastEntrySchema,
        lastGoodExpiry,
        nowMs,
      );
      // Days before today (config zone) are dropped from whatever is served.
      const serve = (
        forecast: WeatherResponse,
        stale: boolean,
      ): WeatherResult => ({
        kind: "ok",
        body: {
          ...forecast,
          days: forecast.days.filter((d) => d.date >= today),
          stale,
        },
      });
      if (
        cached !== null &&
        nowMs - fetchedAtMs(cached) < WEATHER_FRESH_SECONDS * 1000
      ) {
        return serve(cached.forecast, false);
      }

      try {
        const forecast = await flights.run(key, {
          nowMs,
          maxMs: maxFlightMs,
          defer: (work) => {
            defer(c, work);
          },
          load: async () => {
            const at = await coordinates(c, config, backend, nowMs);
            const raw = await fetchForecast(
              at,
              config.timeZone,
              weather.unit,
              limits,
            );
            const fresh = condenseForecast(
              raw,
              config.timeZone,
              weather.unit,
              nowMs,
            );
            const entry: ForecastEntry = { v: ENTRY_VERSION, forecast: fresh };
            write(
              c,
              backend,
              key,
              entry,
              lastGoodExpiry(entry),
              WEATHER_LAST_GOOD_SECONDS,
            );
            return fresh;
          },
        });
        return serve(forecast, false);
      } catch (error) {
        if (error instanceof PlaceUnknownError) {
          return { kind: "place-unknown" };
        }
        if (!(error instanceof FlightPausedError)) {
          logWarn(
            `weather: upstream failed (${describeFailure(error)}), ${cached === null ? "no last-good forecast" : "serving last-good forecast"}`,
          );
        }
        return cached === null
          ? { kind: "unavailable" }
          : serve(cached.forecast, true);
      }
    },
  };
}
