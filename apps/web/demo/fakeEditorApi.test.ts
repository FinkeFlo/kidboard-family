import {
  AppEntrySchema,
  EditorListResponseSchema,
  EditorTemplatesResponseSchema,
  PublicConfigSchema,
} from "@kidboard/shared";
import { describe, expect, it } from "vitest";

import {
  createFakeEditor,
  type FakeEditor,
  type FakeResponse,
} from "./fakeEditorApi.ts";

/** Sunday 2026-11-22 12:00 in Berlin. */
const NOW = Date.parse("2026-11-22T12:00:00+01:00");
const TODAY = "2026-11-22";
const SESSION = "TESTONLY-not-a-session";

const CONFIG = PublicConfigSchema.parse({
  locale: "en",
  timeZone: "Europe/Berlin",
  calendars: [{ id: "family", kind: "events" }],
  children: [
    { id: "mia", name: "Mia", color: "child-1", avatar: "🦊" },
    { id: "ben", name: "Ben", color: "child-2", avatar: "🐻" },
  ],
  editor: true,
});

const SWIM = {
  kind: "event",
  childIds: ["mia"],
  icon: "🏊",
  title: "Swimming",
  allDay: false,
  date: TODAY,
  startTime: "15:00",
  endTime: "16:00",
  repeat: { weekly: { weekdays: [7], interval: 1 } },
};

function fake(maxEntries?: number): FakeEditor {
  return createFakeEditor({
    config: () => CONFIG,
    now: () => NOW,
    isSession: (token) => token === SESSION,
    ...(maxEntries === undefined ? {} : { maxEntries }),
  });
}

function call(
  editor: FakeEditor,
  method: string,
  pathAndQuery: string,
  body?: unknown,
  session: string | null = SESSION,
): FakeResponse {
  const [path = "", search = ""] = pathAndQuery.split("?");
  const answer = editor.handle({
    method,
    path,
    search,
    body: body === undefined ? null : JSON.stringify(body),
    session,
  });
  if (answer === null) throw new Error(`not an editor route: ${path}`);
  return answer;
}

function errorOf(response: FakeResponse): unknown {
  return (response.json as { error?: unknown }).error;
}

describe("fake editor API: phone feed", () => {
  const FEED = "/api/feed.ics?token=TESTONLY-not-a-secret-feed-0123456789";

  it("answers the relative URL only to a session, and {} when the feed is off", () => {
    const editor = createFakeEditor({
      config: () => CONFIG,
      now: () => NOW,
      isSession: (token) => token === SESSION,
      feedUrl: FEED,
    });
    expect(call(editor, "GET", "/api/parent/feed").json).toEqual({
      feedUrl: FEED,
    });
    expect(
      errorOf(call(editor, "GET", "/api/parent/feed", undefined, null)),
    ).toBe("parent_locked");
    editor.setFeedUrl(undefined);
    expect(call(editor, "GET", "/api/parent/feed").json).toEqual({});
    expect(
      fake().handle({
        method: "GET",
        path: "/api/parent/feed",
        search: "",
        body: null,
        session: SESSION,
      })?.json,
    ).toEqual({});
  });
});

