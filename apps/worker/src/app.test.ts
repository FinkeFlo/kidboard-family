import {
  AgendaResponseSchema,
  type AppConfigInput,
  AppConfigSchema,
  parseConfig,
  PublicConfigSchema,
  toPublicConfig,
} from "@kidboard/shared";
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

import eventsIcs from "../../../fixtures/ics/api-events.ics?raw";
import mealsIcs from "../../../fixtures/ics/api-meals.ics?raw";
import bringIcs from "../../../fixtures/ics/bring.ics?raw";
import runawayIcs from "../../../fixtures/ics/runaway.ics?raw";
import { FEED_RETRY_AFTER_FAILURE_MS } from "./agenda/loadSource";
import { type AppOptions, createApp } from "./app";
import type { Env } from "./env";
import worker from "./index";

// Synthetic secret URLs (reserved `.invalid` TLD). The tests assert that neither
// string ever shows up in a response or in console output.
const KINDER_URL =
  "https://feeds.kidboard.invalid/calendar/ical/private-TESTONLY-kinder-7f3a/basic.ics";
const ESSEN_URL =
  "https://feeds.kidboard.invalid/calendar/ical/private-TESTONLY-essen-91bc/basic.ics";
const SECRET_FRAGMENTS = [
  KINDER_URL,
  ESSEN_URL,
  "private-TESTONLY-kinder-7f3a",
  "private-TESTONLY-essen-91bc",
];
const TOKEN = "TESTONLY-access-token-not-a-secret-0123456789";

const CONFIG: AppConfigInput = {
  locale: "de",
  timeZone: "Europe/Berlin",
  children: [
    { id: "mia", name: "Mia", color: "#E4572E", avatar: "🦊" },
    { id: "ben", name: "Ben", color: "#2E86AB", avatar: "🐻" },
  ],
  calendars: [
    { id: "kinder", kind: "events", label: "Kinder" },
    { id: "essen", kind: "meals" },
  ],
};

/** Monday 2026-03-09, 10:00 in Berlin. Cached window: 2026-03-08 … 2026-04-10 (exclusive). */
const NOW = Date.parse("2026-03-09T09:00:00Z");
const HOUR = 3_600_000;

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    KIDBOARD_CONFIG: JSON.stringify(CONFIG),
    CAL_KINDER_URL: KINDER_URL,
    CAL_ESSEN_URL: ESSEN_URL,
    // Board tests that do not exercise the access token run as a public board.
    KIDBOARD_PUBLIC: "1",
    ...overrides,
  };
}

type Upstream = (request: Request) => Response | Promise<Response>;

let fetchSpy: MockInstance<typeof fetch>;
let upstream: Map<string, Upstream>;
let consoleOutput: string[];
let seenResponses: string[];
let cacheCounter = 0;

function serve(url: string, handler: Upstream): void {
  upstream.set(url, handler);
}

function serveIcs(url: string, body: string): void {
  serve(
    url,
    () => new Response(body, { headers: { "Content-Type": "text/calendar" } }),
  );
}

function fail(url: string, status = 500): void {
  // Upstream error pages may echo the requested URL; it must not leak from there either.
  serve(url, () => new Response(`Error for ${url}`, { status }));
}

interface Harness {
  call: (path: string, init?: RequestInit, env?: Env) => Promise<Response>;
  /** Base env, plus the KV binding for KV harnesses. */
  env: (overrides?: Partial<Env>) => Env;
  clock: { now: number };
}

type Backend = "cache" | "kv";

/**
 * A fresh app (own memory layer, i.e. a new isolate) on its own named Cache API cache,
 * or on the `KIDBOARD_CACHE` KV namespace from `wrangler.jsonc` (reset after each test).
 */
function harness(
  options: Omit<AppOptions, "now" | "openCache"> & {
    cacheName?: string;
    backend?: Backend;
  } = {},
): Harness {
  const clock = { now: NOW };
  const withBackend = (overrides: Partial<Env> = {}): Env =>
    baseEnv(
      options.backend === "kv"
        ? { KIDBOARD_CACHE: testEnv.KIDBOARD_CACHE, ...overrides }
        : overrides,
    );
  const cacheName =
    options.cacheName ?? `kidboard-test-${String(cacheCounter++)}`;
  const app = createApp({
    ...options,
    now: () => clock.now,
    openCache: () => caches.open(cacheName),
  });
  return {
    clock,
    env: withBackend,
    call: async (path, init, env = withBackend()) => {
      const ctx = createExecutionContext();
      const response = await app.fetch(
        new Request(`https://board.example.test${path}`, init),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);
      const text = await response.clone().text();
      seenResponses.push(text, JSON.stringify([...response.headers]));
      return response;
    },
  };
}

async function agenda(
  h: Harness,
  query = "",
  env?: Env,
): Promise<{
  status: number;
  body: ReturnType<typeof AgendaResponseSchema.parse>;
}> {
  const response = await h.call(`/api/agenda${query}`, undefined, env);
  const json: unknown = await response.json();
  return { status: response.status, body: AgendaResponseSchema.parse(json) };
}

function fetchedUrls(): string[] {
  return fetchSpy.mock.calls.map(([input]) =>
    input instanceof Request ? input.url : String(input),
  );
}

beforeEach(() => {
  upstream = new Map();
  consoleOutput = [];
  seenResponses = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleOutput.push(
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
      const handler = upstream.get(request.url);
      return handler === undefined
        ? new Response("not found", { status: 404 })
        : handler(request);
    });
});

