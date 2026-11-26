import {
  type AgendaResponse,
  AgendaResponseSchema,
  type AppConfigInput,
  AppConfigSchema,
  type EditorAppItem,
  type EditorEntryInputRaw,
  EditorErrorResponseSchema,
  EditorImportResponseSchema,
  type EditorListResponse,
  EditorListResponseSchema,
  EditorTemplatesResponseSchema,
  type EditorWriteResponse,
  EditorWriteResponseSchema,
  MAX_APP_ENTRIES,
} from "@kidboard/shared";
import {
  createExecutionContext,
  reset,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env as testEnv } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app";
import { ENTRY_EXPORT_FORMAT, EntryStore } from "../entries/entryStore";
import { STAMP_KEY } from "../entries/stamp";
import type { Env } from "../env";
import { MAX_IMPORT_BODY_BYTES, MAX_ISSUES } from "./editorRoutes";
import { MAX_PARENT_BODY_BYTES } from "./routes";

const PIN = "246813";
const ACCESS = "TESTONLY-access-token-not-a-secret-0123456789";
const PRIVATE_NOTE = "TESTONLY-private-note";
// Synthetic secret URLs (reserved `.invalid` TLD).
const KINDER_URL =
  "https://feeds.kidboard.invalid/calendar/ical/private-TESTONLY-kinder-e1f2/basic.ics";
const ESSEN_URL =
  "https://feeds.kidboard.invalid/calendar/ical/private-TESTONLY-essen-a3b4/basic.ics";
const db = testEnv.KIDBOARD_DATA;

/** Monday 2026-03-09, 10:00 in Berlin. Cached window: 2026-03-08 … 2026-04-10. */
const NOW = Date.parse("2026-03-09T09:00:00Z");

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
const CONFIG = AppConfigSchema.parse(CONFIG_INPUT);

function ics(events: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "PRODID:-//KidBoard//Synthetic Fixture editor-api//EN",
    "VERSION:2.0",
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

/** Google events with private descriptions (must never reach the editor API). */
const KINDER_ICS = ics([
  "BEGIN:VEVENT",
  "UID:editor-kita@fixtures.kidboard.invalid",
  "DTSTAMP:20260101T000000Z",
  "DTSTART;TZID=Europe/Berlin:20260105T080000",
  "DTEND;TZID=Europe/Berlin:20260105T120000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO",
  "SUMMARY:🏫 Kita",
  `DESCRIPTION:${PRIVATE_NOTE} door code\\nMitbringen: 👟`,
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:editor-ballet@fixtures.kidboard.invalid",
  "DTSTAMP:20260101T000000Z",
  "DTSTART;TZID=Europe/Berlin:20260310T150000",
  "DTEND;TZID=Europe/Berlin:20260310T160000",
  "SUMMARY:Mia: 🩰 Ballett",
  `DESCRIPTION:<b>${PRIVATE_NOTE}</b>`,
  "END:VEVENT",
]);
const ESSEN_ICS = ics([
  "BEGIN:VEVENT",
  "UID:editor-lunch@fixtures.kidboard.invalid",
  "DTSTAMP:20260101T000000Z",
  "DTSTART;VALUE=DATE:20260310",
  "DTEND;VALUE=DATE:20260311",
  "SUMMARY:Mittag: 🍝 Spaghetti",
  `DESCRIPTION:${PRIVATE_NOTE} recipe`,
  "END:VEVENT",
]);

const SWIM: EditorEntryInputRaw = {
  kind: "event",
  childIds: ["mia"],
  icon: "🏊",
  title: "Schwimmen",
  allDay: false,
  date: "2026-03-10",
  startTime: "16:00",
  repeat: { weekly: { weekdays: [2] } },
  bring: ["🩱"],
};

const PIZZA: EditorEntryInputRaw = {
  kind: "meal",
  icon: "🍕",
  title: "Pizza",
  allDay: true,
  date: "2026-03-10",
  slot: "dinner",
};

let consoleOutput: string[];
/** Every response body of a test; checked for secrets and descriptions afterwards. */
let responseTexts: string[];
let cacheCounter = 0;

function env(overrides: Partial<Env> = {}): Env {
  return {
    KIDBOARD_CONFIG: JSON.stringify(CONFIG_INPUT),
    CAL_KINDER_URL: KINDER_URL,
    CAL_ESSEN_URL: ESSEN_URL,
    KIDBOARD_DATA: db,
    KIDBOARD_PARENT_PIN: PIN,
    KIDBOARD_ACCESS_TOKEN: ACCESS,
    // Lets requests without an access token reach the (editor-off) behaviour under test.
    KIDBOARD_PUBLIC: "1",
    ...overrides,
  };
}

interface Reply {
  status: number;
  headers: Headers;
  text: string;
  json: unknown;
}

interface Harness {
  clock: { now: number };
  /** Raw call with the access token (and `session` when given). */
  call: (
    path: string,
    init?: RequestInit & { session?: string | null },
  ) => Promise<Reply>;
  token: () => Promise<string>;
  /** Editor call with a fresh session. */
  editor: (path: string, init?: RequestInit) => Promise<Reply>;
  agenda: (query?: string) => Promise<AgendaResponse>;
  /** Replaces the environment overrides of later calls (same isolate). */
  use: (overrides: Partial<Env>) => void;
}

function harness(): Harness {
  const clock = { now: NOW };
  let overrides: Partial<Env> = {};
  const cacheName = `kidboard-editor-${String(cacheCounter++)}`;
  const app = createApp({
    now: () => clock.now,
    openCache: () => caches.open(cacheName),
  });
  let session: string | undefined;
  const call: Harness["call"] = async (path, init = {}) => {
    const { session: parent, ...rest } = init;
    const headers = new Headers(rest.headers);
    headers.set("Authorization", `Bearer ${ACCESS}`);
    if (parent !== undefined && parent !== null) {
      headers.set("X-KidBoard-Parent", parent);
    }
    const ctx = createExecutionContext();
    const response = await app.fetch(
      new Request(`https://board.example.test${path}`, { ...rest, headers }),
      env(overrides),
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const text = await response.text();
    responseTexts.push(text);
    let json: unknown = null;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
    return { status: response.status, headers: response.headers, text, json };
  };
  const token = async (): Promise<string> => {
    if (session === undefined) {
      const reply = await call("/api/parent/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: PIN }),
      });
      expect(reply.status).toBe(200);
      session = (reply.json as { token: string }).token;
    }
    return session;
  };
  return {
    clock,
    call,
    token,
    use: (next) => {
      overrides = next;
    },
    editor: async (path, init = {}) =>
      call(path, { ...init, session: await token() }),
    agenda: async (query = "?from=2026-03-09&days=14") => {
      const reply = await call(`/api/agenda${query}`);
      expect(reply.status).toBe(200);
      return AgendaResponseSchema.parse(reply.json);
    },
  };
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function createEntry(
  h: Harness,
  input: EditorEntryInputRaw,
): Promise<EditorWriteResponse> {
  const reply = await h.editor("/api/parent/entries", jsonInit("POST", input));
  expect(reply.status, reply.text).toBe(201);
  return EditorWriteResponseSchema.parse(reply.json);
}

async function list(
  h: Harness,
  query = "?from=2026-03-09&days=14",
): Promise<EditorListResponse> {
  const reply = await h.editor(`/api/parent/entries${query}`);
  expect(reply.status, reply.text).toBe(200);
  return EditorListResponseSchema.parse(reply.json);
}

function appItemsOf(body: EditorListResponse): EditorAppItem[] {
  return body.items.filter(
    (item): item is EditorAppItem => item.origin === "app",
  );
}

function errorOf(
  reply: Reply,
): ReturnType<typeof EditorErrorResponseSchema.parse> {
  return EditorErrorResponseSchema.parse(reply.json);
}

beforeEach(() => {
  consoleOutput = [];
  responseTexts = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(" "));
    });
  }
  const feeds = new Map([
    [KINDER_URL, KINDER_ICS],
    [ESSEN_URL, ESSEN_ICS],
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
  // No response and no log line may carry the PIN, a feed URL, the access token or
  // any Google description text.
  const output = [...responseTexts, ...consoleOutput].join("\n");
  for (const secret of [
    PIN,
    "private-TESTONLY",
    ACCESS,
    PRIVATE_NOTE,
    "door code",
  ]) {
    expect(output).not.toContain(secret);
  }
  vi.restoreAllMocks();
  await reset();
});

