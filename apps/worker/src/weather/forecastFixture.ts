/**
 * Synthetic Open-Meteo forecast responses for tests (never real data), modelled on the
 * documented response of `GET /v1/forecast` with `timezone`, `timeformat=unixtime`,
 * `current`, `hourly` and `daily`: unix-second timestamps, the request-time
 * `utc_offset_seconds` that fixes every day to 24 hours (Open-Meteo ignores DST changes
 * within the range), `*_units` blocks and extra keys the worker must ignore. The
 * coordinates are synthetic markers that tests assert never leak.
 */

/** Marker coordinates of the synthetic geocoding hit. */
export const FIXTURE_LATITUDE = 12.3456;
export const FIXTURE_LONGITUDE = 65.4321;

export const FIXTURE_DATES = [
  "2026-11-23",
  "2026-11-24",
  "2026-11-25",
  "2026-11-26",
  "2026-11-27",
  "2026-11-28",
  "2026-11-29",
] as const;

/** Daily values per fixture date (index = day). */
export const FIXTURE_DAILY = {
  weather_code: [3, 61, 0, 71, 2, 45, 1],
  temperature_2m_max: [9.6, 7.2, 14.5, 0.4, 24.6, 11, 18.5],
  temperature_2m_min: [3.4, 4.1, 2.5, -4.6, 15.5, 6.2, 8],
  uv_index_max: [1.2, 0.8, 3.25, 0.5, 6.1, 1.5, 4],
};

/** Hourly precipitation probability per fixture day (the same for every hour). */
export const FIXTURE_PROBABILITY = [10, 90, 0, 80, 5, 20, 0];

/**
 * Feels-like base per day; hourly `apparent_temperature` = base − 4 + hour / 2, so the
 * daytime window 07:00–19:00 spans base − 0.5 … base + 5.5 and the night hours lie outside
 * it on both ends (00:00 = base − 4, 23:00 = base + 7.5).
 */
export const FIXTURE_FEELS_BASE = [2, 1, 6, -6, 19, 5, 10];

/** Request-time UTC offset of the fixture (Europe/Berlin in November, +01:00). */
export const FIXTURE_UTC_OFFSET_SECONDS = 3600;

const HOUR_SECONDS = 3600;

/**
 * Unix seconds of the wall time `YYYY-MM-DDTHH:MM` at the fixed `offsetSeconds`, as
 * Open-Meteo computes its timestamps.
 */
export function unixAtOffset(localTime: string, offsetSeconds: number): number {
  return Date.parse(`${localTime}:00Z`) / 1000 - offsetSeconds;
}

/** Unix seconds of a fixture wall time `YYYY-MM-DDTHH:MM` (+01:00). */
export function fixtureUnix(localTime: string): number {
  return unixAtOffset(localTime, FIXTURE_UTC_OFFSET_SECONDS);
}

/**
 * Timestamps of `days` fixed-offset days from `firstDate`'s midnight, as Open-Meteo
 * returns them: 24 hourly entries per day, and each day's midnight.
 */
export function fixedOffsetTimes(
  firstDate: string,
  days: number,
  offsetSeconds: number,
): { hourly: number[]; daily: number[] } {
  const start = unixAtOffset(`${firstDate}T00:00`, offsetSeconds);
  return {
    hourly: Array.from(
      { length: days * 24 },
      (_, h) => start + h * HOUR_SECONDS,
    ),
    daily: Array.from(
      { length: days },
      (_, d) => start + d * 24 * HOUR_SECONDS,
    ),
  };
}

export interface FixtureForecast {
  latitude: number;
  longitude: number;
  generationtime_ms: number;
  utc_offset_seconds: number;
  timezone: string;
  timezone_abbreviation: string;
  elevation: number;
  current_units: Record<string, string>;
  current: {
    time: number;
    interval: number;
    temperature_2m: number | null;
    weather_code: number | null;
  };
  hourly_units: Record<string, string>;
  hourly: {
    time: number[];
    apparent_temperature: (number | null)[];
    precipitation_probability: (number | null)[];
    precipitation: (number | null)[];
    snowfall: (number | null)[];
    uv_index: (number | null)[];
  };
  daily_units: Record<string, string>;
  daily: {
    time: number[];
    weather_code: (number | null)[];
    temperature_2m_max: (number | null)[];
    temperature_2m_min: (number | null)[];
    uv_index_max: (number | null)[];
  };
}

/** A fresh, mutable 7-day forecast in Europe/Berlin (celsius). */
export function forecastFixture(): FixtureForecast {
  const times = fixedOffsetTimes(
    FIXTURE_DATES[0],
    FIXTURE_DATES.length,
    FIXTURE_UTC_OFFSET_SECONDS,
  );
  const apparent: number[] = [];
  const probability: number[] = [];
  const precipitation: number[] = [];
  const snowfall: number[] = [];
  const uv: number[] = [];
  FIXTURE_DATES.forEach((_, d) => {
    const base = FIXTURE_FEELS_BASE[d] ?? 0;
    for (let h = 0; h < 24; h += 1) {
      apparent.push(base - 4 + h / 2);
      probability.push(FIXTURE_PROBABILITY[d] ?? 0);
      // Day 2 (rain code): 0.7 mm per hour from 10:00 to 21:00.
      precipitation.push(d === 1 && h >= 10 && h <= 21 ? 0.7 : 0);
      // Day 4 (snow code): 0.5 cm per hour from 08:00 to 14:00.
      snowfall.push(d === 3 && h >= 8 && h <= 14 ? 0.5 : 0);
      uv.push(h >= 10 && h <= 15 ? 1 : 0);
    }
  });
  return {
    latitude: FIXTURE_LATITUDE,
    longitude: FIXTURE_LONGITUDE,
    generationtime_ms: 0.123,
    utc_offset_seconds: FIXTURE_UTC_OFFSET_SECONDS,
    timezone: "Europe/Berlin",
    timezone_abbreviation: "GMT+1",
    elevation: 42,
    current_units: {
      time: "unixtime",
      interval: "seconds",
      temperature_2m: "°C",
      weather_code: "wmo code",
    },
    current: {
      time: fixtureUnix("2026-11-23T09:00"),
      interval: 900,
      temperature_2m: 4.6,
      weather_code: 3,
    },
    hourly_units: {
      time: "unixtime",
      apparent_temperature: "°C",
      precipitation_probability: "%",
      precipitation: "mm",
      snowfall: "cm",
      uv_index: "",
    },
    hourly: {
      time: times.hourly,
      apparent_temperature: apparent,
      precipitation_probability: probability,
      precipitation,
      snowfall,
      uv_index: uv,
    },
    daily_units: {
      time: "unixtime",
      weather_code: "wmo code",
      temperature_2m_max: "°C",
      temperature_2m_min: "°C",
      uv_index_max: "",
    },
    daily: {
      time: times.daily,
      weather_code: [...FIXTURE_DAILY.weather_code],
      temperature_2m_max: [...FIXTURE_DAILY.temperature_2m_max],
      temperature_2m_min: [...FIXTURE_DAILY.temperature_2m_min],
      uv_index_max: [...FIXTURE_DAILY.uv_index_max],
    },
  };
}
