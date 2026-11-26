import { clothingFor, WeatherResponseSchema } from "@kidboard/shared";
import { describe, expect, it } from "vitest";

import { condenseForecast } from "./condense";
import {
  fixedOffsetTimes,
  type FixtureForecast,
  fixtureUnix,
  forecastFixture,
  unixAtOffset,
} from "./forecastFixture";
import { ForecastSchema, WeatherResponseError } from "./openMeteo";

const FETCHED = Date.parse("2026-11-23T08:00:00Z");
const BERLIN = "Europe/Berlin";

function condense(
  fx: FixtureForecast,
  unit: "celsius" | "fahrenheit" = "celsius",
  timeZone = BERLIN,
): ReturnType<typeof condenseForecast> {
  return condenseForecast(ForecastSchema.parse(fx), timeZone, unit, FETCHED);
}

function nth<T>(items: readonly T[], i: number): T {
  const item = items[i];
  if (item === undefined) {
    throw new Error(`no item ${String(i)}`);
  }
  return item;
}

function hourIndex(fx: FixtureForecast, time: string): number {
  const i = fx.hourly.time.indexOf(fixtureUnix(time));
  if (i < 0) {
    throw new Error(`no hour ${time}`);
  }
  return i;
}

describe("condenseForecast – fixture", () => {
  it("condenses all 7 days with rounded temperatures and daytime feels-like", () => {
    const result = condense(forecastFixture());
    expect(WeatherResponseSchema.parse(result)).toEqual(result);
    expect(result.fetchedAt).toBe("2026-11-23T08:00:00.000Z");
    expect(result.unit).toBe("celsius");
    expect(result.stale).toBe(false);
    expect(result.current).toEqual({ temperature: 5, code: 3 });
    expect(result.days).toEqual([
      {
        date: "2026-11-23",
        code: 3,
        tempMax: 10,
        tempMin: 3,
        feelsMin: 2,
        feelsMax: 8,
        rain: false,
        snow: false,
        uvMax: 1.2,
      },
      {
        date: "2026-11-24",
        code: 61,
        tempMax: 7,
        tempMin: 4,
        feelsMin: 1,
        feelsMax: 7,
        rain: true,
        snow: false,
        uvMax: 0.8,
      },
      {
        date: "2026-11-25",
        code: 0,
        tempMax: 15,
        tempMin: 3,
        feelsMin: 6,
        feelsMax: 12,
        rain: false,
        snow: false,
        uvMax: 3.3,
      },
      {
        date: "2026-11-26",
        code: 71,
        tempMax: 0,
        tempMin: -5,
        feelsMin: -6,
        feelsMax: 0,
        // A high precipitation probability alone (no daytime sum) is not rain.
        rain: false,
        snow: true,
        uvMax: 0.5,
      },
      {
        date: "2026-11-27",
        code: 2,
        tempMax: 25,
        tempMin: 16,
        feelsMin: 19,
        feelsMax: 25,
        rain: false,
        snow: false,
        uvMax: 6.1,
      },
      {
        date: "2026-11-28",
        code: 45,
        tempMax: 11,
        tempMin: 6,
        feelsMin: 5,
        feelsMax: 11,
        rain: false,
        snow: false,
        uvMax: 1.5,
      },
      {
        date: "2026-11-29",
        code: 1,
        tempMax: 19,
        tempMin: 8,
        feelsMin: 10,
        feelsMax: 16,
        rain: false,
        snow: false,
        uvMax: 4,
      },
    ]);
  });

  it("never emits -0", () => {
    const day = condense(forecastFixture()).days[3];
    expect(Object.is(day?.feelsMax, 0)).toBe(true);
    expect(JSON.stringify(day)).not.toContain("-0");
  });

  it("feeds clothingFor consistently (snow day and hot day)", () => {
    const { days } = condense(forecastFixture());
    expect(clothingFor(nth(days, 1)).map((i) => i.key)).toEqual([
      "umbrella",
      "rainBoots",
      "jacket",
      "hat",
      "gloves",
    ]);
    expect(clothingFor(nth(days, 3)).map((i) => i.key)).toEqual([
      "winterBoots",
      "jacket",
      "hat",
      "gloves",
      "scarf",
    ]);
    expect(clothingFor(nth(days, 4)).map((i) => i.key)).toEqual([
      "tshirt",
      "shorts",
      "cap",
      "sunscreen",
    ]);
  });

  it("ignores extra keys and passes the unit through", () => {
    const fx = forecastFixture() as FixtureForecast & Record<string, unknown>;
    fx.future_block = { anything: [1, 2, 3] };
    expect(condense(fx, "fahrenheit").unit).toBe("fahrenheit");
  });
});