describe("auth", () => {
  const routes: [string, RequestInit][] = [
    ["/api/parent/entries", {}],
    ["/api/parent/entries", jsonInit("POST", SWIM)],
    [
      "/api/parent/entries/00000000-0000-4000-8000-000000000000",
      jsonInit("PATCH", { revision: 1, entry: SWIM }),
    ],
    [
      "/api/parent/entries/00000000-0000-4000-8000-000000000000?revision=1",
      { method: "DELETE" },
    ],
    ["/api/parent/templates", {}],
    ["/api/parent/export", {}],
    ["/api/parent/import?mode=merge", jsonInit("POST", {})],
  ];

  it.each(routes)(
    "%s without a session → 403 parent_locked",
    async (path, init) => {
      const h = harness();
      const missing = await h.call(path, init);
      expect(missing.status).toBe(403);
      expect(errorOf(missing).error).toBe("parent_locked");
      const token = await h.token();
      const tampered = await h.call(path, {
        ...init,
        session: `${token.slice(0, -1)}${token.endsWith("A") ? "Q" : "A"}`,
      });
      expect(tampered.status).toBe(403);
      expect(errorOf(tampered).error).toBe("parent_locked");
    },
  );

  it("an expired session is locked, the access token still comes first", async () => {
    const h = harness();
    const token = await h.token();
    h.clock.now += 15 * 60_000;
    const expired = await h.call("/api/parent/entries", { session: token });
    expect(expired.status).toBe(403);

    const app = createApp({ now: () => NOW });
    const noAccess = await app.fetch(
      new Request("https://board.example.test/api/parent/entries", {
        headers: { "X-KidBoard-Parent": token },
      }),
      env(),
    );
    expect(noAccess.status).toBe(401);
  });

  it("writes nothing without a session", async () => {
    const h = harness();
    await h.call("/api/parent/entries", jsonInit("POST", SWIM));
    expect(await new EntryStore(db, { config: CONFIG }).list()).toEqual([]);
  });
});

