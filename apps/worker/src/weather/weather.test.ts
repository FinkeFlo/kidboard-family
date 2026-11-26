import { type AppConfigInput, WeatherResponseSchema } from "@kidboard/shared";
import {
  createExecutionContext,
  reset,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env as testEnv } from "cloudflare:workers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";

import { effectiveTtlSeconds, KV_WRITES_PER_DAY_BUDGET } from "../agenda/board";
import { type AppOptions, createApp } from "../app";
import type { Env } from "../env";
import {
  WEATHER_FORECAST_WRITES_PER_DAY,
  WEATHER_KV_WRITES_PER_DAY,
} from "./budget";
import {
  FIXTURE_LATITUDE,
  FIXTURE_LONGITUDE,
  forecastFixture,
} from "./forecastFixture";
import { FORECAST_ENDPOINT, GEOCODING_ENDPOINT } from "./openMeteo";

/** Marker place (PLAN T-48): must never appear in a response, error or log line. */
const PLACE = "TESTONLY-Weatherplace";
const UPSTREAM_REASON = "TESTONLY-upstream-reason";
const TOKEN = "TESTONLY-access-token-not-a-secret-0123456789";
/** Strings that must never leave the worker. */
const NEVER_EXPOSED = [
  PLACE,
  String(FIXTURE_LATITUDE),
  String(FIXTURE_LONGITUDE),
  "open-meteo",
  UPSTREAM_REASON,
];

const BASE_CONFIG: AppConfigInput = {
  locale: "de",
  timeZone: "Europe/Berlin",
  calendars: [{ id: "kinder", kind: "events" }],
  weather: { place: PLACE, country: "DE" },
};

/** Monday 2026-11-23, 09:00 in Berlin (the fixture's first day). */
const NOW = Date.parse("2026-11-23T08:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type Upstream = (request: Request) => Response | Promise<Response>;

let fetchSpy: MockInstance<typeof fetch>;
let geocodingHandler: Upstream;
let forecastHandler: Upstream;
let output: string[];
let cacheCounter = 0;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function geocodingHit(): Response {
  return json({
    results: [
      {
        id: 1,
        name: PLACE,
        latitude: FIXTURE_LATITUDE,
        longitude: FIXTURE_LONGITUDE,
        elevation: 42,
        country_code: "DE",
        timezone: "Europe/Berlin",
      },
    ],
    generationtime_ms: 0.5,
  });
}

function requests(endpoint: string): URL[] {
  return fetchSpy.mock.calls
    .map(
      ([input]) =>
        new URL(input instanceof Request ? input.url : String(input)),
    )
    .filter((url) => `${url.origin}${url.pathname}` === endpoint);
}

interface Harness {
  call: (path?: string, env?: Env) => Promise<Response>;
  env: (config?: Partial<AppConfigInput>, overrides?: Partial<Env>) => Env;
  clock: { now: number };
}

/** A fresh app = a new isolate; `backend: "kv"` binds the test KV namespace. */
function harness(
  options: Omit<AppOptions, "now" | "openCache"> & {
    backend?: "kv" | "cache";
  } = {},
): Harness {
  const clock = { now: NOW };
  const cacheName = `kidboard-weather-${String(cacheCounter++)}`;
  const app = createApp({
    ...options,
    now: () => clock.now,
    openCache: () => caches.open(cacheName),
  });
  const env = (
    config: Partial<AppConfigInput> = {},
    overrides: Partial<Env> = {},
  ): Env => ({
    KIDBOARD_CONFIG: JSON.stringify({ ...BASE_CONFIG, ...config }),
    ...(options.backend === "kv"
      ? { KIDBOARD_CACHE: testEnv.KIDBOARD_CACHE }
      : {}),
    KIDBOARD_PUBLIC: "1",
    ...overrides,
  });
  return {
    clock,
    env,
    call: async (path = "/api/weather", callEnv = env()) => {
      const ctx = createExecutionContext();
      const response = await app.fetch(
        new Request(`https://board.example.test${path}`),
        callEnv,
        ctx,
      );
      await waitOnExecutionContext(ctx);
      output.push(
        await response.clone().text(),
        JSON.stringify([...response.headers]),
      );
      return response;
    },
  };
}

async function weatherBody(
  response: Response,
): Promise<ReturnType<typeof WeatherResponseSchema.parse>> {
  expect(response.status).toBe(200);
  return WeatherResponseSchema.parse(await response.json());
}

beforeEach(() => {
  output = [];
  geocodingHandler = geocodingHit;
  forecastHandler = () => json(forecastFixture());
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      output.push(
        args
          .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
          .join(" "),
      );
    });
  }
  fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const endpoint = `${url.origin}${url.pathname}`;
      if (endpoint === GEOCODING_ENDPOINT) {
        return geocodingHandler(request);
      }
      if (endpoint === FORECAST_ENDPOINT) {
        return forecastHandler(request);
      }
      return new Response("not found", { status: 404 });
    });
});