afterEach(async () => {
  await reset();
  const everything = [...seenResponses, ...consoleOutput].join("\n");
  for (const fragment of SECRET_FRAGMENTS) {
    expect(everything).not.toContain(fragment);
  }
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("returns { ok: true } with security headers through the worker entrypoint", async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request("https://board.example.test/api/health"),
      baseEnv(),
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("X-App-Name")).toBe("KidBoard");
    expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("stays public and minimal when an access token is set, even with a broken config", async () => {
    const h = harness();
    const response = await h.call("/api/health", undefined, {
      KIDBOARD_ACCESS_TOKEN: TOKEN,
      KIDBOARD_CONFIG: "{",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("GET /api/agenda – happy path", () => {
  it("merges an events and a meals source into a valid AgendaResponse", async () => {
    serveIcs(KINDER_URL, eventsIcs);
    serveIcs(ESSEN_URL, mealsIcs);
    const h = harness();
    const response = await h.call("/api/agenda");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const body = AgendaResponseSchema.parse(await response.json());

    expect(body.timeZone).toBe("Europe/Berlin");
    expect(body.range).toEqual({ from: "2026-03-09", to: "2026-03-17" });
    expect(body.stale).toBe(false);
    expect(body.generatedAt).toBe(new Date(NOW).toISOString());
    expect(body.sources).toEqual([
      { id: "kinder", status: "ok", fetchedAt: new Date(NOW).toISOString() },
      { id: "essen", status: "ok", fetchedAt: new Date(NOW).toISOString() },
    ]);
    expect(
      body.events.map((e) => [e.icon, e.title, e.start, e.end, e.childIds]),
    ).toEqual([
      ["🏖️", "Ferien", "2026-03-12", "2026-03-14", []],
      [
        "🏫",
        "Kita",
        "2026-03-09T08:00:00+01:00",
        "2026-03-09T12:00:00+01:00",
        [],
      ],
      [
        "🩰",
        "Ballett",
        "2026-03-10T15:00:00+01:00",
        "2026-03-10T16:00:00+01:00",
        ["mia"],
      ],
      [
        "🏫",
        "Kita",
        "2026-03-16T08:00:00+01:00",
        "2026-03-16T12:00:00+01:00",
        [],
      ],
    ]);
    expect(body.events.find((e) => e.title === "Ferien")?.countdown).toBe(true);
    expect(body.meals.map((m) => [m.date, m.slot, m.icon, m.title])).toEqual([
      ["2026-03-10", "lunch", "🍝", "Spaghetti"],
      ["2026-03-11", "dinner", "🍕", "Pizza"],
    ]);
    expect(fetchedUrls().sort()).toEqual([ESSEN_URL, KINDER_URL].sort());
    for (const [, init] of fetchSpy.mock.calls) {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("filters the cached window by from/days without refetching", async () => {
    serveIcs(KINDER_URL, eventsIcs);
    serveIcs(ESSEN_URL, mealsIcs);
    const h = harness();
    await agenda(h);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const yesterday = await agenda(h, "?from=2026-03-08&days=1");
    expect(yesterday.body.range).toEqual({
      from: "2026-03-08",
      to: "2026-03-09",
    });
    expect(yesterday.body.events.map((e) => e.title)).toEqual(["Fußball"]);
    expect(yesterday.body.events[0]?.childIds).toEqual(["ben"]);
    expect(yesterday.body.meals).toEqual([]);

    const later = await agenda(h, "?from=2026-03-17&days=7");
    expect(later.body.range).toEqual({ from: "2026-03-17", to: "2026-03-24" });
    expect(later.body.events.map((e) => [e.title, e.start])).toEqual([
      ["Kita", "2026-03-23T08:00:00+01:00"],
    ]);
    expect(later.body.meals.map((m) => [m.date, m.slot, m.title])).toEqual([
      ["2026-03-20", "unspecified", "Müsli"],
    ]);

    // The window reaches 32 days ahead (countdowns, T-19), across the DST change.
    const april = await agenda(h, "?from=2026-03-27&days=14");
    expect(april.body.events.map((e) => [e.title, e.start])).toEqual([
      ["Kita", "2026-03-30T08:00:00+02:00"],
      ["Zahnarzt", "2026-04-01T09:00:00+02:00"],
      ["Kita", "2026-04-06T08:00:00+02:00"],
    ]);

    // A multi-day all-day event appears for every day it covers.
    const holiday = await agenda(h, "?from=2026-03-13&days=1");
    expect(holiday.body.events.map((e) => e.title)).toEqual(["Ferien"]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("refetches after KIDBOARD_CACHE_TTL and on a new day", async () => {
    serveIcs(KINDER_URL, eventsIcs);
    serveIcs(ESSEN_URL, mealsIcs);
    const h = harness();
    const env = baseEnv({ KIDBOARD_CACHE_TTL: "120" });
    await agenda(h, "", env);
    h.clock.now = NOW + 119_000;
    await agenda(h, "", env);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    h.clock.now = NOW + 121_000;
    const refreshed = await agenda(h, "", env);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(refreshed.body.sources[0]?.fetchedAt).toBe(
      new Date(NOW + 121_000).toISOString(),
    );

    // Default TTL (3600 s) applies to invalid values.
    const h2 = harness();
    const invalidTtl = baseEnv({ KIDBOARD_CACHE_TTL: "soon" });
    await agenda(h2, "", invalidTtl);
    h2.clock.now = NOW + HOUR - 1000;
    await agenda(h2, "", invalidTtl);
    expect(fetchSpy).toHaveBeenCalledTimes(6);
    expect(consoleOutput.join("\n")).toContain(
      "KIDBOARD_CACHE_TTL must be an integer",
    );

    // Day rollover in the config zone moves the window → recompute even within TTL.
    h2.clock.now = Date.parse("2026-03-09T23:00:30Z"); // 00:00:30 on 2026-03-10 in Berlin
    const nextDay = await agenda(h2, "", invalidTtl);
    expect(fetchSpy).toHaveBeenCalledTimes(8);
    expect(nextDay.body.range).toEqual({
      from: "2026-03-10",
      to: "2026-03-18",
    });
  });

  it("maps webcal:// URLs to https://", async () => {
    serveIcs(KINDER_URL, eventsIcs);
    serveIcs(ESSEN_URL, mealsIcs);
    const h = harness();
    const { body } = await agenda(
      h,
      "",
      baseEnv({ CAL_KINDER_URL: KINDER_URL.replace("https://", "webcal://") }),
    );
    expect(body.sources[0]?.status).toBe("ok");
    expect(fetchedUrls()).toContain(KINDER_URL);
  });

  it("reports truncated expansion per source and logs codes only", async () => {
    serveIcs(KINDER_URL, runawayIcs);
    serveIcs(ESSEN_URL, mealsIcs);
    const { status, body } = await agenda(harness());
    expect(status).toBe(200);
    expect(body.sources[0]).toMatchObject({
      id: "kinder",
      status: "ok",
      truncated: true,
    });
    expect(body.sources[1]).not.toHaveProperty("truncated");
    const log = consoleOutput.join("\n");
    expect(log).toContain('source "kinder": iteration-cap x1 (truncated)');
    expect(log).not.toContain("minutely@fixtures");
  });
});

describe.each<[Backend]>([["cache"], ["kv"]])(
  "persistent source cache (%s backend)",
  (backend) => {
    /** Two isolates (separate memory layers) sharing the backend storage. */
    function isolates(): [Harness, Harness] {
      const cacheName = `kidboard-shared-${String(cacheCounter++)}`;
      return [harness({ cacheName, backend }), harness({ cacheName, backend })];
    }

    it("serves a second isolate from the backend without refetching", async () => {
      serveIcs(KINDER_URL, eventsIcs);
      serveIcs(ESSEN_URL, mealsIcs);
      const [a, b] = isolates();
      await agenda(a);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const second = await agenda(b);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(second.body.sources.map((s) => s.status)).toEqual(["ok", "ok"]);
      expect(second.body.events).toHaveLength(4);
      expect(second.body.meals).toHaveLength(2);
    });

    it("serves the stored entry as stale to another isolate when upstream fails", async () => {
      serveIcs(KINDER_URL, eventsIcs);
      serveIcs(ESSEN_URL, mealsIcs);
      const [a, b] = isolates();
      await agenda(a);
      b.clock.now = Date.parse("2026-03-10T07:00:00Z"); // next day, past the TTL
      fail(KINDER_URL, 503);
      fail(ESSEN_URL, 500);
      const { status, body } = await agenda(b);
      expect(status).toBe(200);
      expect(body.stale).toBe(true);
      expect(body.sources.map((s) => [s.status, s.fetchedAt])).toEqual([
        ["stale", new Date(NOW).toISOString()],
        ["stale", new Date(NOW).toISOString()],
      ]);
      expect(body.events.map((e) => e.title)).toEqual([
        "Ferien",
        "Ballett",
        "Kita",
      ]);
    });

    it("ignores stored entries older than 7 days", async () => {
      serveIcs(KINDER_URL, eventsIcs);
      serveIcs(ESSEN_URL, mealsIcs);
      const [a, b] = isolates();
      await agenda(a);
      b.clock.now = NOW + 7 * 24 * HOUR + 1000;
      fail(KINDER_URL);
      fail(ESSEN_URL);
      const { status, body } = await agenda(b);
      expect(status).toBe(502);
      expect(body.sources.map((s) => s.status)).toEqual(["error", "error"]);
    });
  },
);

describe("GET /api/agenda – bring lists (T-33)", () => {
  /** Description fragments that must never leave the worker (ADR-0010). */
  const DESCRIPTION_FRAGMENTS = [
    "TESTONLY-private-note",
    "Mitbringen",
    "mitbringen",
    "Turnschuhe",
    "Badeanzug",
    "Halle 2",
    "Kittel",
    "onerror",
    "<script",
    "<img",
    "&nbsp",
  ];

  function expectNoDescriptionLeak(): void {
    const everything = [...seenResponses, ...consoleOutput].join("\n");
    for (const fragment of DESCRIPTION_FRAGMENTS) {
      expect(everything).not.toContain(fragment);
    }
  }

  it("sets bring per occurrence, never on meals, and leaks nothing else of the description", async () => {
    // The same feed as events and as meals source: meals ignore bring lines.
    serveIcs(KINDER_URL, bringIcs);
    serveIcs(ESSEN_URL, bringIcs);
    const h = harness();
    const { status, body } = await agenda(h, "?from=2026-03-09&days=31");
    expect(status).toBe(200);
    expect(
      body.events.map((e) => [e.title, e.start, e.bring ?? null, e.countdown]),
    ).toEqual([
      ["Ausflug", "2026-03-13", ["🥪", "🧃", "🧢"], true],
      ["Turnen", "2026-03-10T15:00:00+01:00", ["👟", "🩱"], false],
      ["Malen", "2026-03-11T10:00:00+01:00", ["🥼", "🧻"], false],
      ["Mittag: 🍝 Nudeln", "2026-03-12T12:00:00+01:00", ["🥄", "🍴"], false],
      ["Elternabend", "2026-03-12T19:00:00+01:00", null, false],
      // RECURRENCE-ID override (moved by an hour) with its own list; 03-17 is an EXDATE.
      ["Turnen", "2026-03-24T16:00:00+01:00", ["🧴", "🧢"], false],
      ["Turnen", "2026-03-31T15:00:00+02:00", ["👟", "🩱"], false],
      ["Turnen", "2026-04-07T15:00:00+02:00", ["👟", "🩱"], false],
    ]);
    const elternabend = body.events.find((e) => e.title === "Elternabend");
    expect(elternabend).not.toHaveProperty("bring");
    expect(body.meals.length).toBeGreaterThan(0);
    for (const meal of body.meals) {
      expect(meal).not.toHaveProperty("bring");
    }
    // The raw JSON (not only the parsed body) holds no description text.
    expectNoDescriptionLeak();
  });

  it("never logs description text when sources fail (last-good keeps bring)", async () => {
    serveIcs(KINDER_URL, bringIcs);
    fail(ESSEN_URL, 500);
    const h = harness();
    await agenda(h);
    h.clock.now = NOW + 2 * HOUR;
    fail(KINDER_URL, 503);
    const { body } = await agenda(h);
    expect(body.sources[0]?.status).toBe("stale");
    expect(body.events.find((e) => e.title === "Malen")?.bring).toEqual([
      "🥼",
      "🧻",
    ]);
    expect(consoleOutput.length).toBeGreaterThan(0);
    expectNoDescriptionLeak();
  });

  describe("cache entries written before bring lists (entry version 1)", () => {
    /** Rewrites every stored KV entry as a deploy before T-33 would have written it. */
    async function downgradeStoredEntries(): Promise<void> {
      const { keys } = await testEnv.KIDBOARD_CACHE.list();
      expect(keys.length).toBeGreaterThan(0);
      for (const { name } of keys) {
        const raw = (await testEnv.KIDBOARD_CACHE.get(name)) ?? "";
        const entry = JSON.parse(raw) as {
          v: number;
          events: Record<string, unknown>[];
        };
        expect(entry.v).toBe(2);
        entry.v = 1;
        for (const event of entry.events) {
          delete event.bring;
        }
        await testEnv.KIDBOARD_CACHE.put(name, JSON.stringify(entry));
      }
    }

    it("are not served as fresh: a new isolate refetches and shows bring lists", async () => {
      serveIcs(KINDER_URL, bringIcs);
      serveIcs(ESSEN_URL, mealsIcs);
      await agenda(harness({ backend: "kv" }));
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      await downgradeStoredEntries();

      // Same time, well within the TTL: only the version makes the entry not fresh.
      const after = await agenda(harness({ backend: "kv" }));
      expect(fetchSpy).toHaveBeenCalledTimes(4);
      expect(after.body.sources.map((s) => s.status)).toEqual(["ok", "ok"]);
      expect(
        after.body.events.find((e) => e.title === "Turnen")?.bring,
      ).toEqual(["👟", "🩱"]);
      // The refresh overwrote the old entry under the same key.
      const { keys } = await testEnv.KIDBOARD_CACHE.list();
      for (const { name } of keys) {
        const raw = (await testEnv.KIDBOARD_CACHE.get(name)) ?? "";
        expect((JSON.parse(raw) as { v: number }).v).toBe(2);
      }
      // A third isolate is served fresh from the rewritten entries.
      await agenda(harness({ backend: "kv" }));
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    it("still serve as last-good (without bring) when upstream fails", async () => {
      serveIcs(KINDER_URL, bringIcs);
      serveIcs(ESSEN_URL, mealsIcs);
      await agenda(harness({ backend: "kv" }));
      await downgradeStoredEntries();
      fail(KINDER_URL, 503);
      fail(ESSEN_URL, 500);

      const { status, body } = await agenda(harness({ backend: "kv" }));
      expect(status).toBe(200);
      expect(body.stale).toBe(true);
      expect(body.sources.map((s) => [s.status, s.fetchedAt])).toEqual([
        ["stale", new Date(NOW).toISOString()],
        ["stale", new Date(NOW).toISOString()],
      ]);
      expect(body.events.map((e) => e.title)).toContain("Turnen");
      for (const event of body.events) {
        expect(event).not.toHaveProperty("bring");
      }
    });
  });
});

describe("KV backend", () => {
  it("stores one entry per source, without URLs, under hashed keys", async () => {
    serveIcs(KINDER_URL, eventsIcs);
    serveIcs(ESSEN_URL, mealsIcs);
    await agenda(harness({ backend: "kv" }));
    const { keys } = await testEnv.KIDBOARD_CACHE.list();
    expect(keys).toHaveLength(2);
    for (const { name } of keys) {
      expect(name).toMatch(/^v1\/source\/(kinder|essen)\/[0-9a-f]{32}$/);
      const value = (await testEnv.KIDBOARD_CACHE.get(name)) ?? "";
      expect(value).toContain('"fetchedAt"');
      for (const fragment of SECRET_FRAGMENTS) {
        expect(value).not.toContain(fragment);
      }
    }
  });

  it("raises the TTL to stay within the KV write budget", async () => {
    serveIcs(KINDER_URL, eventsIcs);
    serveIcs(ESSEN_URL, mealsIcs);
    const h = harness({ backend: "kv" });
    const env = h.env({ KIDBOARD_CACHE_TTL: "120" });
    await agenda(h, "", env);
    // 2 sources × 86 400 / 500 = 345.6 → 346 s instead of 120 s.
    h.clock.now = NOW + 345_000;
    await agenda(h, "", env);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    h.clock.now = NOW + 347_000;
    await agenda(h, "", env);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(consoleOutput.join("\n")).toContain(
      "KIDBOARD_CACHE_TTL 120 s would exceed the KV write budget for 2 calendars; using 346 s",
    );
  });

  it("keeps working (memory layer) when KV writes fail", async () => {
    serveIcs(KINDER_URL, eventsIcs);
    serveIcs(ESSEN_URL, mealsIcs);
    const h = harness({ backend: "kv" });
    const failing: KVNamespace = Object.assign(
      Object.create(testEnv.KIDBOARD_CACHE) as KVNamespace,
      {
        put: () => Promise.reject(new Error("KV put() limit exceeded")),
      },
    );
    const env = h.env({ KIDBOARD_CACHE: failing });
    expect((await agenda(h, "", env)).status).toBe(200);
    expect((await agenda(h, "", env)).body.sources[0]?.status).toBe("ok");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(consoleOutput.join("\n")).toContain(
      'source "kinder": kv cache write failed',
    );
  });
});

describe("single flight", () => {
  it("shares one upstream fetch between concurrent requests of an isolate", async () => {
    serveIcs(KINDER_URL, eventsIcs);
    serveIcs(ESSEN_URL, mealsIcs);
    const h = harness();
    const results = await Promise.all([agenda(h), agenda(h), agenda(h)]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const { status, body } of results) {
      expect(status).toBe(200);
      expect(body.events).toHaveLength(4);
    }
  });

  it("bounds waiting on a flight that never settles, then pauses the source for 5 minutes", async () => {
    // fetchTimeoutMs 50 → every waiter gives up after 50 + FLIGHT_MARGIN_MS (1000) ms.
    const h = harness({ fetchTimeoutMs: 50 });
    // Ignores the abort signal and never settles, like a load whose request was cancelled.
    serve(KINDER_URL, () => new Promise<Response>(() => undefined));
    serveIcs(ESSEN_URL, mealsIcs);
    const kinderFetches = (): number =>
      fetchedUrls().filter((u) => u === KINDER_URL).length;

    const first = await agenda(h);
    expect(first.body.sources[0]).toEqual({ id: "kinder", status: "error" });
    expect(first.body.sources[1]?.status).toBe("ok");
    expect(kinderFetches()).toBe(1);
    expect(consoleOutput.join("\n")).toContain(
      'source "kinder": upstream failed (timeout)',
    );

    serveIcs(KINDER_URL, eventsIcs);
    // Paused after the failure: no new fetch, the board answers without waiting.
    h.clock.now = NOW + 1000;
    const paused = await agenda(h);
    expect(paused.body.sources[0]?.status).toBe("error");
    expect(kinderFetches()).toBe(1);

    // After the pause the source is fetched again.
    h.clock.now = NOW + FEED_RETRY_AFTER_FAILURE_MS + 1;
    const fresh = await agenda(h);
    expect(fresh.body.sources[0]?.status).toBe("ok");
    expect(fresh.body.events).toHaveLength(4);
    expect(kinderFetches()).toBe(2);
  });

  it("does not fetch a failing feed on every request, but pauses it for 5 minutes", async () => {
    fail(KINDER_URL);
    serveIcs(ESSEN_URL, mealsIcs);
    const h = harness();
    await agenda(h);
    const kinderFetches = (): number =>
      fetchedUrls().filter((u) => u === KINDER_URL).length;
    expect(kinderFetches()).toBe(1);
    serveIcs(KINDER_URL, eventsIcs);
    h.clock.now = NOW + FEED_RETRY_AFTER_FAILURE_MS - 1000;
    expect((await agenda(h)).body.sources[0]?.status).toBe("error");
    expect(kinderFetches()).toBe(1);
    h.clock.now = NOW + FEED_RETRY_AFTER_FAILURE_MS;
    expect((await agenda(h)).body.sources[0]?.status).toBe("ok");
    expect(kinderFetches()).toBe(2);
  });

  it("serves last-good data during the pause without asking the feed again", async () => {
    const h = harness();
    serveIcs(KINDER_URL, eventsIcs);
    serveIcs(ESSEN_URL, mealsIcs);
    await agenda(h);
    h.clock.now = NOW + 2 * HOUR; // past the default TTL, within 7 days
    fail(KINDER_URL, 500);
    expect((await agenda(h)).body.sources[0]?.status).toBe("stale");
    const fetched = fetchSpy.mock.calls.length;
    h.clock.now += 60_000;
    expect((await agenda(h)).body.sources[0]?.status).toBe("stale");
    expect(fetchSpy.mock.calls.length).toBe(fetched); // nothing fetched at all
    expect(fetchedUrls().filter((u) => u === KINDER_URL)).toHaveLength(2); // priming + the one failed refresh
  });
});

describe("GET /api/agenda – upstream failures", () => {
  async function primeThenAdvance(h: Harness): Promise<void> {
    serveIcs(KINDER_URL, eventsIcs);
    serveIcs(ESSEN_URL, mealsIcs);
    await agenda(h);
    h.clock.now = NOW + 2 * HOUR; // past the default TTL, within 7 days
  }

  it("serves last-good data as stale on upstream 500", async () => {
    const h = harness();
    await primeThenAdvance(h);
    fail(KINDER_URL, 500);
    const { status, body } = await agenda(h);
    expect(status).toBe(200);
    expect(body.stale).toBe(true);
    expect(body.sources).toEqual([
      { id: "kinder", status: "stale", fetchedAt: new Date(NOW).toISOString() },
      {
        id: "essen",
        status: "ok",
        fetchedAt: new Date(NOW + 2 * HOUR).toISOString(),
      },
    ]);
    expect(body.generatedAt).toBe(new Date(NOW).toISOString());
    expect(body.events.map((e) => e.title)).toEqual([
      "Ferien",
      "Kita",
      "Ballett",
      "Kita",
    ]);
    expect(consoleOutput.join("\n")).toContain(
      'source "kinder": upstream failed (http-status 500), serving last-good data',
    );
  });

  it("serves last-good data across midnight (last-good key is day independent)", async () => {
    const h = harness();
    await primeThenAdvance(h);
    h.clock.now = Date.parse("2026-03-10T07:00:00Z");
    fail(KINDER_URL, 503);
    const { body } = await agenda(h);
    expect(body.range.from).toBe("2026-03-10");
    expect(body.sources[0]?.status).toBe("stale");
    expect(body.events.map((e) => e.title)).toEqual([
      "Ferien",
      "Ballett",
      "Kita",
    ]);
  });

  it("drops last-good data older than 7 days", async () => {
    const h = harness();
    await primeThenAdvance(h);
    h.clock.now = NOW + 7 * 24 * HOUR + 1000;
    fail(KINDER_URL);
    const { body } = await agenda(h);
    expect(body.sources[0]).toEqual({ id: "kinder", status: "error" });
  });

  it("marks a source without last-good data as error (200 while another source works)", async () => {
    fail(KINDER_URL, 500);
    serveIcs(ESSEN_URL, mealsIcs);
    const { status, body } = await agenda(harness());
    expect(status).toBe(200);
    expect(body.stale).toBe(false);
    expect(body.sources[0]).toEqual({ id: "kinder", status: "error" });
    expect(body.sources[1]?.status).toBe("ok");
    expect(body.events).toEqual([]);
    expect(body.meals).toHaveLength(2);
    expect(consoleOutput.join("\n")).toContain("no last-good data");
  });

  it("returns 502 with a valid body when every source fails", async () => {
    fail(KINDER_URL, 500);
    fail(ESSEN_URL, 404);
    const { status, body } = await agenda(harness());
    expect(status).toBe(502);
    expect(body.sources).toEqual([
      { id: "kinder", status: "error" },
      { id: "essen", status: "error" },
    ]);
    expect(body.generatedAt).toBe(new Date(NOW).toISOString());
    expect(body.events).toEqual([]);
    expect(body.meals).toEqual([]);
  });

  it("treats an upstream that never answers as a timeout", async () => {
    const h = harness({ fetchTimeoutMs: 50 });
    await primeThenAdvance(h);
    const hang: Upstream = (request) =>
      new Promise((_, reject) => {
        request.signal.addEventListener("abort", () => {
          reject(new DOMException("timed out", "TimeoutError"));
        });
      });
    serve(KINDER_URL, hang);
    serve(ESSEN_URL, hang);
    const { status, body } = await agenda(h);
    expect(status).toBe(200);
    expect(body.sources.map((s) => s.status)).toEqual(["stale", "stale"]);
    expect(consoleOutput.join("\n")).toContain("upstream failed (timeout)");
  });

  it("times out a body that stalls after the headers", async () => {
    const h = harness({ fetchTimeoutMs: 50 });
    serve(KINDER_URL, () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("BEGIN:VCALENDAR\r\n"));
          // never closes
        },
      });
      return new Response(stream);
    });
    serveIcs(ESSEN_URL, mealsIcs);
    const { status, body } = await agenda(h);
    expect(status).toBe(200);
    expect(body.sources.map((s) => s.status)).toEqual(["error", "ok"]);
    expect(consoleOutput.join("\n")).toContain(
      'source "kinder": upstream failed (timeout)',
    );
  });

  it("rejects bodies above 5 MB (streamed, no Content-Length) and serves last-good", async () => {
    const h = harness();
    await primeThenAdvance(h);
    serve(KINDER_URL, () => {
      const chunk = new Uint8Array(1024 * 1024).fill(0x41);
      let sent = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent > 5) {
            controller.close();
            return;
          }
          sent++;
          controller.enqueue(sent === 6 ? chunk.subarray(0, 1) : chunk);
        },
      });
      return new Response(stream); // 5 MB + 1 byte
    });
    const { body } = await agenda(h);
    expect(body.sources[0]?.status).toBe("stale");
    expect(consoleOutput.join("\n")).toContain("upstream failed (too-large)");
  });

  it("rejects a declared Content-Length above the limit without reading the body", async () => {
    const h = harness({ fetchMaxBytes: 1000 });
    serve(
      KINDER_URL,
      () =>
        new Response(eventsIcs, {
          headers: {
            "Content-Length": String(
              new TextEncoder().encode(eventsIcs).byteLength,
            ),
          },
        }),
    );
    serveIcs(ESSEN_URL, mealsIcs.slice(0, 900));
    const { status, body } = await agenda(h);
    expect(body.sources[0]).toEqual({ id: "kinder", status: "error" });
    // The truncated meals feed fits the limit but is not a complete calendar.
    expect(body.sources[1]).toEqual({ id: "essen", status: "error" });
    expect(status).toBe(502);
    const log = consoleOutput.join("\n");
    expect(log).toContain('source "kinder": upstream failed (too-large)');
    expect(log).toMatch(/source "essen": upstream failed \(parse-/);
  });

  it("serves last-good data when the feed is not iCalendar", async () => {
    const h = harness();
    await primeThenAdvance(h);
    serveIcs(ESSEN_URL, "<html>Sign in</html>");
    const { body } = await agenda(h);
    expect(body.sources[1]?.status).toBe("stale");
    expect(body.meals).toHaveLength(2);
    expect(consoleOutput.join("\n")).toContain(
      "upstream failed (parse-not-ics)",
    );
  });

  it("treats network errors (whose messages may quote the URL) as failures", async () => {
    serve(KINDER_URL, (request) => {
      throw new TypeError(`connect failed for ${request.url}`);
    });
    serveIcs(ESSEN_URL, mealsIcs);
    const { body } = await agenda(harness());
    expect(body.sources[0]).toEqual({ id: "kinder", status: "error" });
    expect(consoleOutput.join("\n")).toContain("upstream failed (network)");
  });
});

describe("GET /api/agenda – secrets", () => {
  it("marks a source with a missing secret as error and names only the secret", async () => {
    serveIcs(KINDER_URL, eventsIcs);
    const env = baseEnv();
    delete env.CAL_ESSEN_URL;
    const { status, body } = await agenda(harness(), "", env);
    expect(status).toBe(200);
    expect(body.sources[1]).toEqual({ id: "essen", status: "error" });
    expect(fetchedUrls()).toEqual([KINDER_URL]);
    expect(consoleOutput.join("\n")).toContain(
      'source "essen": secret CAL_ESSEN_URL is not set',
    );
  });

  it.each([
    ["ftp", "ftp://feeds.kidboard.invalid/private-TESTONLY-kinder-7f3a"],
    [
      "plain http",
      "http://feeds.kidboard.invalid/private-TESTONLY-kinder-7f3a",
    ],
  ])(
    "rejects secrets that are not https URLs (%s) without fetching",
    async (_, url) => {
      const { status, body } = await agenda(
        harness(),
        "",
        baseEnv({
          CAL_KINDER_URL: url,
          CAL_ESSEN_URL: "private-TESTONLY-essen-91bc",
        }),
      );
      expect(status).toBe(502);
      expect(body.sources.map((s) => s.status)).toEqual(["error", "error"]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(consoleOutput.join("\n")).toContain(
        'source "kinder": secret CAL_KINDER_URL is not an https URL',
      );
    },
  );
});

describe("invalid config", () => {
  it.each([
    ["missing", undefined, "KIDBOARD_CONFIG is not set"],
    ["not JSON", '{"calendars": [ oops', "KIDBOARD_CONFIG is not valid JSON"],
    [
      "schema errors",
      JSON.stringify({ timeZone: "Mars/Olympus", calendars: [], extra: 1 }),
      "KIDBOARD_CONFIG is invalid: ",
    ],
  ])("answers 500 with a generic message (%s)", async (_, raw, logLine) => {
    const env = baseEnv();
    if (raw === undefined) {
      delete env.KIDBOARD_CONFIG;
    } else {
      env.KIDBOARD_CONFIG = raw;
    }
    const h = harness();
    for (const path of ["/api/agenda", "/api/config"]) {
      const response = await h.call(path, undefined, env);
      expect(response.status).toBe(500);
      expect(response.headers.get("Content-Type")).toMatch(
        /^application\/json/,
      );
      expect(await response.json()).toEqual({
        error: "server_misconfigured",
        message: "Server configuration is invalid",
      });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    const log = consoleOutput.join("\n");
    expect(log).toContain(logLine);
    expect(log).not.toContain("oops");
  });

  it("lists the validation errors in the log", async () => {
    const env = baseEnv({
      KIDBOARD_CONFIG: JSON.stringify({
        timeZone: "Mars/Valles",
        calendars: "kinder",
        typo: 2,
      }),
    });
    await harness().call("/api/agenda", undefined, env);
    const log = consoleOutput.join("\n");
    expect(log).toContain("timeZone: Expected a valid IANA time zone");
    expect(log).toMatch(/calendars: .*expected array/);
    expect(log).toContain("typo");
  });
});

describe("GET /api/config", () => {
  it("returns the public config with defaults applied", async () => {
    const response = await harness().call("/api/config");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const parsed = parseConfig(CONFIG);
    if (!parsed.ok) {
      throw new Error("fixture config must be valid");
    }
    expect(await response.json()).toEqual(toPublicConfig(parsed.config));
    expect(
      await harness()
        .call("/api/config")
        .then((r) => r.json()),
    ).not.toHaveProperty("editor");
  });

  const PIN = "246813";
  const ACCESS = { KIDBOARD_ACCESS_TOKEN: TOKEN };

  it.each<[string, Partial<Env>, boolean]>([
    ["no D1 binding and no PIN", ACCESS, false],
    [
      "a valid PIN but no D1 binding",
      { ...ACCESS, KIDBOARD_PARENT_PIN: PIN },
      false,
    ],
    [
      "the D1 binding but no PIN",
      { ...ACCESS, KIDBOARD_DATA: testEnv.KIDBOARD_DATA },
      false,
    ],
    [
      "the D1 binding and the template PIN",
      {
        ...ACCESS,
        KIDBOARD_DATA: testEnv.KIDBOARD_DATA,
        KIDBOARD_PARENT_PIN: "REPLACE_ME",
      },
      false,
    ],
    [
      "the D1 binding and a 5-digit PIN",
      {
        ...ACCESS,
        KIDBOARD_DATA: testEnv.KIDBOARD_DATA,
        KIDBOARD_PARENT_PIN: "13579",
      },
      false,
    ],
    [
      "the D1 binding and a valid PIN but no access token (fail closed)",
      { KIDBOARD_DATA: testEnv.KIDBOARD_DATA, KIDBOARD_PARENT_PIN: PIN },
      false,
    ],
    [
      "the D1 binding, a valid PIN and an empty access token (fail closed)",
      {
        KIDBOARD_DATA: testEnv.KIDBOARD_DATA,
        KIDBOARD_PARENT_PIN: PIN,
        KIDBOARD_ACCESS_TOKEN: "",
      },
      false,
    ],
    [
      "the D1 binding, a valid PIN and an access token",
      {
        ...ACCESS,
        KIDBOARD_DATA: testEnv.KIDBOARD_DATA,
        KIDBOARD_PARENT_PIN: PIN,
      },
      true,
    ],
  ])("reports editor with %s → %s", async (_, overrides, expected) => {
    const h = harness();
    const response = await h.call(
      "/api/config",
      { headers: { Authorization: `Bearer ${TOKEN}` } },
      baseEnv(overrides),
    );
    expect(response.status).toBe(200);
    const body = await response.json<Record<string, unknown>>();
    if (expected) {
      expect(body.editor).toBe(true);
    } else {
      // Omitted, so web bundles that parse the config strictly keep working.
      expect(body).not.toHaveProperty("editor");
      expect(AppConfigSchema.safeParse(body).success).toBe(true);
    }
    expect([...seenResponses, ...consoleOutput].join("\n")).not.toContain(PIN);
  });
});

describe("editor flag and the board", () => {
  it("leaves the Google data unchanged and adds only the empty app sources with the editor on", async () => {
    serveIcs(KINDER_URL, eventsIcs);
    serveIcs(ESSEN_URL, mealsIcs);
    const without = await agenda(harness(), "?days=8");
    const withEditor = await agenda(
      harness(),
      `?days=8&key=${TOKEN}`,
      baseEnv({
        KIDBOARD_DATA: testEnv.KIDBOARD_DATA,
        KIDBOARD_PARENT_PIN: "246813",
        KIDBOARD_ACCESS_TOKEN: TOKEN,
      }),
    );
    expect(without.status).toBe(200);
    expect(without.body.events.length).toBeGreaterThan(0);
    expect(without.body.sources.map((s) => s.id)).toEqual(["kinder", "essen"]);
    expect(withEditor.status).toBe(200);
    expect(withEditor.body.events).toEqual(without.body.events);
    expect(withEditor.body.meals).toEqual(without.body.meals);
    expect(withEditor.body.sources.slice(0, 2)).toEqual(without.body.sources);
    expect(
      withEditor.body.sources.slice(2).map((s) => [s.id, s.status]),
    ).toEqual([
      ["app-events", "ok"],
      ["app-meals", "ok"],
    ]);
  });
});

describe("no calendars (app entries only, ADR-0014)", () => {
  const NO_CALENDARS = JSON.stringify({ ...CONFIG, calendars: [] });
  const NO_SOURCES_WARNING = "KIDBOARD_CONFIG lists no calendars";

  it("serves an empty board (200, no error) with the editor off and warns once", async () => {
    const h = harness();
    const env = baseEnv({ KIDBOARD_CONFIG: NO_CALENDARS });
    const first = await agenda(h, "?days=8", env);
    const second = await agenda(h, "?days=31", env);
    for (const { status, body } of [first, second]) {
      expect(status).toBe(200);
      expect(body.sources).toEqual([]);
      expect(body.events).toEqual([]);
      expect(body.meals).toEqual([]);
      expect(body.stale).toBe(false);
      expect(body.generatedAt).toBe(new Date(NOW).toISOString());
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    const warnings = consoleOutput.filter((line) =>
      line.includes(NO_SOURCES_WARNING),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("the editor is off");
    expect(consoleOutput.join("\n")).not.toContain("invalid");
  });

  it("works the same when the calendars key is missing, also on KV", async () => {
    const withoutKey: AppConfigInput = { ...CONFIG };
    delete withoutKey.calendars;
    const h = harness({ backend: "kv" });
    const { status, body } = await agenda(
      h,
      "",
      h.env({ KIDBOARD_CONFIG: JSON.stringify(withoutKey) }),
    );
    expect(status).toBe(200);
    expect(body.sources).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("serves the public config with an empty calendar list", async () => {
    const response = await harness().call(
      "/api/config",
      undefined,
      baseEnv({ KIDBOARD_CONFIG: NO_CALENDARS }),
    );
    expect(response.status).toBe(200);
    const body = PublicConfigSchema.parse(await response.json());
    expect(body.calendars).toEqual([]);
    expect(body.children).toEqual(CONFIG.children);
    expect(body.editor).toBe(false);
  });

  it("shows the app sources only, without the warning, while the editor is on", async () => {
    const { status, body } = await agenda(
      harness(),
      `?days=8&key=${TOKEN}`,
      baseEnv({
        KIDBOARD_CONFIG: NO_CALENDARS,
        KIDBOARD_DATA: testEnv.KIDBOARD_DATA,
        KIDBOARD_PARENT_PIN: "246813",
        KIDBOARD_ACCESS_TOKEN: TOKEN,
      }),
    );
    expect(status).toBe(200);
    expect(body.sources.map((s) => [s.id, s.status])).toEqual([
      ["app-events", "ok"],
      ["app-meals", "ok"],
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(consoleOutput.join("\n")).not.toContain(NO_SOURCES_WARNING);
  });

  it("does not warn when calendars are configured", async () => {
    serveIcs(KINDER_URL, eventsIcs);
    serveIcs(ESSEN_URL, mealsIcs);
    const { status, body } = await agenda(harness());
    expect(status).toBe(200);
    expect(body.sources.map((s) => s.id)).toEqual(["kinder", "essen"]);
    expect(consoleOutput.join("\n")).not.toContain(NO_SOURCES_WARNING);
  });
});

describe("access token", () => {
  const env = (): Env => baseEnv({ KIDBOARD_ACCESS_TOKEN: TOKEN });

  it.each([
    ["no credentials", {}, ""],
    ["a wrong bearer token", { Authorization: "Bearer wrong" }, ""],
    ["a token prefix", { Authorization: `Bearer ${TOKEN.slice(0, -1)}` }, ""],
    ["a wrong key", {}, "?key=wrong"],
    ["an empty key", {}, "?key="],
    ["a non-bearer scheme", { Authorization: `Basic ${TOKEN}` }, ""],
  ])("rejects %s with 401", async (_, headers, query) => {
    const h = harness();
    for (const path of [`/api/agenda${query}`, `/api/config${query}`]) {
      const response = await h.call(path, { headers }, env());
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe(
        'Bearer realm="kidboard"',
      );
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({
        error: "unauthorized",
        message: "A valid access token is required",
      });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts the token as bearer header (any scheme case) or as ?key=", async () => {
    serveIcs(KINDER_URL, eventsIcs);
    serveIcs(ESSEN_URL, mealsIcs);
    const h = harness();
    const bearer = await h.call(
      "/api/agenda",
      { headers: { Authorization: `Bearer ${TOKEN}` } },
      env(),
    );
    expect(bearer.status).toBe(200);
    const lower = await h.call(
      "/api/config",
      { headers: { Authorization: `bearer ${TOKEN}` } },
      env(),
    );
    expect(lower.status).toBe(200);
    const key = await h.call(
      `/api/agenda?key=${TOKEN}&days=3`,
      undefined,
      env(),
    );
    expect(key.status).toBe(200);
    const body = AgendaResponseSchema.parse(await key.json());
    expect(body.range).toEqual({ from: "2026-03-09", to: "2026-03-12" });
    // The token never appears in responses.
    expect(seenResponses.join("\n")).not.toContain(TOKEN);
  });

  it.each([
    ["the template value", "REPLACE_ME"],
    ["a value still containing the marker", "my-replace_me-token"],
    ["a token shorter than 32 characters", "familie2026"],
    ["a token with other characters", `${"a".repeat(40)} !`],
  ])(
    "fails closed with 500 for %s, even when the client sends it",
    async (_, placeholder) => {
      const h = harness();
      for (const path of ["/api/agenda", "/api/config"]) {
        for (const init of [
          undefined,
          { headers: { Authorization: `Bearer ${placeholder}` } },
        ]) {
          const response = await h.call(
            path,
            init,
            baseEnv({ KIDBOARD_ACCESS_TOKEN: placeholder }),
          );
          expect(response.status).toBe(500);
          expect(response.headers.get("Cache-Control")).toBe("no-store");
          expect(await response.json()).toEqual({
            error: "server_misconfigured",
            message: "Server configuration is invalid",
          });
        }
      }
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(consoleOutput.join("\n")).toContain(
        "KIDBOARD_ACCESS_TOKEN is not usable",
      );
      // The placeholder value itself is not logged.
      expect(consoleOutput.join("\n")).not.toContain(placeholder);
      // /api/health stays public and reports ok.
      const health = await h.call(
        "/api/health",
        undefined,
        baseEnv({ KIDBOARD_ACCESS_TOKEN: placeholder }),
      );
      expect(health.status).toBe(200);
    },
  );

  it.each([
    ["not set", undefined],
    ["empty", ""],
  ])("fails closed with 500 when the token is %s", async (_, value) => {
    const h = harness();
    const bare = baseEnv();
    delete bare.KIDBOARD_PUBLIC;
    const e =
      value === undefined ? bare : { ...bare, KIDBOARD_ACCESS_TOKEN: value };
    for (const path of ["/api/agenda", "/api/config", "/api/weather"]) {
      const response = await h.call(path, undefined, e);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: "server_misconfigured",
        message: "Server configuration is invalid",
      });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(consoleOutput.join("\n")).toContain(
      "KIDBOARD_ACCESS_TOKEN is not set",
    );
    expect((await h.call("/api/health", undefined, e)).status).toBe(200);
  });

  it("serves a public read-only board only with the explicit KIDBOARD_PUBLIC=1 opt-in", async () => {
    const h = harness();
    for (const token of [undefined, ""]) {
      const e = baseEnv({ KIDBOARD_PUBLIC: "1" });
      if (token !== undefined) {
        e.KIDBOARD_ACCESS_TOKEN = token;
      }
      expect((await h.call("/api/config", undefined, e)).status).toBe(200);
    }
    // Any other value is not an opt-in.
    for (const value of ["", "0", "true", "yes"]) {
      const e = baseEnv({ KIDBOARD_PUBLIC: value });
      expect((await h.call("/api/config", undefined, e)).status).toBe(500);
    }
  });

  it("still requires a valid token when KIDBOARD_PUBLIC=1 is set next to it", async () => {
    const h = harness();
    const e = baseEnv({ KIDBOARD_PUBLIC: "1", KIDBOARD_ACCESS_TOKEN: TOKEN });
    expect((await h.call("/api/config", undefined, e)).status).toBe(401);
    expect(
      (await h.call(`/api/config?key=${TOKEN}`, undefined, e)).status,
    ).toBe(200);
    // A broken token is never rescued by the opt-in.
    const broken = baseEnv({
      KIDBOARD_PUBLIC: "1",
      KIDBOARD_ACCESS_TOKEN: "x",
    });
    expect((await h.call("/api/config", undefined, broken)).status).toBe(500);
  });
});

describe("CORS", () => {
  const origins = "http://localhost:5173, https://dev.example.test";

  it("allows a listed origin", async () => {
    const response = await harness().call(
      "/api/config",
      { headers: { Origin: "http://localhost:5173" } },
      baseEnv({ KIDBOARD_ALLOWED_ORIGINS: origins }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:5173",
    );
    expect(response.headers.get("Vary")).toContain("Origin");
  });

  it("denies other origins and allows none by default", async () => {
    const h = harness();
    const denied = await h.call(
      "/api/config",
      { headers: { Origin: "https://evil.example.test" } },
      baseEnv({ KIDBOARD_ALLOWED_ORIGINS: origins }),
    );
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const byDefault = await h.call("/api/config", {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(byDefault.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("answers preflights for listed origins before the token check", async () => {
    const h = harness();
    const env = baseEnv({
      KIDBOARD_ALLOWED_ORIGINS: origins,
      KIDBOARD_ACCESS_TOKEN: TOKEN,
    });
    const preflight = await h.call(
      "/api/agenda",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://dev.example.test",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization",
        },
      },
      env,
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://dev.example.test",
    );
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toBe(
      "Authorization",
    );
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET,HEAD,OPTIONS",
    );

    const deniedPreflight = await h.call(
      "/api/agenda",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.example.test",
          "Access-Control-Request-Method": "GET",
        },
      },
      env,
    );
    expect(
      deniedPreflight.headers.get("Access-Control-Allow-Origin"),
    ).toBeNull();
  });
});

describe("GET /api/agenda – input validation", () => {
  it.each([
    ["?days=0", "days"],
    ["?days=32", "days"],
    ["?days=100", "days"],
    ["?days=abc", "days"],
    ["?days=1.5", "days"],
    ["?days=-1", "days"],
    ["?days=", "days"],
    ["?days=3&days=4", "days"],
    ["?from=2026-13-01", "from"],
    ["?from=2026-02-30", "from"],
    ["?from=9.3.2026", "from"],
    ["?from=", "from"],
  ])("rejects %s with 400", async (query, field) => {
    const response = await harness().call(`/api/agenda${query}`);
    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
    const body = await response.json<{ error: string; message: string }>();
    expect(body.error).toBe("bad_request");
    expect(body.message.startsWith(`${field} must be`)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["?from=2026-03-07", "before the cached window"],
    ["?from=2026-03-28&days=14", "past the cached window"],
    ["?from=2026-04-05&days=8", "past the cached window"],
    ["?from=2026-03-07&days=31", "31 days from the day before the window"],
    ["?from=2026-03-11&days=31", "31 days from today + 2"],
    ["?from=2027-01-01&days=1", "far future"],
  ])("rejects %s (%s) with 400", async (query) => {
    const response = await harness().call(`/api/agenda${query}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "bad_request",
      message: "from + days must lie between 2026-03-08 and 2026-04-10",
    });
  });

  it("accepts the window edges and the maximum of 31 days", async () => {
    serveIcs(KINDER_URL, eventsIcs);
    serveIcs(ESSEN_URL, mealsIcs);
    const h = harness();
    // The client's request (T-19): today plus the 30 days the countdown looks ahead.
    const month = await agenda(h, "?days=31");
    expect(month.status).toBe(200);
    expect(month.body.range).toEqual({ from: "2026-03-09", to: "2026-04-09" });
    // Covers the whole range, across the DST change (2026-03-29).
    expect(month.body.events.map((e) => e.start)).toContain(
      "2026-04-06T08:00:00+02:00",
    );
    expect((await agenda(h, "?from=2026-03-09&days=31")).body.range).toEqual({
      from: "2026-03-09",
      to: "2026-04-09",
    });
    // A client clock a day off around midnight still fits the window.
    expect((await agenda(h, "?from=2026-03-08&days=31")).body.range).toEqual({
      from: "2026-03-08",
      to: "2026-04-08",
    });
    expect((await agenda(h, "?from=2026-03-10&days=31")).body.range).toEqual({
      from: "2026-03-10",
      to: "2026-04-10",
    });
    expect((await agenda(h, "?from=2026-03-08&days=14")).status).toBe(200);
    expect((await agenda(h, "?from=2026-04-09&days=1")).body.range).toEqual({
      from: "2026-04-09",
      to: "2026-04-10",
    });
    expect((await agenda(h, "?days=1&unknown=x")).status).toBe(200);
  });

  it("uses today in the config zone, not UTC, for the default from", async () => {
    serveIcs(KINDER_URL, eventsIcs);
    serveIcs(ESSEN_URL, mealsIcs);
    const h = harness();
    h.clock.now = Date.parse("2026-03-09T23:30:00Z"); // 2026-03-10 00:30 in Berlin
    expect((await agenda(h)).body.range.from).toBe("2026-03-10");
  });
});

describe("other routes", () => {
  it("answers unknown API paths with a JSON 404", async () => {
    const response = await harness().call("/api/nope");
    expect(response.status).toBe(404);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.json()).toEqual({
      error: "not_found",
      message: "Not found",
    });
  });
});