describe("POST /api/parent/entries", () => {
  it("creates an entry, answers boardRefresh now and the next agenda shows it", async () => {
    const h = harness();
    const before = await h.agenda(); // warms the app source cache
    expect(before.events.some((e) => e.title === "Schwimmen")).toBe(false);

    const { entry, boardRefresh } = await createEntry(h, SWIM);
    expect(boardRefresh).toBe("now");
    expect(entry).toMatchObject({
      revision: 1,
      kind: "event",
      data: { ...SWIM, countdown: false },
      exdates: [],
      overrides: {},
      createdAt: "2026-03-09T09:00:00.000Z",
    });

    const after = await h.agenda();
    expect(
      after.events
        .filter((e) => e.title === "Schwimmen")
        .map((e) => [e.sourceId, e.start, e.childIds, e.bring]),
    ).toEqual([
      ["app-events", "2026-03-10T16:00:00+01:00", ["mia"], ["🩱"]],
      ["app-events", "2026-03-17T16:00:00+01:00", ["mia"], ["🩱"]],
    ]);
  });

  it("answers 422 invalid_entry with field codes for the UI", async () => {
    const h = harness();
    const reply = await h.editor(
      "/api/parent/entries",
      jsonInit("POST", { ...SWIM, childIds: ["zoe"], countdown: false }),
    );
    expect(reply.status).toBe(422);
    const body = errorOf(reply);
    expect(body.error).toBe("invalid_entry");
    expect(body.issues).toEqual([
      expect.objectContaining({ code: "unknown_child", path: "childIds.0" }),
    ]);

    const shape = await h.editor(
      "/api/parent/entries",
      jsonInit("POST", { ...SWIM, title: "x".repeat(61), icon: "A" }),
    );
    expect(shape.status).toBe(422);
    expect(
      errorOf(shape)
        .issues?.map((i) => [i.code, i.path])
        .sort(),
    ).toEqual([
      ["invalid", "icon"],
      ["invalid", "title"],
    ]);

    const countdown = await h.editor(
      "/api/parent/entries",
      jsonInit("POST", { ...SWIM, icon: "🎂", countdown: false }),
    );
    expect(errorOf(countdown).issues?.map((i) => i.code)).toEqual([
      "countdown_icon",
    ]);
    expect(await new EntryStore(db, { config: CONFIG }).list()).toEqual([]);
  });

  it("rejects malformed JSON with 400 and bodies over 16 KB with 413", async () => {
    const h = harness();
    const malformed = await h.editor("/api/parent/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect(errorOf(malformed).error).toBe("bad_request");

    const large = await h.editor(
      "/api/parent/entries",
      jsonInit("POST", {
        ...SWIM,
        title: "x".repeat(MAX_PARENT_BODY_BYTES),
      }),
    );
    expect(large.status).toBe(413);
    expect(errorOf(large).error).toBe("payload_too_large");
  });

  it("answers 422 limit_reached at 1 000 entries", async () => {
    const at = "2026-03-01T00:00:00.000Z";
    const entries = Array.from({ length: MAX_APP_ENTRIES }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      revision: 1,
      kind: "event",
      data: { ...SWIM, repeat: "none", date: "2026-03-10" },
      createdAt: at,
      updatedAt: at,
    }));
    const imported = await new EntryStore(db, { config: CONFIG }).importAll(
      { format: ENTRY_EXPORT_FORMAT, version: 1, exportedAt: at, entries },
      "replace",
    );
    expect(imported.ok).toBe(true);
    const reply = await harness().editor(
      "/api/parent/entries",
      jsonInit("POST", SWIM),
    );
    expect(reply.status).toBe(422);
    expect(errorOf(reply)).toMatchObject({
      error: "limit_reached",
      limit: "entries",
    });
  });
});

describe("GET /api/parent/entries", () => {
  it("lists app occurrences (editable) and Google occurrences (read-only) sorted by start", async () => {
    const h = harness();
    const swim = (await createEntry(h, SWIM)).entry;
    const pizza = (await createEntry(h, PIZZA)).entry;
    const body = await list(h, "?from=2026-03-09&days=2");
    expect(body.range).toEqual({ from: "2026-03-09", to: "2026-03-11" });
    expect(body.timeZone).toBe("Europe/Berlin");
    expect(body.sources).toEqual([
      { id: "kinder", status: "ok" },
      { id: "essen", status: "ok" },
    ]);
    expect(
      body.items.map((i) => [i.origin, i.date, i.kind, i.title, i.start]),
    ).toEqual([
      ["google", "2026-03-09", "event", "Kita", "2026-03-09T08:00:00+01:00"],
      // All-day before timed; meals by slot.
      ["google", "2026-03-10", "meal", "Spaghetti", "2026-03-10"],
      ["app", "2026-03-10", "meal", "Pizza", "2026-03-10"],
      ["google", "2026-03-10", "event", "Ballett", "2026-03-10T15:00:00+01:00"],
      ["app", "2026-03-10", "event", "Schwimmen", "2026-03-10T16:00:00+01:00"],
    ]);

    const [, lunch, ballet] = body.items.filter((i) => i.origin === "google");
    expect(lunch).toEqual({
      origin: "google",
      id: lunch?.id,
      sourceId: "essen",
      iconIsFallback: false,
      kind: "meal",
      icon: "🍝",
      title: "Spaghetti",
      childIds: [],
      allDay: true,
      start: "2026-03-10",
      end: "2026-03-11",
      date: "2026-03-10",
      slot: "lunch",
      bring: [],
      countdown: false,
    });
    expect(ballet).toMatchObject({ childIds: ["mia"], bring: [] });
    // The only part of a Google description that leaves the worker: bring icons.
    expect(body.items[0]).toMatchObject({ title: "Kita", bring: ["👟"] });

    const apps = appItemsOf(body);
    expect(apps.find((i) => i.kind === "meal")).toMatchObject({
      id: pizza?.id,
      entryId: pizza?.id,
      revision: 1,
      occurrenceDate: null,
      override: null,
      slot: "dinner",
      end: "2026-03-11",
    });
    expect(apps.find((i) => i.kind === "event")).toMatchObject({
      id: `${String(swim?.id)}/2026-03-10`,
      entryId: swim?.id,
      revision: 1,
      entry: { repeat: { weekly: { weekdays: [2], interval: 1 } } },
      occurrenceDate: "2026-03-10",
      override: null,
      childIds: ["mia"],
      bring: ["🩱"],
      end: "2026-03-10T17:00:00+01:00",
    });
  });

  it("uses the agenda window rules", async () => {
    const h = harness();
    expect((await list(h)).range).toEqual({
      from: "2026-03-09",
      to: "2026-03-23",
    });
    expect((await list(h, "")).range).toEqual({
      from: "2026-03-09",
      to: "2026-03-17",
    });
    expect((await list(h, "?from=2026-03-09&days=31")).range.to).toBe(
      "2026-04-09",
    );
    for (const query of [
      "?days=32",
      "?days=0",
      "?from=2026-02-30",
      "?from=2026-03-07",
      "?from=2026-03-11&days=31",
    ]) {
      const reply = await h.editor(`/api/parent/entries${query}`);
      expect(reply.status, query).toBe(400);
      expect(errorOf(reply).error).toBe("bad_request");
    }
  });

  it("serves the Google occurrences with storageUnavailable when D1 cannot list entries", async () => {
    const h = harness();
    await h.token();
    const real = testEnv.KIDBOARD_DATA;
    // Test double around the real binding: entry reads fail, the session still works.
    const failingEntries = {
      prepare: (sql: string) => {
        if (sql.includes("FROM app_entries")) {
          throw new Error("D1_ERROR: unavailable");
        }
        return real.prepare(sql);
      },
      batch: (statements: D1PreparedStatement[]) => real.batch(statements),
      exec: (sql: string) => real.exec(sql),
    } as unknown as D1Database;
    h.use({ KIDBOARD_DATA: failingEntries });
    const body = await list(h);
    expect(body.storageUnavailable).toBe(true);
    expect(body.unresolved).toEqual([]);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((i) => i.origin === "google")).toBe(true);
    expect(consoleOutput.join("\n")).toContain(
      "editor: D1 unavailable (Error)",
    );
  });

  it("still lists app entries when a Google calendar fails", async () => {
    const h = harness();
    await createEntry(h, SWIM);
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response("down", { status: 503 }),
    );
    const body = await list(h);
    expect(body.sources.map((s) => s.status)).toEqual(["error", "error"]);
    expect(body.items.map((i) => i.origin)).toEqual(["app", "app"]);
  });
});