afterEach(async () => {
  await reset();
  const everything = output.join("\n");
  for (const fragment of NEVER_EXPOSED) {
    expect(everything).not.toContain(fragment);
  }
  vi.restoreAllMocks();
});

describe("GET /api/weather – happy path", () => {
  it("geocodes the place, fetches the forecast and returns the condensed DTO", async () => {
    const h = harness();
    const response = await h.call();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await weatherBody(response);
    expect(body.stale).toBe(false);
    expect(body.unit).toBe("celsius");
    expect(body.fetchedAt).toBe("2026-11-23T08:00:00.000Z");
    expect(body.current).toEqual({ temperature: 5, code: 3 });
    expect(body.days).toHaveLength(7);
    expect(body.days[0]).toMatchObject({
      date: "2026-11-23",
      feelsMin: 2,
      feelsMax: 8,
    });

    const [geo] = requests(GEOCODING_ENDPOINT);
    expect(Object.fromEntries(geo?.searchParams ?? [])).toEqual({
      name: PLACE,
      count: "1",
      language: "de",
      format: "json",
      countryCode: "DE",
    });
    const [forecast] = requests(FORECAST_ENDPOINT);
    expect(Object.fromEntries(forecast?.searchParams ?? [])).toEqual({
      latitude: String(FIXTURE_LATITUDE),
      longitude: String(FIXTURE_LONGITUDE),
      timezone: "Europe/Berlin",
      timeformat: "unixtime",
      forecast_days: "7",
      current: "temperature_2m,weather_code",
      hourly:
        "apparent_temperature,precipitation_probability,precipitation,snowfall,uv_index",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,uv_index_max",
      temperature_unit: "celsius",
    });
    const accept = fetchSpy.mock.calls[0]?.[1]?.headers;
    expect(new Headers(accept).get("Accept")).toBe("application/json");
  });

  it("uses configured coordinates without geocoding, and Fahrenheit", async () => {
    const h = harness();
    const env = h.env({
      weather: { latitude: 1.5, longitude: -2.25, unit: "fahrenheit" },
      locale: "auto",
    });
    const body = await weatherBody(await h.call(undefined, env));
    expect(body.unit).toBe("fahrenheit");
    expect(requests(GEOCODING_ENDPOINT)).toHaveLength(0);
    const [forecast] = requests(FORECAST_ENDPOINT);
    expect(forecast?.searchParams.get("latitude")).toBe("1.5");
    expect(forecast?.searchParams.get("longitude")).toBe("-2.25");
    expect(forecast?.searchParams.get("temperature_unit")).toBe("fahrenheit");
  });

  it("geocodes in English for locale en/auto and without countryCode when no country is set", async () => {
    const h = harness();
    await h.call(
      undefined,
      h.env({ locale: "auto", weather: { place: PLACE } }),
    );
    const [geo] = requests(GEOCODING_ENDPOINT);
    expect(geo?.searchParams.get("language")).toBe("en");
    expect(geo?.searchParams.has("countryCode")).toBe(false);
  });

  it("drops days before today from what is served", async () => {
    const h = harness();
    await h.call();
    // Next day 08:00 Berlin: no longer fresh, upstream fails, the last good one is served.
    forecastHandler = () => json({ error: true, reason: UPSTREAM_REASON }, 400);
    h.clock.now = NOW + DAY - HOUR;
    const body = await weatherBody(await h.call());
    expect(body.stale).toBe(true);
    expect(body.days[0]?.date).toBe("2026-11-24");
    expect(body.days).toHaveLength(6);
  });
});

