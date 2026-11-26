import { z } from "zod";

import { DateStringSchema, DateTimeStringSchema } from "../primitives";

export const TemperatureUnitSchema = z.enum(["celsius", "fahrenheit"]);
export type TemperatureUnit = z.infer<typeof TemperatureUnitSchema>;

/** Maximum number of forecast days in {@link WeatherResponseSchema}. */
export const WEATHER_MAX_DAYS = 7;

/** One forecast day, condensed by the worker (temperatures in whole degrees of `unit`). */
export const WeatherDaySchema = z.object({
  /** Calendar date in the configured time zone. */
  date: DateStringSchema,
  /** WMO weather code of the day. */
  code: z.number().int().min(0),
  tempMax: z.number().int(),
  tempMin: z.number().int(),
  /** Lowest feels-like temperature over the daytime hours 07:00-19:00. */
  feelsMin: z.number().int(),
  /** Highest feels-like temperature over the daytime hours 07:00-19:00. */
  feelsMax: z.number().int(),
  /**
   * Rain: the day's WMO code is drizzle, rain (incl. freezing rain, showers) or thunder,
   * or during 07:00-19:00 the hourly precipitation probability reaches 50 % and the
   * precipitation sum reaches 0.5 mm.
   */
  rain: z.boolean(),
  /**
   * Snow: the day's WMO code is a snow code (snow fall, grains, showers), or the hourly
   * snowfall during 07:00-19:00 adds up to more than 0 cm (night snow alone does not count).
   */
  snow: z.boolean(),
  /** Maximum UV index of the day. */
  uvMax: z.number().min(0),
});
export type WeatherDay = z.infer<typeof WeatherDaySchema>;

/**
 * DTO of `/api/weather`. Never carries the place or coordinates. Objects are not strict,
 * so an old client ignores keys a newer worker adds.
 */
export const WeatherResponseSchema = z.object({
  fetchedAt: DateTimeStringSchema,
  unit: TemperatureUnitSchema,
  current: z.object({
    temperature: z.number().int(),
    code: z.number().int().min(0),
  }),
  days: z.array(WeatherDaySchema).max(WEATHER_MAX_DAYS),
  /** The last good forecast, served because the upstream failed. */
  stale: z.boolean().default(false),
});
export type WeatherResponse = z.infer<typeof WeatherResponseSchema>;