describe("entries the config can no longer express", () => {
  const WITHOUT_BEN = JSON.stringify({
    ...CONFIG_INPUT,
    children: CONFIG.children.filter((child) => child.id !== "ben"),
  });
  const BOTH: EditorEntryInputRaw = { ...SWIM, childIds: ["mia", "ben"] };

  it("lists them as unresolved; PATCH and DELETE with their revision work", async () => {
    const h = harness();
    const fix = (await createEntry(h, BOTH)).entry;
    const drop = (await createEntry(h, { ...BOTH, title: "Turnen" })).entry;
    h.use({ KIDBOARD_CONFIG: WITHOUT_BEN });

    const body = await list(h);
    expect(appItemsOf(body)).toEqual([]);
    expect(body.storageUnavailable).toBe(false);
    expect(
      body.unresolved.map((u) => [
        u.entryId,
        u.revision,
        u.entry.title,
        u.issues,
      ]),
    ).toEqual(
      [
        [fix?.id, 1, "Schwimmen"],
        [drop?.id, 1, "Turnen"],
      ]
        .map((row) => [
          ...row,
          [
            expect.objectContaining({
              code: "unknown_child",
              path: "childIds.1",
            }),
          ],
        ])
        .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1)),
    );
    expect(
      (await h.agenda()).events.filter((e) => e.sourceId === "app-events"),
    ).toEqual([]);

    const patched = await h.editor(
      `/api/parent/entries/${String(fix?.id)}`,
      jsonInit("PATCH", { revision: 1, entry: SWIM }),
    );
    expect(patched.status, patched.text).toBe(200);
    const deleted = await h.editor(
      `/api/parent/entries/${String(drop?.id)}?revision=1`,
      { method: "DELETE" },
    );
    expect(deleted.status, deleted.text).toBe(200);

    const after = await list(h);
    expect(after.unresolved).toEqual([]);
    expect(appItemsOf(after).map((i) => [i.entryId, i.revision])).toEqual([
      [fix?.id, 2],
      [fix?.id, 2],
    ]);
  });

  it("an import restores them (shape-checked) and the list shows them as unresolved", async () => {
    const h = harness();
    await createEntry(h, BOTH);
    await createEntry(h, PIZZA);
    const doc = (await h.editor("/api/parent/export")).json;
    h.use({ KIDBOARD_CONFIG: WITHOUT_BEN });
    const imported = await h.editor(
      "/api/parent/import?mode=replace",
      jsonInit("POST", doc),
    );
    expect(imported.status, imported.text).toBe(200);
    expect(EditorImportResponseSchema.parse(imported.json).imported).toBe(2);
    const body = await list(h);
    expect(body.unresolved.map((u) => u.entry.title)).toEqual(["Schwimmen"]);
    expect(appItemsOf(body).map((i) => i.title)).toEqual(["Pizza"]);
  });
});