describe("GET /api/weather – off, unknown place, misconfiguration", () => {
  it("answers 404 weather_off without a weather block and fetches nothing", async () => {
    const h = harness();
    const env = h.env();
    const config: Record<string, unknown> = { ...BASE_CONFIG };
    delete config.weather;
    env.KIDBOARD_CONFIG = JSON.stringify(config);
    const response = await h.call(undefined, env);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "weather_off",
      message: "Weather is not configured",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers 503 weather_place_unknown when geocoding has no result", async () => {
    geocodingHandler = () => json({ generationtime_ms: 0.2 });
    const h = harness();
    const response = await h.call();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "weather_place_unknown",
      message: "The configured weather place was not found",
    });
    expect(requests(FORECAST_ENDPOINT)).toHaveLength(0);
    expect(output.join("\n")).toContain(
      "weather: the configured place was not found",
    );
    // The config stays valid: the board's other routes keep working.
    expect((await h.call("/api/config")).status).toBe(200);
  });

  it("caches a geocoding miss for 1 hour (memory and KV), then asks again", async () => {
    geocodingHandler = () => json({ generationtime_ms: 0.2 });
    const h = harness({ backend: "kv" });
    expect((await h.call()).status).toBe(503);
    h.clock.now = NOW + HOUR - 1;
    expect((await h.call()).status).toBe(503);
    // Another isolate finds the miss in KV.
    const other = harness({ backend: "kv" });
    other.clock.now = NOW + HOUR - 1;
    const response = await other.call();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "weather_place_unknown",
    });
    expect(requests(GEOCODING_ENDPOINT)).toHaveLength(1);
    // Logged when the miss was resolved, not again for the cached hits.
    expect(
      output.filter((line) =>
        line.includes("weather: the configured place was not found"),
      ),
    ).toHaveLength(1);

    // After the hour the place is looked up again (and is now known).
    geocodingHandler = geocodingHit;
    h.clock.now = NOW + HOUR;
    expect((await weatherBody(await h.call())).stale).toBe(false);
    expect(requests(GEOCODING_ENDPOINT)).toHaveLength(2);

    const { keys } = await testEnv.KIDBOARD_CACHE.list();
    const place = keys.find((k) => k.name.startsWith("v1/weather/place/"));
    expect(place?.name).toMatch(/^v1\/weather\/place\/[0-9a-f]{32}$/);
  });

  it("answers 500 server_misconfigured for an invalid config", async () => {
    const h = harness();
    const response = await h.call(
      undefined,
      h.env({}, { KIDBOARD_CONFIG: "{" }),
    );
    expect(response.status).toBe(500);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("GET /api/weather – upstream failures", () => {
  const unavailable = {
    error: "weather_unavailable",
    message: "Weather is temporarily unavailable",
  };

  it("400 error object → 503 weather_unavailable without upstream text", async () => {
    forecastHandler = () => json({ error: true, reason: UPSTREAM_REASON }, 400);
    const h = harness();
    const response = await h.call();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(unavailable);
    expect(output.join("\n")).toContain(
      "weather: upstream failed (http-status 400), no last-good forecast",
    );
  });

  it("geocoding failure → 503 weather_unavailable", async () => {
    geocodingHandler = () => new Response(`Error ${PLACE}`, { status: 502 });
    const h = harness();
    const response = await h.call();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(unavailable);
  });

  it("times out after the configured limit", async () => {
    // Never answers, but honours the abort signal like a real fetch.
    forecastHandler = (request) =>
      new Promise<Response>((_, reject) => {
        request.signal.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const h = harness({ weatherTimeoutMs: 50 });
    const response = await h.call();
    expect(response.status).toBe(503);
    expect(output.join("\n")).toContain("weather: upstream failed (timeout)");
  });

  it("rejects a body over 1 MB (streamed, no Content-Length)", async () => {
    const big = `{"pad":"${"x".repeat(1024 * 1024)}"}`;
    forecastHandler = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(big));
            controller.close();
          },
        }),
      );
    const h = harness();
    const response = await h.call();
    expect(response.status).toBe(503);
    expect(output.join("\n")).toContain("weather: upstream failed (too-large)");
  });

  it("rejects invalid JSON and an unexpected shape", async () => {
    forecastHandler = () => new Response(`not json ${PLACE}`);
    const h = harness();
    expect((await h.call()).status).toBe(503);
    forecastHandler = () => json({ current: { temperature_2m: "warm" } });
    h.clock.now = NOW + 5 * MINUTE; // past the failure backoff
    expect((await h.call()).status).toBe(503);
    const log = output.join("\n");
    expect(log).toContain("weather: upstream failed (invalid-json)");
    expect(log).toContain("weather: upstream failed (invalid-shape)");
  });

  it("serves the last good forecast as stale for up to 24 h, then 503", async () => {
    const h = harness();
    await weatherBody(await h.call());
    forecastHandler = () => new Response("boom", { status: 500 });

    h.clock.now = NOW + 2 * HOUR;
    const stale = await weatherBody(await h.call());
    expect(stale.stale).toBe(true);
    expect(stale.fetchedAt).toBe("2026-11-23T08:00:00.000Z");
    expect(output.join("\n")).toContain(
      "weather: upstream failed (http-status 500), serving last-good forecast",
    );

    h.clock.now = NOW + DAY - 1;
    expect((await weatherBody(await h.call())).stale).toBe(true);

    h.clock.now = NOW + DAY;
    const gone = await h.call();
    expect(gone.status).toBe(503);
    expect(await gone.json()).toEqual(unavailable);
  });

  it("backs off for 5 minutes after a failure without a last good forecast", async () => {
    forecastHandler = () => new Response("boom", { status: 500 });
    const h = harness();
    expect((await h.call()).status).toBe(503);
    forecastHandler = () => json(forecastFixture());
    h.clock.now = NOW + 5 * MINUTE - 1;
    const blocked = await h.call();
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toEqual(unavailable);
    expect(requests(FORECAST_ENDPOINT)).toHaveLength(1);

    h.clock.now = NOW + 5 * MINUTE;
    expect((await weatherBody(await h.call())).stale).toBe(false);
    expect(requests(FORECAST_ENDPOINT)).toHaveLength(2);
  });

  it("serves the last good forecast during the backoff and retries afterwards", async () => {
    const h = harness();
    await weatherBody(await h.call());
    forecastHandler = () => new Response("boom", { status: 500 });
    h.clock.now = NOW + HOUR;
    expect((await weatherBody(await h.call())).stale).toBe(true);
    expect(requests(FORECAST_ENDPOINT)).toHaveLength(2);

    h.clock.now = NOW + HOUR + 4 * MINUTE;
    expect((await weatherBody(await h.call())).stale).toBe(true);
    expect(requests(FORECAST_ENDPOINT)).toHaveLength(2);

    forecastHandler = () => json(forecastFixture());
    h.clock.now = NOW + HOUR + 5 * MINUTE;
    const fresh = await weatherBody(await h.call());
    expect(fresh.stale).toBe(false);
    expect(fresh.fetchedAt).toBe("2026-11-23T09:05:00.000Z");
    expect(requests(FORECAST_ENDPOINT)).toHaveLength(3);
  });

  it("backs off after a geocoding failure too, and per config", async () => {
    geocodingHandler = () => new Response("down", { status: 502 });
    const h = harness();
    expect((await h.call()).status).toBe(503);
    expect((await h.call()).status).toBe(503);
    expect(requests(GEOCODING_ENDPOINT)).toHaveLength(1);
    // Another place is a different forecast key: not blocked.
    geocodingHandler = geocodingHit;
    const other = await h.call(
      undefined,
      h.env({ weather: { place: `${PLACE}-2` } }),
    );
    expect(other.status).toBe(200);
  });
});