describe("condenseForecast – daytime window 07:00–19:00", () => {
  it("uses only hours 07:00 … 19:00 for feels-like", () => {
    const fx = forecastFixture();
    fx.hourly.apparent_temperature[hourIndex(fx, "2026-11-23T06:00")] = -30;
    fx.hourly.apparent_temperature[hourIndex(fx, "2026-11-23T20:00")] = 40;
    let day = condense(fx).days[0];
    expect([day?.feelsMin, day?.feelsMax]).toEqual([2, 8]);

    fx.hourly.apparent_temperature[hourIndex(fx, "2026-11-23T07:00")] = -10.4;
    fx.hourly.apparent_temperature[hourIndex(fx, "2026-11-23T19:00")] = 30.6;
    day = condense(fx).days[0];
    expect([day?.feelsMin, day?.feelsMax]).toEqual([-10, 31]);
  });

  it("rain from probability >= 50 and daytime sum >= 0.5 mm (preceding-hour values 08:00 … 19:00)", () => {
    const rainy = (
      edit: (fx: FixtureForecast, at: (t: string) => number) => void,
    ): boolean | undefined => {
      const fx = forecastFixture();
      edit(fx, (t) => hourIndex(fx, t));
      return condense(fx).days[5]?.rain; // 2026-11-28, fog code 45
    };
    const set =
      (prob: number, mm: number, time: string) =>
      (fx: FixtureForecast, at: (t: string) => number): void => {
        fx.hourly.precipitation_probability[at(time)] = prob;
        fx.hourly.precipitation[at(time)] = mm;
      };
    expect(rainy(() => undefined)).toBe(false);
    expect(rainy(set(50, 0.5, "2026-11-28T12:00"))).toBe(true);
    expect(rainy(set(49, 0.5, "2026-11-28T12:00"))).toBe(false);
    expect(rainy(set(50, 0.4, "2026-11-28T12:00"))).toBe(false);
    // 19:00 holds 18:00-19:00 (inside); 07:00 holds 06:00-07:00 and 20:00 19:00-20:00 (outside).
    expect(rainy(set(80, 3, "2026-11-28T19:00"))).toBe(true);
    expect(rainy(set(80, 3, "2026-11-28T07:00"))).toBe(false);
    expect(rainy(set(80, 3, "2026-11-28T20:00"))).toBe(false);
    // The sum adds up over the daytime hours.
    expect(
      rainy((fx, at) => {
        set(60, 0.3, "2026-11-28T09:00")(fx, at);
        set(10, 0.3, "2026-11-28T15:00")(fx, at);
      }),
    ).toBe(true);
  });

  it.each([
    [51, true],
    [57, true],
    [66, true],
    [80, true],
    [95, true],
    [3, false],
    [45, false],
    [71, false],
  ])("rain by daily code %i -> %s", (code, rain) => {
    const fx = forecastFixture();
    fx.daily.weather_code[0] = code;
    expect(condense(fx).days[0]?.rain).toBe(rain);
  });

  it.each([
    [71, true],
    [77, true],
    [85, true],
    [86, true],
    [3, false],
    [61, false],
  ])("snow by daily code %i -> %s", (code, snow) => {
    const fx = forecastFixture();
    fx.daily.weather_code[0] = code;
    expect(condense(fx).days[0]?.snow).toBe(snow);
  });

  it.each([
    ["2026-11-23T12:00", 0.1, true],
    ["2026-11-23T19:00", 0.2, true],
    ["2026-11-23T12:00", 0, false],
    // Night snow does not count; 07:00 holds 06:00-07:00 and 20:00 19:00-20:00.
    ["2026-11-23T03:00", 5, false],
    ["2026-11-23T07:00", 2, false],
    ["2026-11-23T20:00", 2, false],
  ])("snow by daytime snowfall at %s (%s cm) -> %s", (time, cm, snow) => {
    const fx = forecastFixture();
    fx.hourly.snowfall[hourIndex(fx, time)] = cm;
    expect(condense(fx).days[0]?.snow).toBe(snow);
  });
});