describe("PATCH and DELETE /api/parent/entries/:id", () => {
  async function weekly(h: Harness): Promise<{ id: string; revision: number }> {
    const { entry } = await createEntry(h, {
      ...SWIM,
      repeat: { weekly: { weekdays: [2, 4] } },
    });
    return { id: String(entry?.id), revision: entry?.revision ?? 0 };
  }

  it("scope=one removes or replaces a single day of a series", async () => {
    const h = harness();
    const { id } = await weekly(h);
    const removed = await h.editor(
      `/api/parent/entries/${id}?scope=one&date=2026-03-12&revision=1`,
      { method: "DELETE" },
    );
    expect(removed.status, removed.text).toBe(200);
    const afterDelete = EditorWriteResponseSchema.parse(removed.json);
    expect(afterDelete.entry).toMatchObject({
      revision: 2,
      exdates: ["2026-03-12"],
    });
    expect(afterDelete.boardRefresh).toBe("now");

    const moved = await h.editor(
      `/api/parent/entries/${id}?scope=one&date=2026-03-17`,
      jsonInit("PATCH", {
        revision: 2,
        entry: {
          ...SWIM,
          repeat: "none",
          date: "2026-03-18",
          startTime: "10:00",
          title: "Probetraining",
        },
      }),
    );
    expect(moved.status, moved.text).toBe(200);
    expect(EditorWriteResponseSchema.parse(moved.json).entry).toMatchObject({
      revision: 3,
      overrides: {
        "2026-03-17": { date: "2026-03-18", title: "Probetraining" },
      },
    });

    const days = appItemsOf(await list(h)).map((i) => [
      i.date,
      i.occurrenceDate,
      i.title,
      i.override === null,
    ]);
    expect(days).toEqual([
      ["2026-03-10", "2026-03-10", "Schwimmen", true],
      ["2026-03-18", "2026-03-17", "Probetraining", false],
      ["2026-03-19", "2026-03-19", "Schwimmen", true],
    ]);
    const board = await h.agenda();
    expect(
      board.events
        .filter((e) => e.sourceId === "app-events")
        .map((e) => e.start.slice(0, 10)),
    ).toEqual(["2026-03-10", "2026-03-18", "2026-03-19"]);
  });

  it("scope=series keeps exceptions whose dates still exist", async () => {
    const h = harness();
    const { id } = await weekly(h);
    await h.editor(
      `/api/parent/entries/${id}?scope=one&date=2026-03-12&revision=1`,
      { method: "DELETE" },
    );
    await h.editor(
      `/api/parent/entries/${id}?scope=one&date=2026-03-17&revision=2`,
      { method: "DELETE" },
    );
    // Thursdays only: the Tuesday exception goes, the Thursday one stays.
    const reply = await h.editor(
      `/api/parent/entries/${id}?scope=series`,
      jsonInit("PATCH", {
        revision: 3,
        entry: {
          ...SWIM,
          date: "2026-03-12",
          title: "Schwimmkurs",
          repeat: { weekly: { weekdays: [4] } },
        },
      }),
    );
    expect(reply.status, reply.text).toBe(200);
    expect(EditorWriteResponseSchema.parse(reply.json).entry).toMatchObject({
      revision: 4,
      exdates: ["2026-03-12"],
      data: { title: "Schwimmkurs" },
    });
    // Without a scope the whole series is changed.
    const plain = await h.editor(
      `/api/parent/entries/${id}`,
      jsonInit("PATCH", { revision: 4, entry: { ...SWIM, title: "Kurs" } }),
    );
    expect(EditorWriteResponseSchema.parse(plain.json).entry).toMatchObject({
      revision: 5,
      exdates: [],
      data: { title: "Kurs" },
    });
  });

  it("answers 409 conflict with the current revision", async () => {
    const h = harness();
    const { id } = await weekly(h);
    await h.editor(
      `/api/parent/entries/${id}`,
      jsonInit("PATCH", { revision: 1, entry: { ...SWIM, title: "Neu" } }),
    );
    const stalePatch = await h.editor(
      `/api/parent/entries/${id}`,
      jsonInit("PATCH", { revision: 1, entry: { ...SWIM, title: "Alt" } }),
    );
    expect(stalePatch.status).toBe(409);
    expect(errorOf(stalePatch)).toMatchObject({
      error: "conflict",
      revision: 2,
    });
    const staleDelete = await h.editor(`/api/parent/entries/${id}?revision=1`, {
      method: "DELETE",
    });
    expect(staleDelete.status).toBe(409);
    const staleOne = await h.editor(
      `/api/parent/entries/${id}?scope=one&date=2026-03-12&revision=1`,
      { method: "DELETE" },
    );
    expect(errorOf(staleOne)).toMatchObject({ error: "conflict", revision: 2 });
    const stored = await new EntryStore(db, { config: CONFIG }).get(id);
    expect(stored.ok && stored.value.data.title).toBe("Neu");
  });

  it("deletes a whole entry and invalidates the board", async () => {
    const h = harness();
    const { id } = await weekly(h);
    expect(
      (await h.agenda()).events.some((e) => e.sourceId === "app-events"),
    ).toBe(true);
    const reply = await h.editor(`/api/parent/entries/${id}?revision=1`, {
      method: "DELETE",
    });
    expect(reply.status).toBe(200);
    expect(EditorWriteResponseSchema.parse(reply.json)).toEqual({
      entry: null,
      boardRefresh: "now",
    });
    expect(
      (await h.agenda()).events.some((e) => e.sourceId === "app-events"),
    ).toBe(false);
    const again = await h.editor(`/api/parent/entries/${id}?revision=1`, {
      method: "DELETE",
    });
    expect(again.status).toBe(404);
    expect(errorOf(again).error).toBe("not_found");
  });

  it("validates ids, scopes, dates and revisions", async () => {
    const h = harness();
    const { id } = await weekly(h);
    const cases: [string, RequestInit, number, string][] = [
      [
        `/api/parent/entries/${id}?scope=one`,
        jsonInit("PATCH", { revision: 1, entry: SWIM }),
        400,
        "bad_request",
      ],
      [
        `/api/parent/entries/${id}?scope=all`,
        jsonInit("PATCH", { revision: 1, entry: SWIM }),
        400,
        "bad_request",
      ],
      [
        `/api/parent/entries/${id}`,
        jsonInit("PATCH", { entry: SWIM }),
        400,
        "bad_request",
      ],
      [
        `/api/parent/entries/${id}`,
        jsonInit("PATCH", { revision: 1, entry: SWIM, x: 1 }),
        400,
        "bad_request",
      ],
      [`/api/parent/entries/${id}`, { method: "DELETE" }, 400, "bad_request"],
      [
        `/api/parent/entries/${id}?revision=0`,
        { method: "DELETE" },
        400,
        "bad_request",
      ],
      [
        `/api/parent/entries/${id}?scope=one&date=2026-03-11&revision=1`,
        { method: "DELETE" },
        422,
        "invalid_entry",
      ],
      [
        `/api/parent/entries/not-an-id?revision=1`,
        { method: "DELETE" },
        404,
        "not_found",
      ],
      [
        `/api/parent/entries/not-an-id`,
        jsonInit("PATCH", { revision: 1, entry: SWIM }),
        404,
        "not_found",
      ],
      [
        `/api/parent/entries/${id}`,
        jsonInit("PATCH", {
          revision: 1,
          entry: { ...SWIM, childIds: ["zoe"] },
        }),
        422,
        "invalid_entry",
      ],
    ];
    for (const [path, init, status, error] of cases) {
      const reply = await h.editor(path, init);
      expect(reply.status, `${String(init.method)} ${path}`).toBe(status);
      expect(errorOf(reply).error).toBe(error);
    }
    const single = (await createEntry(h, { ...SWIM, repeat: "none" })).entry;
    const one = await h.editor(
      `/api/parent/entries/${String(single?.id)}?scope=one&date=2026-03-10&revision=1`,
      { method: "DELETE" },
    );
    expect(one.status).toBe(422);
    expect(errorOf(one).issues?.[0]).toMatchObject({ path: "date" });
  });
});