describe("GET /api/weather – caching", () => {
  it("serves a forecast fresh for 30 minutes, then refreshes", async () => {
    const h = harness();
    await h.call();
    h.clock.now = NOW + 30 * MINUTE - 1;
    await h.call();
    expect(requests(FORECAST_ENDPOINT)).toHaveLength(1);
    h.clock.now = NOW + 30 * MINUTE;
    const body = await weatherBody(await h.call());
    expect(body.fetchedAt).toBe("2026-11-23T08:30:00.000Z");
    expect(requests(FORECAST_ENDPOINT)).toHaveLength(2);
    // The place was geocoded once.
    expect(requests(GEOCODING_ENDPOINT)).toHaveLength(1);
  });

  it("keeps the geocoded place for 30 days (KV, across isolates)", async () => {
    await harness({ backend: "kv" }).call();
    const second = harness({ backend: "kv" });
    second.clock.now = NOW + 29 * DAY;
    await weatherBody(await second.call());
    expect(requests(GEOCODING_ENDPOINT)).toHaveLength(1);
    expect(requests(FORECAST_ENDPOINT)).toHaveLength(2);

    second.clock.now = NOW + 30 * DAY;
    await weatherBody(await second.call());
    expect(requests(GEOCODING_ENDPOINT)).toHaveLength(2);
  });

  it("shares the cached forecast across isolates via KV, under hashed keys", async () => {
    await harness({ backend: "kv" }).call();
    const other = harness({ backend: "kv" });
    other.clock.now = NOW + 10 * MINUTE;
    expect((await weatherBody(await other.call())).stale).toBe(false);
    expect(requests(FORECAST_ENDPOINT)).toHaveLength(1);

    const { keys } = await testEnv.KIDBOARD_CACHE.list();
    expect(keys.map((k) => k.name).sort()).toEqual([
      expect.stringMatching(/^v1\/weather\/forecast\/[0-9a-f]{32}$/),
      expect.stringMatching(/^v1\/weather\/place\/[0-9a-f]{32}$/),
    ]);
    for (const { name } of keys) {
      const value = (await testEnv.KIDBOARD_CACHE.get(name)) ?? "";
      expect(value).not.toContain(PLACE);
      expect(name).not.toContain(PLACE);
    }
  });

  it("starts over when the place changes", async () => {
    const h = harness();
    await h.call();
    await h.call(undefined, h.env({ weather: { place: `${PLACE}-2` } }));
    expect(requests(GEOCODING_ENDPOINT)).toHaveLength(2);
    expect(requests(FORECAST_ENDPOINT)).toHaveLength(2);
  });

  it("shares one upstream load between concurrent requests (single flight)", async () => {
    const h = harness();
    const responses = await Promise.all([h.call(), h.call(), h.call()]);
    for (const response of responses) {
      expect(response.status).toBe(200);
    }
    expect(requests(GEOCODING_ENDPOINT)).toHaveLength(1);
    expect(requests(FORECAST_ENDPOINT)).toHaveLength(1);
  });

  it("keeps working from memory when KV writes fail", async () => {
    const h = harness({ backend: "kv" });
    const failing: KVNamespace = Object.assign(
      Object.create(testEnv.KIDBOARD_CACHE) as KVNamespace,
      { put: () => Promise.reject(new Error("KV put() limit exceeded")) },
    );
    const env = h.env({}, { KIDBOARD_CACHE: failing });
    expect((await h.call(undefined, env)).status).toBe(200);
    expect((await h.call(undefined, env)).status).toBe(200);
    expect(requests(FORECAST_ENDPOINT)).toHaveLength(1);
    expect(output.join("\n")).toContain("weather: kv cache write failed");
  });
});