/**
 * A 7-day forecast as Open-Meteo returns it for a request on `firstDate` at the
 * request-time `offsetSeconds`: 24 fixed-offset hours per day, DST ignored. Hourly
 * feels-like = 100 × day index + fixed-offset hour, so the expected window is visible
 * in the values: 7…19 when the config zone matches the fixed offset, shifted by one hour
 * after a switch.
 */
function dstForecast(
  firstDate: string,
  offsetSeconds: number,
): FixtureForecast {
  const fx = forecastFixture();
  const times = fixedOffsetTimes(firstDate, 7, offsetSeconds);
  fx.utc_offset_seconds = offsetSeconds;
  fx.current.time = times.hourly[9] ?? 0;
  fx.hourly = {
    time: times.hourly,
    apparent_temperature: times.hourly.map(
      (_, i) => Math.floor(i / 24) * 100 + (i % 24),
    ),
    precipitation_probability: times.hourly.map(() => 0),
    precipitation: times.hourly.map(() => 0),
    snowfall: times.hourly.map(() => 0),
    uv_index: times.hourly.map(() => 0),
  };
  fx.daily = {
    time: times.daily,
    weather_code: times.daily.map(() => 3),
    temperature_2m_max: times.daily.map(() => 10),
    temperature_2m_min: times.daily.map(() => 0),
    uv_index_max: times.daily.map(() => 1),
  };
  return fx;
}

function feelsByDay(
  fx: FixtureForecast,
  timeZone: string,
): [string, number, number][] {
  return condense(fx, "celsius", timeZone).days.map((d) => [
    d.date,
    d.feelsMin,
    d.feelsMax,
  ]);
}

describe("condenseForecast – DST switch inside the forecast (config zone wins)", () => {
  // Requested on 2026-10-22 at CEST (+02:00); Berlin falls back on 2026-10-25 at 03:00.
  const BERLIN_CEST = 2 * 3600;

  it("Europe/Berlin fall back: the window moves to fixed-offset 08:00-20:00 after the switch", () => {
    const fx = dstForecast("2026-10-22", BERLIN_CEST);
    expect(fx.hourly.time).toHaveLength(7 * 24);
    expect(feelsByDay(fx, BERLIN)).toEqual([
      ["2026-10-22", 7, 19],
      ["2026-10-23", 107, 119],
      ["2026-10-24", 207, 219],
      // 07:00 CET = 08:00 at the request-time offset.
      ["2026-10-25", 308, 320],
      ["2026-10-26", 408, 420],
      ["2026-10-27", 508, 520],
      ["2026-10-28", 608, 620],
    ]);
  });

  it("America/Los_Angeles spring forward: the window moves to fixed-offset 06:00-18:00 after the switch", () => {
    // Requested on 2027-03-11 at PST (−08:00); LA springs forward on 2027-03-14 at 02:00.
    const fx = dstForecast("2027-03-11", -8 * 3600);
    expect(feelsByDay(fx, "America/Los_Angeles")).toEqual([
      ["2027-03-11", 7, 19],
      ["2027-03-12", 107, 119],
      ["2027-03-13", 207, 219],
      // 07:00 PDT = 06:00 at the request-time offset.
      ["2027-03-14", 306, 318],
      ["2027-03-15", 406, 418],
      ["2027-03-16", 506, 518],
      ["2027-03-17", 606, 618],
    ]);
  });

  it("counts preceding-hour precipitation by config-zone hours after the switch", () => {
    const rainy = (fixedTime: string): boolean | undefined => {
      const fx = dstForecast("2026-10-22", BERLIN_CEST);
      const i = fx.hourly.time.indexOf(unixAtOffset(fixedTime, BERLIN_CEST));
      fx.hourly.precipitation_probability[i] = 80;
      fx.hourly.precipitation[i] = 3;
      return condense(fx).days.find((d) => d.date === "2026-10-26")?.rain;
    };
    // Fixed +02:00 times: 20:00 = 19:00 CET (holds 18:00-19:00, inside), 21:00 = 20:00
    // CET (outside), 08:00 = 07:00 CET (holds 06:00-07:00, outside), 09:00 = 08:00 CET.
    expect(rainy("2026-10-26T20:00")).toBe(true);
    expect(rainy("2026-10-26T21:00")).toBe(false);
    expect(rainy("2026-10-26T08:00")).toBe(false);
    expect(rainy("2026-10-26T09:00")).toBe(true);
  });
});