describe("GET /api/parent/templates", () => {
  it("suggests app entries of the last 8 and next 4 weeks and Google entries of the cached window, most frequent first", async () => {
    const h = harness();
    await createEntry(h, SWIM); // Tuesdays from 2026-03-10: 4 in the window
    await createEntry(h, PIZZA);
    await createEntry(h, {
      kind: "event",
      childIds: ["ben"],
      icon: "🎨",
      title: "Malen",
      allDay: false,
      date: "2026-01-13",
      startTime: "14:00",
      endTime: "15:30",
      repeat: { weekly: { weekdays: [2] } },
    }); // 12 Tuesdays from 2026-01-13 to 2026-03-31
    // Outside the window (before 2026-01-12 and from 2026-04-06): not counted.
    await createEntry(h, {
      ...SWIM,
      repeat: "none",
      date: "2026-01-05",
      title: "Alt",
    });
    await createEntry(h, {
      ...SWIM,
      repeat: "none",
      date: "2026-04-07",
      title: "Später",
    });

    const reply = await h.editor("/api/parent/templates");
    expect(reply.status).toBe(200);
    const { templates } = EditorTemplatesResponseSchema.parse(reply.json);
    expect(templates.map((t) => [t.title, t.count, t.origins])).toEqual([
      ["Malen", 12, ["app"]],
      // Google: cached window only (today - 1 to today + 28). Kita runs every Monday
      // since 2026-01-05, but only 03-09, 03-16, 03-23 and 03-30 count (not the
      // earlier Mondays, not 04-06). Equal counts: the one nearest to now first.
      ["Kita", 4, ["google"]],
      ["Schwimmen", 4, ["app"]],
      ["Pizza", 1, ["app"]],
      ["Spaghetti", 1, ["google"]],
      ["Ballett", 1, ["google"]],
    ]);
    expect(templates[0]).toEqual({
      kind: "event",
      icon: "🎨",
      title: "Malen",
      childIds: ["ben"],
      allDay: false,
      startTime: "14:00",
      endTime: "15:30",
      bring: [],
      countdown: false,
      count: 12,
      origins: ["app"],
    });
    expect(templates[1]).toMatchObject({
      childIds: [],
      startTime: "08:00",
      endTime: "12:00",
      bring: ["👟"],
    });
    expect(templates[3]).toEqual({
      kind: "meal",
      icon: "🍕",
      title: "Pizza",
      childIds: [],
      allDay: true,
      slot: "dinner",
      bring: [],
      countdown: false,
      count: 1,
      origins: ["app"],
    });
  });

  it("returns at most 12 and groups app and Google entries with the same icon, title and children", async () => {
    const h = harness();
    await createEntry(h, {
      kind: "event",
      icon: "🏫",
      title: "Kita",
      allDay: false,
      date: "2026-03-11",
      startTime: "08:00",
    });
    for (let i = 0; i < 13; i++) {
      await createEntry(h, {
        ...SWIM,
        repeat: "none",
        date: "2026-03-20",
        title: `Termin ${String(i).padStart(2, "0")}`,
      });
    }
    const { templates } = EditorTemplatesResponseSchema.parse(
      (await h.editor("/api/parent/templates")).json,
    );
    expect(templates).toHaveLength(12);
    expect(templates[0]).toMatchObject({
      title: "Kita",
      count: 5,
      origins: ["app", "google"],
    });
  });
});

