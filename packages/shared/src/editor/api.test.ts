import { describe, expect, it } from "vitest";

import {
  EditorErrorResponseSchema,
  EditorImportResponseSchema,
  EditorListResponseSchema,
  EditorWriteResponseSchema,
} from "./api";

const ENTRY = {
  id: "5b0e8f3c-3d1e-4a8e-9f0a-2b1c3d4e5f60",
  revision: 2,
  kind: "event",
  data: {
    kind: "event",
    icon: "🏊",
    title: "Schwimmen",
    allDay: false,
    date: "2026-03-10",
    startTime: "16:00",
    repeat: { weekly: { weekdays: [2] } },
  },
  exdates: ["2026-03-17"],
  overrides: {},
  createdAt: "2026-03-09T09:00:00.000Z",
  updatedAt: "2026-03-09T09:05:00.000Z",
};

describe("editor API schemas", () => {
  it("parse a write response and apply the entry defaults", () => {
    const parsed = EditorWriteResponseSchema.parse({
      entry: ENTRY,
      boardRefresh: "now",
    });
    expect(parsed.entry?.data).toMatchObject({
      childIds: [],
      bring: [],
      countdown: false,
      repeat: { weekly: { weekdays: [2], interval: 1 } },
    });
    expect(
      EditorWriteResponseSchema.parse({ entry: null, boardRefresh: "now" })
        .entry,
    ).toBeNull();
    expect(
      EditorWriteResponseSchema.safeParse({
        entry: null,
        boardRefresh: "later",
      }).success,
    ).toBe(false);
  });

  it("tell app and Google list items apart and ignore unknown fields", () => {
    const base = {
      kind: "event",
      icon: "🩰",
      title: "Ballett",
      childIds: ["mia"],
      allDay: false,
      start: "2026-03-10T15:00:00+01:00",
      end: "2026-03-10T16:00:00+01:00",
      date: "2026-03-10",
      bring: [],
      countdown: false,
    };
    const parsed = EditorListResponseSchema.parse({
      timeZone: "Europe/Berlin",
      range: { from: "2026-03-09", to: "2026-03-23" },
      sources: [{ id: "kinder", status: "ok" }],
      items: [
        {
          ...base,
          origin: "google",
          id: "g1",
          sourceId: "kinder",
          iconIsFallback: false,
          futureField: 1,
        },
        {
          ...base,
          origin: "app",
          id: `${ENTRY.id}/2026-03-10`,
          entryId: ENTRY.id,
          revision: 2,
          entry: ENTRY.data,
          occurrenceDate: "2026-03-10",
          override: null,
        },
      ],
    });
    expect(parsed.items.map((i) => i.origin)).toEqual(["google", "app"]);
    expect(parsed.items[0]).not.toHaveProperty("futureField");
    // An app item without its revision is not editable: rejected.
    expect(
      EditorListResponseSchema.safeParse({
        ...parsed,
        items: [{ ...parsed.items[1], revision: undefined }],
      }).success,
    ).toBe(false);
  });

  it("parse error bodies with issues, revision and limit", () => {
    expect(
      EditorErrorResponseSchema.parse({
        error: "invalid_entry",
        message: "The entry is not valid",
        issues: [
          { code: "unknown_child", path: "childIds.0", message: "Unknown" },
        ],
      }).issues?.[0]?.code,
    ).toBe("unknown_child");
    expect(
      EditorErrorResponseSchema.parse({
        error: "conflict",
        message: "changed",
        revision: 3,
      }).revision,
    ).toBe(3);
    expect(
      EditorErrorResponseSchema.safeParse({
        error: "limit_reached",
        message: "x",
        limit: "disk",
      }).success,
    ).toBe(false);
  });

  it("parse an import response with created and updated counts that add up", () => {
    const ok = {
      mode: "merge",
      imported: 4,
      created: 1,
      updated: 3,
      boardRefresh: "now",
    };
    expect(EditorImportResponseSchema.parse(ok)).toEqual(ok);
    expect(
      EditorImportResponseSchema.safeParse({ ...ok, created: 0 }).success,
    ).toBe(false);
    expect(
      EditorImportResponseSchema.safeParse({
        mode: "merge",
        imported: 4,
        boardRefresh: "now",
      }).success,
    ).toBe(false);
    expect(
      EditorImportResponseSchema.safeParse({ ...ok, updated: -1, created: 5 })
        .success,
    ).toBe(false);
  });
});