describe("KV write budget", () => {
  it(`writes at most ${String(WEATHER_FORECAST_WRITES_PER_DAY)} forecasts per day`, async () => {
    const writes: string[] = [];
    const counting: KVNamespace = Object.assign(
      Object.create(testEnv.KIDBOARD_CACHE) as KVNamespace,
      {
        put: (...args: Parameters<KVNamespace["put"]>) => {
          writes.push(args[0]);
          return testEnv.KIDBOARD_CACHE.put(...args);
        },
      },
    );
    const h = harness({ backend: "kv" });
    const env = h.env({}, { KIDBOARD_CACHE: counting });
    // A board polling every 5 minutes for a whole day.
    for (let t = 0; t < DAY; t += 5 * MINUTE) {
      h.clock.now = NOW + t;
      expect((await h.call(undefined, env)).status).toBe(200);
    }
    const forecastWrites = writes.filter((k) =>
      k.startsWith("v1/weather/forecast/"),
    );
    const placeWrites = writes.filter((k) => k.startsWith("v1/weather/place/"));
    expect(forecastWrites).toHaveLength(48);
    expect(WEATHER_FORECAST_WRITES_PER_DAY).toBe(48);
    expect(placeWrites).toHaveLength(1);
    expect(writes).toHaveLength(forecastWrites.length + placeWrites.length);
  });

  it("reserves the weather writes when computing the feed TTL floor", () => {
    expect(WEATHER_KV_WRITES_PER_DAY).toBe(49);
    // 2 sources × 86 400 / (500 − 49) = 383.1 → 384 s (346 s without weather).
    expect(effectiveTtlSeconds(120, 2, true, WEATHER_KV_WRITES_PER_DAY)).toBe(
      384,
    );
    expect(effectiveTtlSeconds(120, 2, true)).toBe(346);
    expect(effectiveTtlSeconds(120, 2, false, WEATHER_KV_WRITES_PER_DAY)).toBe(
      120,
    );
    expect(KV_WRITES_PER_DAY_BUDGET).toBe(500);
  });

  it("raises the feed TTL on /api/agenda while weather is on", async () => {
    const h = harness({ backend: "kv" });
    const env = h.env(
      {},
      {
        KIDBOARD_CACHE_TTL: "120",
        CAL_KINDER_URL:
          "https://feeds.kidboard.invalid/TESTONLY-weather-budget.ics",
      },
    );
    await h.call("/api/agenda", env);
    expect(output.join("\n")).toContain(
      "KIDBOARD_CACHE_TTL 120 s would exceed the KV write budget for 1 calendars; using 192 s",
    );
  });
});

describe("access token", () => {
  it("requires the token on /api/weather", async () => {
    const h = harness();
    const env = h.env({}, { KIDBOARD_ACCESS_TOKEN: TOKEN });
    const denied = await h.call(undefined, env);
    expect(denied.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
    const allowed = await h.call(`/api/weather?key=${TOKEN}`, env);
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("Cache-Control")).toBe("no-store");
  });
});
