import type { Hono } from "hono";

import { loadConfig } from "../config/loadConfig";
import type { AppEnv } from "../env";
import { serverMisconfigured } from "../http/errors";
import { createWeather, type WeatherOptions } from "./weather";

/** Path of the weather API. */
export const WEATHER_PATH = "/api/weather";

/**
 * `GET /api/weather` → `WeatherResponse` (ADR-0015). Weather off → `404 weather_off`;
 * place not found → `503 weather_place_unknown`; upstream failed without a last good
 * forecast → `503 weather_unavailable`. Bodies carry fixed texts only. The access token
 * middleware and `Cache-Control: no-store` apply as for every API route.
 */
export function registerWeatherRoute(
  app: Hono<AppEnv>,
  options: WeatherOptions,
): void {
  const weather = createWeather(options);
  app.get(WEATHER_PATH, async (c) => {
    const loaded = loadConfig(c.env.KIDBOARD_CONFIG);
    if (!loaded.ok) {
      return serverMisconfigured(c);
    }
    const result = await weather.load(c, loaded.config);
    switch (result.kind) {
      case "ok":
        return c.json(result.body);
      case "off":
        return c.json(
          { error: "weather_off", message: "Weather is not configured" },
          404,
        );
      case "place-unknown":
        return c.json(
          {
            error: "weather_place_unknown",
            message: "The configured weather place was not found",
          },
          503,
        );
      case "unavailable":
        return c.json(
          {
            error: "weather_unavailable",
            message: "Weather is temporarily unavailable",
          },
          503,
        );
    }
  });
}
