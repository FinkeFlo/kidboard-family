import {
  type AgendaResponse,
  AgendaResponseSchema,
  type AppConfig,
  type AppConfigInput,
  AppConfigSchema,
  type CalendarEvent,
  type EditorEntryInputRaw,
  type Meal,
} from "@kidboard/shared";
import {
  createExecutionContext,
  reset,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env as testEnv } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import eventsIcs from "../../../../fixtures/ics/api-events.ics?raw";
import mealsIcs from "../../../../fixtures/ics/api-meals.ics?raw";
import { createApp } from "../app";
import { loadConfig } from "../config/loadConfig";
import {
  type AppEntry,
  EntryStore,
  type StoreResult,
} from "../entries/entryStore";
import type { Env } from "../env";
import { cacheBackend, kvBackend, SourceStore } from "../feeds/sourceStore";
import { invalidateAppSources } from "./appSources";

// Synthetic secret URLs (reserved `.invalid` TLD).
const KINDER_URL =
  "https://feeds.kidboard.invalid/calendar/ical/private-TESTONLY-kinder-a1b2/basic.ics";
const ESSEN_URL =
  "https://feeds.kidboard.invalid/calendar/ical/private-TESTONLY-essen-c3d4/basic.ics";
const PIN = "246813";
const ACCESS = "TESTONLY-access-token-not-a-secret-0123456789";
const db = testEnv.KIDBOARD_DATA;

const CONFIG_INPUT: AppConfigInput = {
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
const CONFIG: AppConfig = AppConfigSchema.parse(CONFIG_INPUT);

/** Monday 2026-03-09, 10:00 in Berlin. Cached window: 2026-03-08 … 2026-04-10. */
const NOW = Date.parse("2026-03-09T09:00:00Z");
const HOUR = 3_600_000;
const FULL = "?from=2026-03-09&days=31";

let consoleOutput: string[];
let cacheCounter = 0;

function env(overrides: Partial<Env> = {}): Env {
  return {
    KIDBOARD_CONFIG: JSON.stringify(CONFIG_INPUT),
    CAL_KINDER_URL: KINDER_URL,
    CAL_ESSEN_URL: ESSEN_URL,
    KIDBOARD_DATA: db,
    KIDBOARD_PARENT_PIN: PIN,
    // The editor (and with it the app sources) needs an access token (ADR-0013).
    KIDBOARD_ACCESS_TOKEN: ACCESS,
    // Lets requests without an access token reach the (editor-off) behaviour under test.
    KIDBOARD_PUBLIC: "1",
    ...overrides,
  };
}

interface Harness {
  agenda: (
    query?: string,
    environment?: Env,
  ) => Promise<{ status: number; body: AgendaResponse }>;
  clock: { now: number };
  cacheName: string;
}

/** A fresh app: its own memory layer (a new isolate) and its own Cache API cache. */
function harness(
  cacheName = `kidboard-app-${String(cacheCounter++)}`,
  options: { d1TimeoutMs?: number } = {},
): Harness {
  const clock = { now: NOW };
  const app = createApp({
    now: () => clock.now,
    openCache: () => caches.open(cacheName),
    ...options,
  });
  return {
    clock,
    cacheName,
    agenda: async (query = FULL, environment = env()) => {
      const ctx = createExecutionContext();
      const response = await app.fetch(
        new Request(`https://board.example.test/api/agenda${query}`, {
          headers: { Authorization: `Bearer ${ACCESS}` },
        }),
        environment,
        ctx,
      );
      await waitOnExecutionContext(ctx);
      const json: unknown = await response.json();
      return {
        status: response.status,
        body: AgendaResponseSchema.parse(json),
      };
    },
  };
}

function store(config: AppConfig = CONFIG): EntryStore {
  return new EntryStore(db, { config, now: () => NOW });
}

function ok<T>(result: StoreResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  }
  return result.value;
}

async function create(
  input: EditorEntryInputRaw,
  config?: AppConfig,
): Promise<AppEntry> {
  return ok(await store(config).create(input));
}