describe("condenseForecast – missing data", () => {
  it("skips days with a missing code, high, low or without daytime feels-like", () => {
    const fx = forecastFixture();
    fx.daily.weather_code[1] = null;
    fx.daily.temperature_2m_max[2] = null;
    fx.daily.temperature_2m_min[3] = null;
    for (let h = 7; h <= 19; h += 1) {
      fx.hourly.apparent_temperature[
        hourIndex(fx, `2026-11-27T${String(h).padStart(2, "0")}:00`)
      ] = null;
    }
    // Shorter arrays count as missing values for the last day.
    fx.daily.temperature_2m_min = fx.daily.temperature_2m_min.slice(0, 6);
    expect(condense(fx).days.map((d) => d.date)).toEqual([
      "2026-11-23",
      "2026-11-28",
    ]);
  });

  it("tolerates missing optional values (UV, precipitation, snowfall)", () => {
    const fx = forecastFixture();
    fx.daily.uv_index_max[0] = null;
    fx.hourly.snowfall[hourIndex(fx, "2026-11-23T12:00")] = null;
    fx.hourly.precipitation[hourIndex(fx, "2026-11-23T12:00")] = null;
    const day = condense(fx).days[0];
    // UV falls back to the daytime hourly maximum (1 from 10:00 to 15:00).
    expect(day?.uvMax).toBe(1);

    // uv_index is a preceding-hour value: 07:00 (06-07) is outside, 19:00 (18-19) inside.
    const edge = forecastFixture();
    edge.daily.uv_index_max[0] = null;
    edge.hourly.uv_index[hourIndex(edge, "2026-11-23T07:00")] = 9;
    expect(condense(edge).days[0]?.uvMax).toBe(1);
    edge.hourly.uv_index[hourIndex(edge, "2026-11-23T19:00")] = 2.5;
    expect(condense(edge).days[0]?.uvMax).toBe(2.5);
    expect(day?.snow).toBe(false);
    expect(day?.rain).toBe(false);

    const bare = ForecastSchema.parse({
      utc_offset_seconds: 3600,
      current: { temperature_2m: 1, weather_code: 0 },
      hourly: {
        time: [fixtureUnix("2026-11-23T12:00")],
        apparent_temperature: [0.4],
      },
      daily: {
        time: [fixtureUnix("2026-11-23T00:00")],
        weather_code: [0],
        temperature_2m_max: [2],
        temperature_2m_min: [-1],
      },
    });
    expect(condenseForecast(bare, BERLIN, "celsius", FETCHED).days).toEqual([
      {
        date: "2026-11-23",
        code: 0,
        tempMax: 2,
        tempMin: -1,
        feelsMin: 0,
        feelsMax: 0,
        rain: false,
        snow: false,
        uvMax: 0,
      },
    ]);
  });

  it("skips malformed dates and duplicate days, and keeps at most 7 days", () => {
    const fx = forecastFixture();
    // Not a whole unix second, and a repeated midnight.
    fx.daily.time[1] = 1.5;
    fx.daily.time[2] = fixtureUnix("2026-11-23T00:00");
    expect(condense(fx).days.map((d) => d.date)).toEqual([
      "2026-11-23",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ]);

    const long = forecastFixture();
    long.daily.time.push(fixtureUnix("2026-11-30T00:00"));
    for (const key of Object.keys(FIXTURE_DAILY_KEYS) as DailyKey[]) {
      long.daily[key].push(long.daily[key][0] ?? null);
    }
    long.hourly.time.push(fixtureUnix("2026-11-30T12:00"));
    long.hourly.apparent_temperature.push(1);
    expect(condense(long).days).toHaveLength(7);
  });

  it("rejects a forecast without current values or without any usable day", () => {
    const noCurrent = forecastFixture();
    noCurrent.current.temperature_2m = null;
    expect(() => condense(noCurrent)).toThrow(WeatherResponseError);

    const badCode = forecastFixture();
    badCode.current.weather_code = 2.5;
    expect(() => condense(badCode)).toThrow(WeatherResponseError);

    const noDays = forecastFixture();
    noDays.daily.weather_code = noDays.daily.weather_code.map(() => null);
    expect(() => condense(noDays)).toThrow(WeatherResponseError);
  });
});

const FIXTURE_DAILY_KEYS = {
  weather_code: true,
  temperature_2m_max: true,
  temperature_2m_min: true,
  uv_index_max: true,
} as const;
type DailyKey = keyof typeof FIXTURE_DAILY_KEYS;