describe("no configured calendars (app entries only, ADR-0014)", () => {
  const appOnly = (h: Harness): void => {
    h.use({
      KIDBOARD_CONFIG: JSON.stringify({ ...CONFIG_INPUT, calendars: [] }),
      CAL_KINDER_URL: undefined,
      CAL_ESSEN_URL: undefined,
    });
  };

  it("creates, lists and shows events and meals without any Google source", async () => {
    const h = harness();
    appOnly(h);
    await createEntry(h, SWIM);
    await createEntry(h, PIZZA);

    const body = await list(h);
    expect(body.sources).toEqual([]);
    expect(body.storageUnavailable).toBe(false);
    expect(body.items.every((item) => item.origin === "app")).toBe(true);
    expect(
      appItemsOf(body).map((item) => [item.date, item.kind, item.title]),
    ).toEqual([
      ["2026-03-10", "meal", "Pizza"],
      ["2026-03-10", "event", "Schwimmen"],
      ["2026-03-17", "event", "Schwimmen"],
    ]);

    const agenda = await h.agenda();
    expect(agenda.sources.map((s) => [s.id, s.status])).toEqual([
      ["app-events", "ok"],
      ["app-meals", "ok"],
    ]);
    expect(agenda.events.map((e) => [e.start, e.title])).toEqual([
      ["2026-03-10T16:00:00+01:00", "Schwimmen"],
      ["2026-03-17T16:00:00+01:00", "Schwimmen"],
    ]);
    // No meal calendar: the meal band holds the app meals only.
    expect(agenda.meals.map((m) => [m.sourceId, m.date, m.slot])).toEqual([
      ["app-meals", "2026-03-10", "dinner"],
    ]);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(consoleOutput.join("\n")).not.toContain(
      "KIDBOARD_CONFIG lists no calendars",
    );
  });

  it("suggests templates from app entries only (no Google part)", async () => {
    const h = harness();
    appOnly(h);
    const empty = await h.editor("/api/parent/templates");
    expect(empty.status).toBe(200);
    expect(EditorTemplatesResponseSchema.parse(empty.json).templates).toEqual(
      [],
    );
    await createEntry(h, SWIM);
    const reply = await h.editor("/api/parent/templates");
    const { templates } = EditorTemplatesResponseSchema.parse(reply.json);
    expect(templates.map((t) => [t.title, t.origins])).toEqual([
      ["Schwimmen", ["app"]],
    ]);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

describe("export and import", () => {
  it("exports a JSON download and restores it with replace", async () => {
    const h = harness();
    const { entry } = await createEntry(h, SWIM);
    await h.editor(
      `/api/parent/entries/${String(entry?.id)}?scope=one&date=2026-03-17&revision=1`,
      { method: "DELETE" },
    );
    const exported = await h.editor("/api/parent/export");
    expect(exported.status).toBe(200);
    expect(exported.headers.get("Content-Disposition")).toBe(
      'attachment; filename="kidboard-entries-2026-03-09.json"',
    );
    expect(exported.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect(exported.headers.get("Cache-Control")).toBe("no-store");
    const doc = exported.json as { format: string; entries: unknown[] };
    expect(doc.format).toBe(ENTRY_EXPORT_FORMAT);
    expect(doc.entries).toHaveLength(1);

    await createEntry(h, PIZZA);
    const before = await h.agenda();
    expect(before.meals.some((m) => m.title === "Pizza")).toBe(true);
    const restored = await h.editor(
      "/api/parent/import?mode=replace",
      jsonInit("POST", doc),
    );
    expect(restored.status, restored.text).toBe(200);
    expect(EditorImportResponseSchema.parse(restored.json)).toEqual({
      mode: "replace",
      imported: 1,
      created: 0,
      updated: 1,
      boardRefresh: "now",
    });
    const items = appItemsOf(await list(h));
    expect(items.map((i) => [i.title, i.date])).toEqual([
      ["Schwimmen", "2026-03-10"],
    ]);
    // The board was invalidated too.
    expect((await h.agenda()).meals.some((m) => m.title === "Pizza")).toBe(
      false,
    );
  });

  it("merges by id and keeps other entries", async () => {
    const h = harness();
    await createEntry(h, SWIM);
    const doc = (await h.editor("/api/parent/export")).json;
    await reset();
    const fresh = harness();
    await createEntry(fresh, PIZZA);
    const merged = await fresh.editor(
      "/api/parent/import?mode=merge",
      jsonInit("POST", doc),
    );
    expect(EditorImportResponseSchema.parse(merged.json)).toMatchObject({
      imported: 1,
      created: 1,
      updated: 0,
    });
    expect(
      appItemsOf(await list(fresh, "?from=2026-03-10&days=1"))
        .map((i) => i.title)
        .sort(),
    ).toEqual(["Pizza", "Schwimmen"]);
  });

  it("validates mode and document, with field paths, and writes nothing on errors", async () => {
    const h = harness();
    await createEntry(h, PIZZA);
    const doc = (await h.editor("/api/parent/export")).json as {
      entries: Record<string, unknown>[];
    };
    const missingMode = await h.editor(
      "/api/parent/import",
      jsonInit("POST", doc),
    );
    expect(missingMode.status).toBe(400);
    const badMode = await h.editor(
      "/api/parent/import?mode=all",
      jsonInit("POST", doc),
    );
    expect(badMode.status).toBe(400);
    const wrongFormat = await h.editor(
      "/api/parent/import?mode=replace",
      jsonInit("POST", { ...doc, format: "other" }),
    );
    expect(wrongFormat.status).toBe(422);
    expect(errorOf(wrongFormat).issues?.[0]?.path).toBe("format");

    const broken = {
      ...doc,
      entries: [
        {
          ...doc.entries[0],
          data: { ...PIZZA, childIds: ["zoe"], slot: undefined },
        },
      ],
    };
    const invalid = await h.editor(
      "/api/parent/import?mode=replace",
      jsonInit("POST", broken),
    );
    expect(invalid.status).toBe(422);
    expect(
      errorOf(invalid)
        .issues?.map((i) => i.path)
        .sort(),
    ).toEqual(["entries.0.data.childIds", "entries.0.data.slot"]);
    expect(appItemsOf(await list(h)).map((i) => i.title)).toEqual(["Pizza"]);
  });

  it("caps the issue list", async () => {
    const h = harness();
    const at = "2026-03-01T00:00:00.000Z";
    const entries = Array.from({ length: 80 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      revision: 1,
      kind: "event",
      data: { ...SWIM, icon: "A" },
      createdAt: at,
      updatedAt: at,
    }));
    const reply = await h.editor(
      "/api/parent/import?mode=merge",
      jsonInit("POST", {
        format: ENTRY_EXPORT_FORMAT,
        version: 1,
        exportedAt: at,
        entries,
      }),
    );
    expect(reply.status).toBe(422);
    expect(errorOf(reply).issues).toHaveLength(MAX_ISSUES);
  });

  it("accepts imports above 16 KB, rejects entries over 8 KB and bodies over the import limit", async () => {
    const h = harness();
    const at = "2026-03-01T00:00:00.000Z";
    const entry = (i: number): Record<string, unknown> => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      revision: 1,
      kind: "event",
      data: { ...SWIM, title: `Termin ${String(i)}` },
      createdAt: at,
      updatedAt: at,
    });
    const docOf = (entries: unknown[]): unknown => ({
      format: ENTRY_EXPORT_FORMAT,
      version: 1,
      exportedAt: at,
      entries,
    });
    const many = Array.from({ length: 120 }, (_, i) => entry(i));
    const body = JSON.stringify(docOf(many));
    expect(body.length).toBeGreaterThan(MAX_PARENT_BODY_BYTES);
    const ok = await h.editor("/api/parent/import?mode=replace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(ok.status, ok.text.slice(0, 200)).toBe(200);
    expect(EditorImportResponseSchema.parse(ok.json).imported).toBe(120);

    // 60 overrides of about 150 bytes each: over 8 KB for one entry.
    const overrides = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => {
        const date = new Date(Date.UTC(2026, 2, 10 + i * 7))
          .toISOString()
          .slice(0, 10);
        return [date, { ...SWIM, repeat: "none", date, title: "x".repeat(50) }];
      }),
    );
    const tooBig = await h.editor(
      "/api/parent/import?mode=merge",
      jsonInit("POST", docOf([{ ...entry(500), overrides }])),
    );
    expect(tooBig.status).toBe(422);
    expect(errorOf(tooBig)).toMatchObject({
      error: "limit_reached",
      limit: "size",
    });

    const huge = await h.editor("/api/parent/import?mode=merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: " ".repeat(MAX_IMPORT_BODY_BYTES + 1),
    });
    expect(huge.status).toBe(413);
    expect(errorOf(huge).error).toBe("payload_too_large");
  });

  it("checks the session before reading a large import body", async () => {
    const h = harness();
    const reply = await h.call("/api/parent/import?mode=merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: " ".repeat(MAX_IMPORT_BODY_BYTES + 1),
    });
    expect(reply.status).toBe(403);
    expect(errorOf(reply).error).toBe("parent_locked");
  });
});