/** What T-43's write routes do after a write (drop cached copies), seen from another isolate. */
async function invalidate(cacheName: string, kv = false): Promise<void> {
  await invalidateAppSources({
    configHash: await configHash(),
    store: new SourceStore(),
    backend: kv
      ? kvBackend(testEnv.KIDBOARD_CACHE)
      : cacheBackend(() => caches.open(cacheName)),
  });
}

async function configHash(): Promise<string> {
  const loaded = loadConfig(JSON.stringify(CONFIG_INPUT));
  if (!loaded.ok) {
    throw new Error("fixture config must be valid");
  }
  return loaded.hash;
}

function appEvents(body: AgendaResponse): CalendarEvent[] {
  return body.events.filter((e) => e.sourceId === "app-events");
}

function appMeals(body: AgendaResponse): Meal[] {
  return body.meals.filter((m) => m.sourceId === "app-meals");
}

function times(events: readonly CalendarEvent[]): string[][] {
  return events.map((e) => [e.start, e.end]);
}

/** A D1 binding whose every call never settles (a hanging database). */
function hangingDb(): D1Database {
  const never = (): Promise<never> => new Promise<never>(() => undefined);
  const statement = {
    bind: () => statement,
    first: never,
    run: never,
    all: never,
    raw: never,
  };
  // Test double: only the methods the worker calls are needed, none of them settle.
  return {
    prepare: () => statement,
    batch: never,
    exec: never,
  } as unknown as D1Database;
}

/** A D1 binding whose every call fails like an unavailable database. */
function brokenDb(): D1Database {
  const fail = (): never => {
    throw new Error("D1_ERROR: database unavailable TESTONLY-not-a-secret");
  };
  // Test double: only the methods the worker calls are needed, all of them fail.
  return {
    prepare: fail,
    batch: () => Promise.reject(new Error("D1_ERROR: unavailable")),
    exec: () => Promise.reject(new Error("D1_ERROR: unavailable")),
  } as unknown as D1Database;
}

beforeEach(() => {
  consoleOutput = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(" "));
    });
  }
  const feeds = new Map([
    [KINDER_URL, eventsIcs],
    [ESSEN_URL, mealsIcs],
  ]);
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const request = new Request(input, init);
    const body = feeds.get(request.url);
    return Promise.resolve(
      body === undefined
        ? new Response("not found", { status: 404 })
        : new Response(body, { headers: { "Content-Type": "text/calendar" } }),
    );
  });
});

afterEach(async () => {
  await reset();
  expect(consoleOutput.join("\n")).not.toContain("private-TESTONLY");
  vi.restoreAllMocks();
});

const SWIM: EditorEntryInputRaw = {
  kind: "event",
  childIds: ["mia"],
  icon: "🏊",
  title: "Schwimmen",
  allDay: false,
  date: "2026-03-09",
  startTime: "16:00",
  endTime: "17:00",
  repeat: { weekly: { weekdays: [1] } },
  bring: ["🩱", "🧴"],
};

