/** ADR-0015: a condensed forecast counts as fresh for 30 minutes. */
export const WEATHER_FRESH_SECONDS = 30 * 60;
/** ADR-0015: the last good forecast is served (`stale: true`) for up to 24 hours. */
export const WEATHER_LAST_GOOD_SECONDS = 24 * 60 * 60;
/** PLAN T-48: a geocoded place is kept for 30 days. */
export const WEATHER_GEOCODE_TTL_SECONDS = 30 * 24 * 60 * 60;
/** A place the geocoder does not know is asked again after 1 hour (negative cache). */
export const WEATHER_PLACE_MISS_TTL_SECONDS = 60 * 60;
/** After a failed upstream load, Open-Meteo is not asked again for 5 minutes (per isolate). */
export const WEATHER_RETRY_AFTER_FAILURE_SECONDS = 5 * 60;

/**
 * Forecast writes per day: one per refresh, and a refresh happens only once the stored
 * forecast is no longer fresh, so at most `86 400 / 1 800 = 48`.
 */
export const WEATHER_FORECAST_WRITES_PER_DAY = 86_400 / WEATHER_FRESH_SECONDS;

/**
 * Share of `KV_WRITES_PER_DAY_BUDGET` reserved for the weather while it is on: the 48
 * forecast writes plus one for the geocoded place (written once per 30 days, counted
 * as a whole write per day). The feed TTL floor is computed from the rest. An unknown
 * place writes its miss at most 24 times a day (1 h TTL) and then no forecast is
 * written at all, so it stays within the same reservation.
 */
export const WEATHER_KV_WRITES_PER_DAY = WEATHER_FORECAST_WRITES_PER_DAY + 1;