describe("change stamp of every write route", () => {
  async function stamp(): Promise<string | null> {
    return db
      .prepare("SELECT value FROM kb_meta WHERE key = ?")
      .bind(STAMP_KEY)
      .first<string>("value");
  }

  it("is replaced by create, patch (series and one day), delete (one day and series) and both imports", async () => {
    const h = harness();
    const seen = new Set<string | null>();
    const expectNewStamp = async (step: string): Promise<void> => {
      const current = await stamp();
      expect(current, step).not.toBeNull();
      expect(seen.has(current), step).toBe(false);
      seen.add(current);
    };
    const expectOk = (reply: Reply): void => {
      expect(reply.status, reply.text).toBe(200);
    };

    const { entry } = await createEntry(h, SWIM);
    const id = String(entry?.id);
    await expectNewStamp("create");
    expectOk(
      await h.editor(
        `/api/parent/entries/${id}`,
        jsonInit("PATCH", {
          revision: 1,
          entry: { ...SWIM, startTime: "15:00" },
        }),
      ),
    );
    await expectNewStamp("patch series");
    expectOk(
      await h.editor(
        `/api/parent/entries/${id}?scope=one&date=2026-03-17`,
        jsonInit("PATCH", {
          revision: 2,
          entry: { ...SWIM, date: "2026-03-18", repeat: "none" },
        }),
      ),
    );
    await expectNewStamp("patch one day");
    expectOk(
      await h.editor(
        `/api/parent/entries/${id}?scope=one&date=2026-03-24&revision=3`,
        { method: "DELETE" },
      ),
    );
    await expectNewStamp("delete one day");
    const doc = (await h.editor("/api/parent/export")).json;
    expectOk(
      await h.editor(`/api/parent/entries/${id}?revision=4`, {
        method: "DELETE",
      }),
    );
    await expectNewStamp("delete series");
    expectOk(
      await h.editor("/api/parent/import?mode=merge", jsonInit("POST", doc)),
    );
    await expectNewStamp("merge import");
    expectOk(
      await h.editor("/api/parent/import?mode=replace", jsonInit("POST", doc)),
    );
    await expectNewStamp("replace import");
  });

  it("makes another isolate's warm board show the write at once", async () => {
    const writer = harness();
    const reader = harness();
    await createEntry(writer, SWIM);
    expect(
      (await reader.agenda()).events.filter((e) => e.title === "Schwimmen"),
    ).toHaveLength(2);
    await createEntry(writer, { ...SWIM, title: "Turnen", icon: "🤸" });
    // The reader's memory layer still holds the old app sources; the stamp tells it.
    expect(
      (await reader.agenda()).events.filter((e) => e.title === "Turnen"),
    ).toHaveLength(2);
  });
});