describe("virtual sources on the board", () => {
  it("lists app-events and app-meals only while the editor is on", async () => {
    await create(SWIM);
    const h = harness();
    const on = await h.agenda();
    expect(on.status).toBe(200);
    expect(on.body.sources.map((s) => [s.id, s.status])).toEqual([
      ["kinder", "ok"],
      ["essen", "ok"],
      ["app-events", "ok"],
      ["app-meals", "ok"],
    ]);
    expect(appEvents(on.body).length).toBeGreaterThan(0);

    const noPin = env();
    delete noPin.KIDBOARD_PARENT_PIN;
    const noDb = env();
    delete noDb.KIDBOARD_DATA;
    const noToken = env();
    delete noToken.KIDBOARD_ACCESS_TOKEN;
    for (const off of [
      noPin,
      env({ KIDBOARD_PARENT_PIN: "REPLACE_ME" }),
      noDb,
      noToken,
      env({ KIDBOARD_ACCESS_TOKEN: "" }),
    ]) {
      const { body } = await harness().agenda(FULL, off);
      expect(body.sources.map((s) => s.id)).toEqual(["kinder", "essen"]);
      expect(appEvents(body)).toEqual([]);
    }
  });

  it("shows an app entry exactly like the same Google event (board parity)", async () => {
    await create({
      kind: "event",
      childIds: ["mia"],
      icon: "🩰",
      title: "Ballett",
      allDay: false,
      date: "2026-03-10",
      startTime: "15:00",
      endTime: "16:00",
    });
    const { body } = await harness().agenda();
    const google = body.events.find(
      (e) => e.sourceId === "kinder" && e.title === "Ballett",
    );
    const [app] = appEvents(body);
    expect(google).toBeDefined();
    expect(app).toEqual({
      ...google,
      id: app?.id,
      sourceId: "app-events",
    });
    expect(app?.id).not.toBe(google?.id);
  });

  it("expands a weekly series across the DST change in Europe/Berlin", async () => {
    await create(SWIM);
    const { body } = await harness().agenda();
    const events = appEvents(body);
    expect(times(events)).toEqual([
      ["2026-03-09T16:00:00+01:00", "2026-03-09T17:00:00+01:00"],
      ["2026-03-16T16:00:00+01:00", "2026-03-16T17:00:00+01:00"],
      ["2026-03-23T16:00:00+01:00", "2026-03-23T17:00:00+01:00"],
      // Summer time from 2026-03-29: same wall-clock time, new offset.
      ["2026-03-30T16:00:00+02:00", "2026-03-30T17:00:00+02:00"],
      ["2026-04-06T16:00:00+02:00", "2026-04-06T17:00:00+02:00"],
    ]);
    for (const event of events) {
      expect(event).toMatchObject({
        title: "Schwimmen",
        icon: "🏊",
        iconIsFallback: false,
        childIds: ["mia"],
        allDay: false,
        countdown: false,
        bring: ["🩱", "🧴"],
      });
    }
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
  });

  it("resolves a weekly occurrence in the spring-forward gap like the expansion does for feeds", async () => {
    // Sundays 02:30-03:30; on 2026-03-29 02:00-03:00 does not exist in Berlin.
    await create({
      kind: "event",
      icon: "🌙",
      title: "Sternwarte",
      allDay: false,
      date: "2026-03-22",
      startTime: "02:30",
      endTime: "03:30",
      repeat: { weekly: { weekdays: [7] } },
    });
    const { body } = await harness().agenda();
    expect(times(appEvents(body))).toEqual([
      ["2026-03-22T02:30:00+01:00", "2026-03-22T03:30:00+01:00"],
      // RFC 5545: a nonexistent 02:30 means 03:30 CEST; the end (03:30 on the wall
      // clock) is then not after the start, so the occurrence becomes zero-length.
      ["2026-03-29T03:30:00+02:00", "2026-03-29T03:30:00+02:00"],
      ["2026-04-05T02:30:00+02:00", "2026-04-05T03:30:00+02:00"],
    ]);
  });

  it("handles every 2 weeks, several weekdays and until", async () => {
    await create({
      ...SWIM,
      bring: [],
      date: "2026-03-10",
      repeat: {
        weekly: { weekdays: [2, 4], interval: 2, until: "2026-04-02" },
      },
    });
    const { body } = await harness().agenda();
    expect(appEvents(body).map((e) => e.start.slice(0, 10))).toEqual([
      "2026-03-10",
      "2026-03-12",
      "2026-03-24",
      "2026-03-26",
    ]);
    expect(appEvents(body)[0]).not.toHaveProperty("bring");
  });

  it("includes the last day of until for timed series after the DST change", async () => {
    await create({
      ...SWIM,
      startTime: "23:30",
      endTime: "23:45",
      repeat: { weekly: { weekdays: [1], until: "2026-03-30" } },
    });
    const { body } = await harness().agenda();
    expect(appEvents(body).map((e) => e.start)).toEqual([
      "2026-03-09T23:30:00+01:00",
      "2026-03-16T23:30:00+01:00",
      "2026-03-23T23:30:00+01:00",
      "2026-03-30T23:30:00+02:00",
    ]);
  });

  it("shows single, all-day, multi-day and countdown entries", async () => {
    await create({
      kind: "event",
      childIds: ["ben"],
      icon: "🦷",
      title: "Zahnarzt",
      allDay: false,
      date: "2026-03-12",
      startTime: "09:30",
    });
    await create({
      kind: "event",
      childIds: [],
      icon: "🏕️",
      title: "Zeltlager",
      allDay: true,
      date: "2026-03-20",
      endDate: "2026-03-23",
      countdown: true,
    });
    await create({
      kind: "event",
      childIds: ["mia", "ben"],
      icon: "🎈",
      title: "Kindergeburtstag",
      allDay: true,
      date: "2026-03-14",
      countdown: true,
    });
    const { body } = await harness().agenda();
    expect(
      appEvents(body).map((e) => ({
        title: e.title,
        childIds: e.childIds,
        allDay: e.allDay,
        start: e.start,
        end: e.end,
        countdown: e.countdown,
      })),
    ).toEqual([
      {
        title: "Kindergeburtstag",
        childIds: ["mia", "ben"],
        allDay: true,
        start: "2026-03-14",
        end: "2026-03-15",
        countdown: true,
      },
      {
        title: "Zeltlager",
        childIds: [],
        allDay: true,
        start: "2026-03-20",
        end: "2026-03-23",
        countdown: true,
      },
      // Timed after all-day (board order); no end time: one hour.
      {
        title: "Zahnarzt",
        childIds: ["ben"],
        allDay: false,
        start: "2026-03-12T09:30:00+01:00",
        end: "2026-03-12T10:30:00+01:00",
        countdown: false,
      },
    ]);
  });

  it("shows meals in their slot on every covered day", async () => {
    await create({
      kind: "meal",
      icon: "🍝",
      title: "Spaghetti",
      allDay: true,
      date: "2026-03-10",
      slot: "lunch",
    });
    await create({
      kind: "meal",
      icon: "🥣",
      title: "Müsli",
      allDay: true,
      date: "2026-03-11",
      endDate: "2026-03-13",
      slot: "breakfast",
    });
    await create({
      kind: "meal",
      icon: "🍕",
      title: "Pizza",
      allDay: false,
      date: "2026-03-13",
      startTime: "18:30",
      slot: "dinner",
      repeat: { weekly: { weekdays: [5], until: "2026-03-20" } },
    });
    const { body } = await harness().agenda();
    expect(
      appMeals(body).map((m) => [m.date, m.slot, m.icon, m.title]),
    ).toEqual([
      ["2026-03-10", "lunch", "🍝", "Spaghetti"],
      ["2026-03-11", "breakfast", "🥣", "Müsli"],
      ["2026-03-12", "breakfast", "🥣", "Müsli"],
      ["2026-03-13", "dinner", "🍕", "Pizza"],
      ["2026-03-20", "dinner", "🍕", "Pizza"],
    ]);
    expect(appEvents(body)).toEqual([]);
    // Google meals are still there.
    expect(body.meals.some((m) => m.sourceId === "essen")).toBe(true);
  });

  it("applies exceptions and moved 'only this day' overrides", async () => {
    const swim = await create(SWIM);
    const s = store();
    const excepted = ok(await s.addException(swim.id, 1, "2026-03-16"));
    ok(
      await s.setOverride(swim.id, excepted.revision, "2026-03-23", {
        ...SWIM,
        title: "Schwimmen mit Oma",
        date: "2026-03-24",
        startTime: "10:00",
        endTime: "11:30",
        repeat: "none",
        bring: ["🧢"],
      }),
    );
    const { body } = await harness().agenda();
    expect(
      appEvents(body).map((e) => [e.start, e.end, e.title, e.bring ?? []]),
    ).toEqual([
      [
        "2026-03-09T16:00:00+01:00",
        "2026-03-09T17:00:00+01:00",
        "Schwimmen",
        ["🩱", "🧴"],
      ],
      [
        "2026-03-24T10:00:00+01:00",
        "2026-03-24T11:30:00+01:00",
        "Schwimmen mit Oma",
        ["🧢"],
      ],
      [
        "2026-03-30T16:00:00+02:00",
        "2026-03-30T17:00:00+02:00",
        "Schwimmen",
        ["🩱", "🧴"],
      ],
      [
        "2026-04-06T16:00:00+02:00",
        "2026-04-06T17:00:00+02:00",
        "Schwimmen",
        ["🩱", "🧴"],
      ],
    ]);
  });

  it("uses the configured zone, not the device zone (UTC here)", async () => {
    const la: AppConfigInput = {
      ...CONFIG_INPUT,
      timeZone: "America/Los_Angeles",
    };
    const laConfig = AppConfigSchema.parse(la);
    await create(
      {
        ...SWIM,
        date: "2026-03-02",
        startTime: "08:00",
        endTime: "09:00",
        repeat: { weekly: { weekdays: [1], until: "2026-03-16" } },
      },
      laConfig,
    );
    // NOW is 02:00 PDT on 2026-03-09 in Los Angeles: the window starts 2026-03-08.
    const full = await harness().agenda(
      "?from=2026-03-08&days=10",
      env({ KIDBOARD_CONFIG: JSON.stringify(la) }),
    );
    expect(full.body.timeZone).toBe("America/Los_Angeles");
    // US summer time started 2026-03-08: 08:00 PDT (15:00 UTC), not 08:00 UTC.
    expect(times(appEvents(full.body))).toEqual([
      ["2026-03-09T08:00:00-07:00", "2026-03-09T09:00:00-07:00"],
      ["2026-03-16T08:00:00-07:00", "2026-03-16T09:00:00-07:00"],
    ]);
  });

  it("keeps HTML-looking title text as plain text", async () => {
    const title = '<img src=x onerror="alert(1)"> & <b>Fest</b>; a, b';
    await create({
      kind: "event",
      icon: "🎉",
      title,
      allDay: true,
      date: "2026-03-11",
      countdown: true,
    });
    const { body } = await harness().agenda();
    expect(appEvents(body).map((e) => e.title)).toEqual([title]);
  });

  it("round-trips children, icon, title, slot and bring from entry to board", async () => {
    const inputs: EditorEntryInputRaw[] = [
      {
        kind: "event",
        childIds: ["ben", "mia"],
        icon: "🛁",
        title: "Mia: Baden",
        allDay: false,
        date: "2026-03-11",
        startTime: "18:00",
        bring: ["🧸", "👩🏽‍🚀"],
      },
      {
        kind: "event",
        childIds: [],
        icon: "❤️",
        title: "Alle: Oma, Opa: Besuch",
        allDay: true,
        date: "2026-03-12",
      },
      {
        kind: "meal",
        icon: "🍲",
        title: "Mittag: Eintopf",
        allDay: true,
        date: "2026-03-12",
        slot: "dinner",
      },
    ];
    for (const input of inputs) {
      await create(input);
    }
    const { body } = await harness().agenda();
    const events = appEvents(body);
    expect(
      events.map((e) => [
        [...e.childIds].sort(),
        e.icon,
        e.title,
        e.bring ?? [],
      ]),
    ).toEqual([
      [[], "❤️", "Alle: Oma, Opa: Besuch", []],
      [["ben", "mia"], "🛁", "Mia: Baden", ["🧸", "👩🏽‍🚀"]],
    ]);
    expect(appMeals(body).map((m) => [m.slot, m.icon, m.title])).toEqual([
      ["dinner", "🍲", "Mittag: Eintopf"],
    ]);
  });
});