describe("fake editor API", () => {
  it("serves only editor routes and only with a session (403, never 401)", () => {
    const editor = fake();
    expect(
      editor.handle({
        method: "GET",
        path: "/api/agenda",
        search: "",
        body: null,
        session: SESSION,
      }),
    ).toBeNull();
    const locked = call(editor, "GET", "/api/parent/entries", undefined, null);
    expect(locked.status).toBe(403);
    expect(errorOf(locked)).toBe("parent_locked");
  });

  it("creates, lists the series occurrences and exports them", () => {
    const editor = fake();
    const created = call(editor, "POST", "/api/parent/entries", SWIM);
    expect(created.status).toBe(201);
    const entry = AppEntrySchema.parse(
      (created.json as { entry: unknown }).entry,
    );
    expect(entry.revision).toBe(1);
    const list = EditorListResponseSchema.parse(
      call(editor, "GET", `/api/parent/entries?from=${TODAY}&days=14`).json,
    );
    expect(list.range).toEqual({ from: TODAY, to: "2026-12-06" });
    expect(list.items.map((item) => item.date)).toEqual([TODAY, "2026-11-29"]);
    expect(list.items[0]).toMatchObject({
      origin: "app",
      entryId: entry.id,
      occurrenceDate: TODAY,
      start: "2026-11-22T15:00:00+01:00",
    });
    const exported = call(editor, "GET", "/api/parent/export");
    expect(exported.headers?.["Content-Disposition"]).toBe(
      `attachment; filename="kidboard-entries-${TODAY}.json"`,
    );
    expect(exported.json).toMatchObject({
      format: "kidboard-entries",
      version: 1,
      entries: [{ id: entry.id }],
    });
  });

  it("rejects invalid entries with field issues and a full store with limit_reached", () => {
    const editor = fake(1);
    const invalid = call(editor, "POST", "/api/parent/entries", {
      ...SWIM,
      childIds: ["lea"],
    });
    expect(invalid.status).toBe(422);
    expect(invalid.json).toMatchObject({
      error: "invalid_entry",
      issues: [{ code: "unknown_child", path: "childIds.0" }],
    });
    expect(call(editor, "POST", "/api/parent/entries", SWIM).status).toBe(201);
    const full = call(editor, "POST", "/api/parent/entries", SWIM);
    expect(full.json).toMatchObject({
      error: "limit_reached",
      limit: "entries",
    });
  });

  it("checks the list window like the worker", () => {
    const editor = fake();
    expect(
      call(editor, "GET", `/api/parent/entries?from=${TODAY}&days=32`).status,
    ).toBe(400);
    expect(
      call(editor, "GET", "/api/parent/entries?from=2026-11-20&days=7").status,
    ).toBe(400);
    expect(
      call(editor, "GET", "/api/parent/entries?from=2026-11-21&days=31").status,
    ).toBe(200);
  });

  it("changes one day as an override and the series with revisions and conflicts", () => {
    const editor = fake();
    const { id } = editor.seed(SWIM);
    const one = call(
      editor,
      "PATCH",
      `/api/parent/entries/${id}?scope=one&date=2026-11-29`,
      {
        revision: 1,
        entry: {
          ...SWIM,
          date: "2026-11-29",
          repeat: "none",
          startTime: "16:00",
          endTime: "17:00",
        },
      },
    );
    expect(one.status).toBe(200);
    expect(Object.keys(editor.entries()[0]?.overrides ?? {})).toEqual([
      "2026-11-29",
    ]);
    // Not a day of the rule: no override.
    expect(
      call(
        editor,
        "PATCH",
        `/api/parent/entries/${id}?scope=one&date=2026-11-24`,
        {
          revision: 2,
          entry: SWIM,
        },
      ).status,
    ).toBe(422);
    const stale = call(
      editor,
      "PATCH",
      `/api/parent/entries/${id}?scope=series`,
      {
        revision: 1,
        entry: SWIM,
      },
    );
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ error: "conflict", revision: 2 });
    // Moving the series to Mondays drops the Sunday override.
    const moved = call(
      editor,
      "PATCH",
      `/api/parent/entries/${id}?scope=series`,
      {
        revision: 2,
        entry: {
          ...SWIM,
          date: "2026-11-23",
          repeat: { weekly: { weekdays: [1], interval: 1 } },
        },
      },
    );
    expect(moved.status).toBe(200);
    expect(editor.entries()[0]).toMatchObject({ revision: 3, overrides: {} });
    expect(
      call(editor, "PATCH", "/api/parent/entries/missing?scope=series", {
        revision: 1,
        entry: SWIM,
      }).status,
    ).toBe(404);
  });

  it("deletes one day as an exception or the whole entry", () => {
    const editor = fake();
    const { id } = editor.seed(SWIM);
    expect(
      call(editor, "DELETE", `/api/parent/entries/${id}?scope=series`).status,
    ).toBe(400);
    expect(
      call(
        editor,
        "DELETE",
        `/api/parent/entries/${id}?scope=one&date=${TODAY}&revision=1`,
      ).json,
    ).toMatchObject({ entry: { exdates: [TODAY], revision: 2 } });
    const list = EditorListResponseSchema.parse(
      call(editor, "GET", `/api/parent/entries?from=${TODAY}&days=14`).json,
    );
    expect(list.items.map((item) => item.date)).toEqual(["2026-11-29"]);
    expect(
      call(
        editor,
        "DELETE",
        `/api/parent/entries/${id}?scope=series&revision=2`,
      ).json,
    ).toEqual({ entry: null, boardRefresh: "now" });
    expect(editor.entries()).toEqual([]);
  });

  it("suggests templates and reports unresolved entries and missing storage", () => {
    let config = PublicConfigSchema.parse({
      ...CONFIG,
      children: [
        ...CONFIG.children,
        { id: "lea", name: "Lea", color: "child-3", avatar: "🦉" },
      ],
    });
    const editor = createFakeEditor({
      config: () => config,
      now: () => NOW,
      isSession: () => true,
    });
    editor.seed(SWIM);
    editor.seed({ ...SWIM, childIds: ["lea"], repeat: "none", title: "Lea" });
    config = CONFIG;
    const templates = EditorTemplatesResponseSchema.parse(
      call(editor, "GET", "/api/parent/templates").json,
    ).templates;
    expect(templates).toEqual([
      // Four Sundays in the 28-day template window.
      expect.objectContaining({
        title: "Swimming",
        count: 4,
        startTime: "15:00",
      }),
    ]);
    const list = EditorListResponseSchema.parse(
      call(editor, "GET", `/api/parent/entries?from=${TODAY}&days=14`).json,
    );
    expect(list.unresolved).toEqual([
      expect.objectContaining({
        issues: [expect.objectContaining({ code: "unknown_child" })],
      }),
    ]);
    editor.setStorageUnavailable(true);
    const without = EditorListResponseSchema.parse(
      call(editor, "GET", `/api/parent/entries?from=${TODAY}&days=14`).json,
    );
    expect(without).toMatchObject({
      storageUnavailable: true,
      items: [],
      unresolved: [],
    });
  });

  it("imports with merge or replace and validates the document", () => {
    const editor = fake();
    editor.seed(SWIM);
    const doc = JSON.parse(
      JSON.stringify(call(editor, "GET", "/api/parent/export").json),
    ) as { entries: { id: string }[] };
    const other = fake();
    other.seed({ ...SWIM, title: "Other" });
    expect(
      call(other, "POST", "/api/parent/import?mode=merge", doc).json,
    ).toMatchObject({ mode: "merge", imported: 1, created: 1, updated: 0 });
    expect(other.entries()).toHaveLength(2);
    // The same document again: its entry is stored now, so it counts as updated.
    expect(
      call(other, "POST", "/api/parent/import?mode=replace", doc).json,
    ).toMatchObject({ mode: "replace", imported: 1, created: 0, updated: 1 });
    expect(other.entries().map((e) => e.id)).toEqual([doc.entries[0]?.id]);
    expect(
      call(other, "POST", "/api/parent/import?mode=wipe", doc).status,
    ).toBe(400);
    expect(
      call(other, "POST", "/api/parent/import?mode=merge", { format: "x" })
        .status,
    ).toBe(422);
  });

  it("fails the next matching request on demand and records writes", () => {
    const editor = fake();
    editor.failNext("POST", {
      status: 503,
      json: { error: "storage_unavailable", message: "" },
    });
    expect(call(editor, "POST", "/api/parent/entries", SWIM).status).toBe(503);
    expect(call(editor, "POST", "/api/parent/entries", SWIM).status).toBe(201);
    expect(editor.writes.map((w) => `${w.method} ${w.path}`)).toEqual([
      "POST /api/parent/entries",
      "POST /api/parent/entries",
    ]);
    expect(editor.writes[0]?.body).toMatchObject({ title: "Swimming" });
  });

  it("gives the app entries to the board agenda", () => {
    const editor = fake();
    editor.seed(SWIM);
    editor.seed({
      kind: "meal",
      icon: "🍕",
      title: "Pizza",
      allDay: true,
      date: TODAY,
      slot: "dinner",
    });
    const items = editor.agendaItems({ from: TODAY, to: "2026-11-30" });
    expect(items.events.map((e) => e.start)).toEqual([
      "2026-11-22T15:00:00+01:00",
      "2026-11-29T15:00:00+01:00",
    ]);
    expect(items.meals).toEqual([
      expect.objectContaining({ date: TODAY, slot: "dinner", title: "Pizza" }),
    ]);
  });
});