describe("ids", () => {
  it("are stable per entry and occurrence across isolates and unrelated writes", async () => {
    const swim = await create(SWIM);
    const first = appEvents((await harness().agenda()).body);
    await create({ ...SWIM, title: "Turnen", icon: "🤸" });
    const h = harness();
    const second = appEvents((await h.agenda()).body).filter(
      (e) => e.title === "Schwimmen",
    );
    expect(second.map((e) => e.id)).toEqual(first.map((e) => e.id));
    expect(new Set(first.map((e) => e.id)).size).toBe(first.length);

    // A moved occurrence keeps its id; the series' other occurrences keep theirs.
    ok(
      await store().setOverride(swim.id, 1, "2026-03-16", {
        ...SWIM,
        date: "2026-03-16",
        startTime: "17:00",
        endTime: "18:00",
        repeat: "none",
      }),
    );
    await invalidate(h.cacheName);
    const third = appEvents((await h.agenda()).body).filter(
      (e) => e.title === "Schwimmen",
    );
    expect(third.map((e) => e.id)).toEqual(first.map((e) => e.id));
    expect(third[1]?.start).toBe("2026-03-16T17:00:00+01:00");
  });
});

describe("cache and invalidation", () => {
  it("serves the cached app sources until a write invalidates them", async () => {
    const swim = await create(SWIM);
    const h = harness();
    const before = await h.agenda();
    expect(appEvents(before.body)).toHaveLength(5);

    // Without a write the fresh cache is served: no entry list is read from D1.
    const prepare = vi.spyOn(db, "prepare");
    expect(appEvents((await h.agenda()).body)).toHaveLength(5);
    expect(
      prepare.mock.calls.some(([sql]) => sql.includes("FROM app_entries")),
    ).toBe(false);
    prepare.mockRestore();

    // A write changes the D1 stamp in its own batch: visible at once, even without
    // dropping this isolate's cache.
    ok(await store().addException(swim.id, 1, "2026-03-16"));
    const after = await h.agenda();
    expect(appEvents(after.body).map((e) => e.start.slice(0, 10))).toEqual([
      "2026-03-09",
      "2026-03-23",
      "2026-03-30",
      "2026-04-06",
    ]);
    expect(after.body.sources.find((s) => s.id === "app-events")?.status).toBe(
      "ok",
    );
  });

  it("reflects a write in every isolate at once (D1 change stamp), not only in the writer's", async () => {
    const swim = await create(SWIM);
    const a = harness();
    const b = harness();
    await a.agenda();
    await b.agenda();
    ok(await store().remove(swim.id, 1));
    // Nothing dropped any cache: a's and b's memory layers still hold the old entry,
    // but the stamp the write replaced in its batch no longer matches.
    expect(appEvents((await a.agenda()).body)).toEqual([]);
    expect(appEvents((await b.agenda()).body)).toEqual([]);
  });

  it("drops the KV entries of both virtual sources", async () => {
    await create(SWIM);
    const kvEnv = env({ KIDBOARD_CACHE: testEnv.KIDBOARD_CACHE });
    await harness().agenda(FULL, kvEnv);
    const listed = async (): Promise<string[]> =>
      (await testEnv.KIDBOARD_CACHE.list({ prefix: "v1/source/app-" })).keys
        .map((k) => k.name.split("/")[2] ?? "")
        .sort();
    expect(await listed()).toEqual(["app-events", "app-meals"]);
    await invalidate("unused", true);
    expect(await listed()).toEqual([]);
  });

  it("rebuilds after the TTL", async () => {
    await create({ ...SWIM, repeat: "none", date: "2026-03-10" });
    const h = harness();
    const fetchedAt = (r: AgendaResponse): string | undefined =>
      r.sources.find((s) => s.id === "app-events")?.fetchedAt;
    const first = fetchedAt((await h.agenda()).body);
    h.clock.now += HOUR / 2;
    expect(fetchedAt((await h.agenda()).body)).toBe(first);
    h.clock.now += 2 * HOUR;
    const later = await h.agenda("?days=8");
    expect(fetchedAt(later.body)).toBe(new Date(h.clock.now).toISOString());
    expect(appEvents(later.body)).toHaveLength(1);
  });
});

describe("D1 unavailable", () => {
  it("serves the last good app data as stale and leaves Google sources alone", async () => {
    await create(SWIM);
    const h = harness();
    const good = await h.agenda();
    const broken = await h.agenda(FULL, env({ KIDBOARD_DATA: brokenDb() }));
    expect(broken.status).toBe(200);
    expect(broken.body.stale).toBe(true);
    expect(broken.body.sources.map((s) => [s.id, s.status])).toEqual([
      ["kinder", "ok"],
      ["essen", "ok"],
      ["app-events", "stale"],
      ["app-meals", "stale"],
    ]);
    expect(appEvents(broken.body)).toEqual(appEvents(good.body));
    expect(broken.body.events.filter((e) => e.sourceId === "kinder")).toEqual(
      good.body.events.filter((e) => e.sourceId === "kinder"),
    );
    expect(consoleOutput.join("\n")).toContain(
      "app entries: D1 read failed (Error), serving last-good data",
    );
    expect(consoleOutput.join("\n")).not.toContain("TESTONLY-not-a-secret");
  });

  it("reports error without last good data, still 200 with the Google sources", async () => {
    const { status, body } = await harness().agenda(
      FULL,
      env({ KIDBOARD_DATA: brokenDb() }),
    );
    expect(status).toBe(200);
    expect(body.sources.map((s) => [s.id, s.status])).toEqual([
      ["kinder", "ok"],
      ["essen", "ok"],
      ["app-events", "error"],
      ["app-meals", "error"],
    ]);
    expect(body.events.length).toBeGreaterThan(0);
  });

  it("finds the last good data in KV from a new isolate", async () => {
    await create(SWIM);
    const kvEnv = env({ KIDBOARD_CACHE: testEnv.KIDBOARD_CACHE });
    await harness().agenda(FULL, kvEnv);
    const { body } = await harness().agenda(
      FULL,
      env({
        KIDBOARD_CACHE: testEnv.KIDBOARD_CACHE,
        KIDBOARD_DATA: brokenDb(),
      }),
    );
    expect(body.sources.find((s) => s.id === "app-events")?.status).toBe(
      "stale",
    );
    expect(appEvents(body)).toHaveLength(5);
  });

  it("does not wait for a hanging D1: last good data as stale after the deadline", async () => {
    await create(SWIM);
    const h = harness(undefined, { d1TimeoutMs: 50 });
    const good = await h.agenda();
    const started = Date.now();
    const slow = await h.agenda(FULL, env({ KIDBOARD_DATA: hangingDb() }));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(slow.status).toBe(200);
    expect(slow.body.sources.map((s) => [s.id, s.status])).toEqual([
      ["kinder", "ok"],
      ["essen", "ok"],
      ["app-events", "stale"],
      ["app-meals", "stale"],
    ]);
    expect(appEvents(slow.body)).toEqual(appEvents(good.body));
    expect(consoleOutput.join("\n")).toContain(
      "app entries: D1 read failed (DeadlineError), serving last-good data",
    );

    // Without last good data: error, the Google sources unaffected.
    const fresh = await harness(undefined, { d1TimeoutMs: 50 }).agenda(
      FULL,
      env({ KIDBOARD_DATA: hangingDb() }),
    );
    expect(fresh.body.sources.map((s) => s.status)).toEqual([
      "ok",
      "ok",
      "error",
      "error",
    ]);
  });

  it("tolerates a failing invalidation and logs only the backend kind", async () => {
    await expect(
      invalidateAppSources({
        configHash: await configHash(),
        store: new SourceStore(),
        backend: cacheBackend(() =>
          Promise.reject(new Error("TESTONLY-not-a-secret cache down")),
        ),
      }),
    ).resolves.toBeUndefined();
    expect(consoleOutput.join("\n")).toContain(
      "app entries: cache cache delete failed",
    );
    expect(consoleOutput.join("\n")).not.toContain("TESTONLY-not-a-secret");
  });
});
