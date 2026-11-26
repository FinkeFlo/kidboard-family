import {
  type AppConfig,
  AppConfigSchema,
  MAX_APP_ENTRIES,
} from "@kidboard/shared";
import { reset } from "cloudflare:test";
import { env as testEnv } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AppEntry,
  ENTRY_EXPORT_FORMAT,
  type EntryExport,
  EntryStore,
  MAX_ENTRY_BYTES,
  type StoreResult,
} from "./entryStore";
import { SchemaGate } from "./schema";
import { STAMP_KEY } from "./stamp";

const db = testEnv.KIDBOARD_DATA;

const CONFIG: AppConfig = AppConfigSchema.parse({
  locale: "de",
  timeZone: "Europe/Berlin",
  children: [
    { id: "mia", name: "Mia", color: "#E4572E", avatar: "🦊" },
    { id: "ben", name: "Ben", color: "#2E86AB", avatar: "🐻" },
  ],
  calendars: [
    { id: "kinder", kind: "events" },
    { id: "essen", kind: "meals" },
  ],
});

/** Monday 2026-03-09, 10:00 in Berlin. */
const NOW = Date.parse("2026-03-09T09:00:00Z");
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Monday swimming, weekly on Mondays from 2026-03-09. */
const SWIMMING = {
  kind: "event",
  childIds: ["mia"],
  icon: "🏊",
  title: "Schwimmen",
  allDay: false,
  date: "2026-03-09",
  startTime: "16:00",
  endTime: "17:00",
  repeat: { weekly: { weekdays: [1] } },
  bring: ["🩱"],
} as const;

const DENTIST = {
  kind: "event",
  childIds: ["ben"],
  icon: "🦷",
  title: "Zahnarzt",
  allDay: false,
  date: "2026-03-12",
  startTime: "09:30",
} as const;

const LUNCH = {
  kind: "meal",
  icon: "🍝",
  title: "Spaghetti",
  allDay: true,
  date: "2026-03-10",
  slot: "lunch",
} as const;

let clock: { now: number };
let warnings: string[];

function store(): EntryStore {
  return new EntryStore(db, { config: CONFIG, now: () => clock.now });
}

function ok<T>(result: StoreResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  }
  return result.value;
}

async function rawRowCount(): Promise<number> {
  return (
    (await db
      .prepare("SELECT COUNT(*) AS n FROM app_entries")
      .first<number>("n")) ?? -1
  );
}

beforeEach(() => {
  clock = { now: NOW };
  warnings = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.join(" "));
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

describe("create / get / list", () => {
  it("creates the tables on first use and stores a validated entry", async () => {
    const s = store();
    const entry = ok(await s.create(SWIMMING));

    expect(entry.id).toMatch(UUID_RE);
    expect(entry).toMatchObject({
      revision: 1,
      kind: "event",
      exdates: [],
      overrides: {},
      createdAt: "2026-03-09T09:00:00.000Z",
      updatedAt: "2026-03-09T09:00:00.000Z",
    });
    // Defaults of the T-39 schema are applied and stored.
    expect(entry.data).toEqual({
      ...SWIMMING,
      childIds: ["mia"],
      bring: ["🩱"],
      countdown: false,
      repeat: { weekly: { weekdays: [1], interval: 1 } },
    });
    expect(ok(await s.get(entry.id))).toEqual(entry);
    // A second store (another isolate) reads the same data.
    expect(ok(await store().get(entry.id))).toEqual(entry);
  });

  it("gives every entry a new random id", async () => {
    const s = store();
    const a = ok(await s.create(DENTIST));
    const b = ok(await s.create(DENTIST));
    expect(a.id).not.toBe(b.id);
    expect(await s.list()).toHaveLength(2);
  });

  it("rejects invalid input with the T-39 issues and writes nothing", async () => {
    const s = store();
    const cases: unknown[] = [
      { ...DENTIST, title: "" },
      { ...DENTIST, title: "Zahn\narzt" },
      { ...DENTIST, childIds: ["lena"] },
      { ...DENTIST, startTime: "25:00" },
      { ...DENTIST, extra: true },
      { ...LUNCH, slot: undefined },
      { ...DENTIST, startTime: "10:00", endTime: "09:00" },
      null,
      "Zahnarzt",
    ];
    for (const input of cases) {
      const result = await s.create(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("invalid");
      }
    }
    const unknownChild = await s.create({ ...DENTIST, childIds: ["lena"] });
    expect(unknownChild).toMatchObject({
      ok: false,
      error: "invalid",
      issues: [{ code: "unknown_child", path: "childIds.0" }],
    });
    // Nothing was written (validation runs before the first query).
    expect(await s.list()).toEqual([]);
  });

  it("stores titles with HTML-looking text as plain data", async () => {
    const s = store();
    const entry = ok(
      await s.create({ ...DENTIST, title: "<b>Zahnarzt</b> & <i>Co</i>" }),
    );
    expect(ok(await s.get(entry.id)).data.title).toBe(
      "<b>Zahnarzt</b> & <i>Co</i>",
    );
  });

  it("returns not_found for unknown and malformed ids", async () => {
    const s = store();
    expect(await s.get(crypto.randomUUID())).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await s.get("' OR 1=1 --")).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("lists entries touching [from, to) ordered by first date", async () => {
    const s = store();
    const swim = ok(await s.create(SWIMMING)); // open-ended series from 03-09
    const dentist = ok(await s.create(DENTIST)); // 03-12 only
    const lunch = ok(await s.create(LUNCH)); // 03-10 only
    const ended = ok(
      await s.create({
        ...SWIMMING,
        date: "2026-02-02",
        repeat: { weekly: { weekdays: [1], until: "2026-02-23" } },
      }),
    );
    const ids = (entries: AppEntry[]): string[] => entries.map((e) => e.id);

    expect(ids(await s.list())).toEqual([
      ended.id,
      swim.id,
      lunch.id,
      dentist.id,
    ]);
    expect(ids(await s.list("2026-03-11", "2026-03-12"))).toEqual([swim.id]);
    expect(ids(await s.list("2026-03-12", "2026-03-13"))).toEqual([
      swim.id,
      dentist.id,
    ]);
    expect(ids(await s.list("2026-02-20", "2026-03-09"))).toEqual([ended.id]);
    expect(ids(await s.list("2026-06-01"))).toEqual([swim.id]);
    expect(ids(await s.list(undefined, "2026-03-10"))).toEqual([
      ended.id,
      swim.id,
    ]);
    await expect(s.list("2026-13-01")).rejects.toThrow(RangeError);
  });
});

describe("update / remove with revisions", () => {
  it("updates with the current revision and bumps it", async () => {
    const s = store();
    const created = ok(await s.create(DENTIST));
    clock.now += 60_000;

    const updated = ok(
      await s.update(created.id, 1, { ...DENTIST, startTime: "11:00" }),
    );

    expect(updated).toMatchObject({
      id: created.id,
      revision: 2,
      createdAt: created.createdAt,
      updatedAt: "2026-03-09T09:01:00.000Z",
    });
    expect(updated.data.startTime).toBe("11:00");
    expect(ok(await s.get(created.id))).toEqual(updated);
  });

  it("rejects a stale revision with conflict and keeps the stored data", async () => {
    const s = store();
    const created = ok(await s.create(DENTIST));
    ok(await s.update(created.id, 1, { ...DENTIST, startTime: "11:00" }));

    expect(
      await s.update(created.id, 1, { ...DENTIST, startTime: "12:00" }),
    ).toEqual({ ok: false, error: "conflict", revision: 2 });
    expect(await s.remove(created.id, 1)).toEqual({
      ok: false,
      error: "conflict",
      revision: 2,
    });
    expect(ok(await s.get(created.id)).data.startTime).toBe("11:00");
  });

  it("lets exactly one of two concurrent updates of the same revision win", async () => {
    const created = ok(await store().create(DENTIST));
    const results = await Promise.all([
      store().update(created.id, 1, { ...DENTIST, startTime: "11:00" }),
      store().update(created.id, 1, { ...DENTIST, startTime: "12:00" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, error: "conflict", revision: 2 },
    ]);
  });

  it("returns not_found for missing entries and invalid for bad input", async () => {
    const s = store();
    const id = crypto.randomUUID();
    expect(await s.update(id, 1, DENTIST)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await s.remove(id, 1)).toEqual({ ok: false, error: "not_found" });
    const created = ok(await s.create(DENTIST));
    expect(
      await s.update(created.id, 1, { ...DENTIST, icon: "x" }),
    ).toMatchObject({ ok: false, error: "invalid" });
    expect(await s.update(created.id, 0, DENTIST)).toMatchObject({
      ok: false,
      error: "invalid",
      issues: [{ path: "revision" }],
    });
    expect(await s.remove(created.id, 1.5)).toMatchObject({
      ok: false,
      error: "invalid",
    });
  });

  it("removes with the current revision", async () => {
    const s = store();
    const created = ok(await s.create(DENTIST));
    expect(await s.remove(created.id, 1)).toEqual({ ok: true, value: null });
    expect(await s.get(created.id)).toEqual({ ok: false, error: "not_found" });
    expect(await s.remove(created.id, 1)).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("exceptions and overrides (only this day)", () => {
  it("adds an exception for a day of the series", async () => {
    const s = store();
    const swim = ok(await s.create(SWIMMING));

    const result = ok(await s.addException(swim.id, 1, "2026-03-23"));
    const again = ok(await s.addException(swim.id, 2, "2026-03-16"));

    expect(result.exdates).toEqual(["2026-03-23"]);
    expect(again).toMatchObject({
      revision: 3,
      exdates: ["2026-03-16", "2026-03-23"],
    });
    expect(ok(await s.get(swim.id)).exdates).toEqual([
      "2026-03-16",
      "2026-03-23",
    ]);
  });

  it("rejects days that are not occurrences and single entries", async () => {
    const s = store();
    const swim = ok(await s.create(SWIMMING));
    const dentist = ok(await s.create(DENTIST));

    for (const date of ["2026-03-10", "2026-03-02", "2026-02-30", "soon"]) {
      expect(await s.addException(swim.id, 1, date)).toMatchObject({
        ok: false,
        error: "invalid",
        issues: [{ path: "date" }],
      });
    }
    expect(await s.addException(dentist.id, 1, "2026-03-12")).toMatchObject({
      ok: false,
      error: "invalid",
    });
    expect(await s.addException(swim.id, 7, "2026-03-16")).toEqual({
      ok: false,
      error: "conflict",
      revision: 1,
    });
    expect(ok(await s.get(swim.id)).revision).toBe(1);
  });

  it("stores an override, which may move the day, and replaces exceptions", async () => {
    const s = store();
    const swim = ok(await s.create(SWIMMING));
    ok(await s.addException(swim.id, 1, "2026-03-16"));
    const moved = {
      ...SWIMMING,
      date: "2026-03-17",
      startTime: "15:00",
      endTime: "16:00",
      repeat: "none",
    };

    const result = ok(await s.setOverride(swim.id, 2, "2026-03-16", moved));

    expect(result.exdates).toEqual([]);
    expect(result.overrides).toEqual({
      "2026-03-16": {
        ...moved,
        childIds: ["mia"],
        bring: ["🩱"],
        countdown: false,
      },
    });
    expect(result.revision).toBe(3);
    // The series itself is untouched.
    expect(result.data).toEqual(swim.data);

    // An exception on the overridden day drops the override.
    const removed = ok(await s.addException(swim.id, 3, "2026-03-16"));
    expect(removed.overrides).toEqual({});
    expect(removed.exdates).toEqual(["2026-03-16"]);
  });

  it("validates overrides: single, same kind, valid input, occurrence day", async () => {
    const s = store();
    const swim = ok(await s.create(SWIMMING));
    const single = { ...SWIMMING, repeat: "none" };

    expect(
      await s.setOverride(swim.id, 1, "2026-03-16", SWIMMING),
    ).toMatchObject({
      ok: false,
      error: "invalid",
      issues: [{ path: "repeat" }],
    });
    expect(
      await s.setOverride(swim.id, 1, "2026-03-16", {
        ...LUNCH,
        date: "2026-03-16",
      }),
    ).toMatchObject({
      ok: false,
      error: "invalid",
      issues: [{ path: "kind" }],
    });
    expect(
      await s.setOverride(swim.id, 1, "2026-03-16", { ...single, title: "" }),
    ).toMatchObject({ ok: false, error: "invalid" });
    expect(await s.setOverride(swim.id, 1, "2026-03-17", single)).toMatchObject(
      { ok: false, error: "invalid", issues: [{ path: "date" }] },
    );
    expect(ok(await s.get(swim.id))).toEqual(swim);
  });

  it("keeps exceptions and overrides whose days still exist after a series edit", async () => {
    const s = store();
    const swim = ok(
      await s.create({
        ...SWIMMING,
        repeat: { weekly: { weekdays: [1, 3] } },
      }),
    );
    ok(await s.addException(swim.id, 1, "2026-03-16")); // Monday
    ok(await s.addException(swim.id, 2, "2026-03-18")); // Wednesday
    ok(
      await s.setOverride(swim.id, 3, "2026-03-23", {
        ...SWIMMING,
        date: "2026-03-23",
        startTime: "17:00",
        endTime: "18:00",
        repeat: "none",
      }),
    );
    ok(
      await s.setOverride(swim.id, 4, "2026-03-25", {
        ...SWIMMING,
        date: "2026-03-25",
        repeat: "none",
      }),
    );

    // Mondays only from now on: Wednesday exceptions and overrides are gone.
    const edited = ok(
      await s.update(swim.id, 5, { ...SWIMMING, title: "Schwimmkurs" }),
    );
    expect(edited.exdates).toEqual(["2026-03-16"]);
    expect(Object.keys(edited.overrides)).toEqual(["2026-03-23"]);

    // A single entry has no days to change.
    const single = ok(
      await s.update(swim.id, 6, { ...SWIMMING, repeat: "none" }),
    );
    expect(single.exdates).toEqual([]);
    expect(single.overrides).toEqual({});
  });

  it("lists a series by its moved override too", async () => {
    const s = store();
    const series = ok(
      await s.create({
        ...SWIMMING,
        repeat: { weekly: { weekdays: [1], until: "2026-03-16" } },
      }),
    );
    ok(
      await s.setOverride(series.id, 1, "2026-03-16", {
        ...SWIMMING,
        date: "2026-03-20",
        repeat: "none",
      }),
    );
    expect((await s.list("2026-03-20", "2026-03-21")).map((e) => e.id)).toEqual(
      [series.id],
    );
  });
});

describe("limits", () => {
  it(`refuses entry ${String(MAX_APP_ENTRIES + 1)} with limit_reached`, async () => {
    const s = store();
    const full: EntryExport = {
      format: ENTRY_EXPORT_FORMAT,
      version: 1,
      exportedAt: "2026-03-09T09:00:00.000Z",
      entries: [],
    };
    const template = ok(await s.create(DENTIST));
    full.entries = Array.from({ length: MAX_APP_ENTRIES }, () => ({
      ...template,
      id: crypto.randomUUID(),
    }));
    expect(ok(await s.importAll(full, "replace"))).toEqual({
      mode: "replace",
      imported: MAX_APP_ENTRIES,
      created: MAX_APP_ENTRIES,
      updated: 0,
    });
    expect(await rawRowCount()).toBe(MAX_APP_ENTRIES);

    expect(await s.create(DENTIST)).toEqual({
      ok: false,
      error: "limit_reached",
      limit: "entries",
    });
    expect(await rawRowCount()).toBe(MAX_APP_ENTRIES);

    // Updates and removals still work at the limit; then there is room again.
    const first = full.entries[0];
    if (first === undefined) {
      throw new Error("no entries");
    }
    const stored = ok(await s.get(first.id));
    ok(await s.remove(first.id, stored.revision));
    ok(await s.create(DENTIST));
    expect(await rawRowCount()).toBe(MAX_APP_ENTRIES);
  }, 30_000);

  it("refuses writes that make an entry larger than 8 KB", async () => {
    const s = store();
    const swim = ok(await s.create(SWIMMING));
    let revision = swim.revision;
    let result: StoreResult<AppEntry> | undefined;
    // Every override adds roughly 200 bytes; 60 Mondays are far beyond 8 KB.
    for (let week = 1; week <= 60; week += 1) {
      const date = new Date(Date.UTC(2026, 2, 9 + 7 * week))
        .toISOString()
        .slice(0, 10);
      result = await s.setOverride(swim.id, revision, date, {
        ...SWIMMING,
        date,
        title: `Schwimmen mit Training Woche ${String(week)}`,
        repeat: "none",
      });
      if (!result.ok) {
        break;
      }
      revision = result.value.revision;
    }
    expect(result).toEqual({
      ok: false,
      error: "limit_reached",
      limit: "size",
    });
    const stored = ok(await s.get(swim.id));
    expect(stored.revision).toBe(revision);
    const bytes = new TextEncoder().encode(
      JSON.stringify(stored.data) +
        JSON.stringify(stored.exdates) +
        JSON.stringify(stored.overrides),
    ).byteLength;
    expect(bytes).toBeLessThanOrEqual(MAX_ENTRY_BYTES);
    expect(bytes).toBeGreaterThan(MAX_ENTRY_BYTES - 300);
  });
});

describe("export / import", () => {
  async function seed(s: EntryStore): Promise<AppEntry[]> {
    const swim = ok(await s.create(SWIMMING));
    ok(await s.addException(swim.id, 1, "2026-03-16"));
    ok(
      await s.setOverride(swim.id, 2, "2026-03-23", {
        ...SWIMMING,
        date: "2026-03-24",
        repeat: "none",
      }),
    );
    clock.now += 1000;
    ok(await s.create(DENTIST));
    clock.now += 1000;
    ok(await s.create(LUNCH));
    return s.list();
  }

  it("round-trips export → replace import into an empty store", async () => {
    const s = store();
    const before = await seed(s);
    clock.now += 60_000;
    const doc = await s.exportAll();
    expect(doc).toMatchObject({
      format: "kidboard-entries",
      version: 1,
      exportedAt: "2026-03-09T09:01:02.000Z",
    });
    expect(doc.entries).toHaveLength(3);

    // Move to a new deployment: JSON text, empty database.
    const text = JSON.stringify(doc);
    await reset();
    const target = store();
    expect(ok(await target.importAll(JSON.parse(text), "replace"))).toEqual({
      mode: "replace",
      imported: 3,
      created: 3,
      updated: 0,
    });

    const after = await target.list();
    const strip = (e: AppEntry): Omit<AppEntry, "revision" | "updatedAt"> => ({
      id: e.id,
      kind: e.kind,
      data: e.data,
      exdates: e.exdates,
      overrides: e.overrides,
      createdAt: e.createdAt,
    });
    expect(after.map(strip)).toEqual(before.map(strip));
    expect(after.every((e) => e.updatedAt === "2026-03-09T09:01:02.000Z")).toBe(
      true,
    );
  });

  it("replace drops entries missing from the document; merge keeps them", async () => {
    const s = store();
    const dentist = (await seed(s)).find((e) => e.data.title === "Zahnarzt");
    if (dentist === undefined) {
      throw new Error("seed failed");
    }
    const doc = await s.exportAll();
    const onlyDentist: EntryExport = {
      ...doc,
      entries: doc.entries.filter((e) => e.id === dentist.id),
    };
    const extra = ok(await s.create({ ...DENTIST, title: "Kinderarzt" }));

    expect(ok(await s.importAll(onlyDentist, "merge")).imported).toBe(1);
    expect((await s.list()).map((e) => e.id).sort()).toEqual(
      [...doc.entries.map((e) => e.id), extra.id].sort(),
    );

    ok(await s.importAll(onlyDentist, "replace"));
    expect((await s.list()).map((e) => e.id)).toEqual([dentist.id]);
  });

  it("gives imported entries a revision above every old one (stale clients conflict)", async () => {
    const s = store();
    const dentist = ok(await s.create(DENTIST));
    const doc = await s.exportAll();
    ok(await s.update(dentist.id, 1, { ...DENTIST, startTime: "11:00" }));
    ok(await s.update(dentist.id, 2, { ...DENTIST, startTime: "12:00" }));

    ok(await s.importAll(doc, "replace"));

    const restored = ok(await s.get(dentist.id));
    expect(restored.data.startTime).toBe("09:30");
    expect(restored.revision).toBe(4);
    expect(await s.update(dentist.id, 3, DENTIST)).toMatchObject({
      error: "conflict",
    });
  });

  it.each(["replace", "merge"] as const)(
    "%s import counts writes that land between its pre-read and its batch",
    async (mode) => {
      const s = store();
      const dentist = ok(await s.create(DENTIST));
      const other = ok(await s.create(LUNCH));
      const doc = await s.exportAll();
      // Another isolate writes after the import read the ids, before its batch runs.
      const realBatch = db.batch.bind(db);
      vi.spyOn(db, "batch").mockImplementationOnce(async (statements) => {
        await db
          .prepare("UPDATE app_entries SET revision = 10 WHERE id = ?")
          .bind(other.id)
          .run();
        return realBatch(statements);
      });

      ok(await s.importAll(doc, mode));

      // Every imported revision is above the concurrently written 10, so a client
      // holding revision 10 of `other` gets a conflict.
      expect(ok(await s.get(other.id)).revision).toBe(11);
      expect(ok(await s.get(dentist.id)).revision).toBe(11);
      expect(await s.update(other.id, 10, LUNCH)).toMatchObject({
        error: "conflict",
      });
      // The scratch value does not outlive the import.
      expect(
        await db
          .prepare(
            "SELECT COUNT(*) AS n FROM kb_meta WHERE key = 'import_base_revision'",
          )
          .first<number>("n"),
      ).toBe(0);
    },
  );

  it("rejects invalid documents as a whole and writes nothing", async () => {
    const s = store();
    const dentist = ok(await s.create(DENTIST));
    const doc = await s.exportAll();
    const valid = doc.entries[0];
    if (valid === undefined) {
      throw new Error("no entry");
    }
    const otherId = crypto.randomUUID();
    const cases: [unknown, string][] = [
      [null, ""],
      [{ ...doc, format: "something-else" }, "format"],
      [{ ...doc, version: 2 }, "version"],
      [{ ...doc, entries: [{ ...valid, id: "not-a-uuid" }] }, "entries.0.id"],
      [{ ...doc, entries: [valid, { ...valid }] }, "entries.1.id"],
      [
        {
          ...doc,
          entries: [
            {
              ...valid,
              id: otherId,
              data: { ...valid.data, childIds: ["Not A Slug"] },
            },
          ],
        },
        "entries.0.data.childIds.0",
      ],
      [
        {
          ...doc,
          entries: [{ ...valid, id: otherId, exdates: ["2026-03-12"] }],
        },
        "entries.0.exdates",
      ],
      [{ ...doc, entries: [{ ...valid, id: otherId, extra: 1 }] }, "entries.0"],
    ];
    for (const [input, path] of cases) {
      const result = await s.importAll(input, "replace");
      expect(result.ok).toBe(false);
      if (!result.ok && result.error === "invalid") {
        expect(result.issues.map((i) => i.path)).toContain(path);
      } else {
        throw new Error(`expected invalid for ${path}`);
      }
    }
    expect((await s.list()).map((e) => e.id)).toEqual([dentist.id]);
  });

  it("restores entries the config can no longer express (shape-checked only)", async () => {
    const s = store();
    const dentist = ok(await s.create(DENTIST));
    const doc = await s.exportAll();
    const valid = doc.entries[0];
    if (valid === undefined) {
      throw new Error("no entry");
    }
    const removedChild = {
      ...valid,
      id: crypto.randomUUID(),
      data: { ...valid.data, childIds: ["removed-child"] },
    };
    expect(
      ok(
        await s.importAll(
          { ...doc, entries: [valid, removedChild] },
          "replace",
        ),
      ),
    ).toEqual({ mode: "replace", imported: 2, created: 1, updated: 1 });
    const stored = await s.list();
    expect(stored.map((e) => e.id).sort()).toEqual(
      [dentist.id, removedChild.id].sort(),
    );
    const restored = stored.find((e) => e.id === removedChild.id);
    expect(restored?.data.childIds).toEqual(["removed-child"]);
    // New writes are still checked against the config.
    expect(
      await s.update(
        removedChild.id,
        restored?.revision ?? 0,
        removedChild.data,
      ),
    ).toMatchObject({
      ok: false,
      error: "invalid",
      issues: [expect.objectContaining({ code: "unknown_child" })],
    });
  });

  it("refuses a merge beyond the entry limit and an oversized entry", async () => {
    const s = store();
    const template = ok(await s.create(DENTIST));
    const doc = await s.exportAll();
    const many: EntryExport = {
      ...doc,
      entries: Array.from({ length: MAX_APP_ENTRIES }, () => ({
        ...template,
        id: crypto.randomUUID(),
      })),
    };
    expect(await s.importAll(many, "merge")).toEqual({
      ok: false,
      error: "limit_reached",
      limit: "entries",
    });
    expect(await rawRowCount()).toBe(1);

    const swimDoc = {
      ...doc,
      entries: [
        {
          ...template,
          id: crypto.randomUUID(),
          data: { ...SWIMMING },
          overrides: Object.fromEntries(
            Array.from({ length: 60 }, (_, week) => {
              const date = new Date(Date.UTC(2026, 2, 9 + 7 * (week + 1)))
                .toISOString()
                .slice(0, 10);
              return [
                date,
                {
                  ...SWIMMING,
                  date,
                  title: "Schwimmen mit Training",
                  repeat: "none",
                },
              ];
            }),
          ),
        },
      ],
    };
    expect(await s.importAll(swimDoc, "merge")).toEqual({
      ok: false,
      error: "limit_reached",
      limit: "size",
    });
    expect(await rawRowCount()).toBe(1);
  });

  it("rolls the whole import back when the limit guard fires", async () => {
    const s = store();
    const template = ok(await s.create(DENTIST));
    const doc = await s.exportAll();
    const almostFull: EntryExport = {
      ...doc,
      entries: Array.from({ length: MAX_APP_ENTRIES - 1 }, () => ({
        ...template,
        id: crypto.randomUUID(),
      })),
    };
    // The pre-check sees room for 999 + 1; a create "in between" fills the gap.
    const realPrepare = db.prepare.bind(db);
    let raced = false;
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (!raced && sql.startsWith("INSERT INTO kb_guard")) {
        raced = true;
        void realPrepare(
          "INSERT INTO app_entries (id, revision, kind, data, first_date, created_at, updated_at) VALUES ('racer', 1, 'event', '{}', '2026-03-09', 'a', 'a')",
        )
          .run()
          .catch(() => undefined);
      }
      return realPrepare(sql);
    });
    const before = await rawRowCount();

    const result = await s.importAll(almostFull, "merge");

    expect(raced).toBe(true);
    expect(result).toEqual({
      ok: false,
      error: "limit_reached",
      limit: "entries",
    });
    // Only the racing row was added; none of the 999 imported ones.
    expect(await rawRowCount()).toBe(before + 1);
  }, 30_000);
});

describe("corrupt rows", () => {
  it("are skipped on read and logged by type only", async () => {
    const s = store();
    const dentist = ok(await s.create(DENTIST));
    const insert = db.prepare(
      "INSERT INTO app_entries (id, revision, kind, data, exdates, overrides, first_date, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?, '2026-03-01', 'a', 'a')",
    );
    const brokenJson = crypto.randomUUID();
    const badShape = crypto.randomUUID();
    const wrongKind = crypto.randomUUID();
    await db.batch([
      insert.bind(brokenJson, "event", "{TESTONLY-private", "[]", "{}"),
      insert.bind(
        badShape,
        "event",
        JSON.stringify({ ...DENTIST, title: "" }),
        "[]",
        "{}",
      ),
      insert.bind(wrongKind, "meal", JSON.stringify(DENTIST), "[]", "{}"),
      insert.bind(
        crypto.randomUUID(),
        "nonsense",
        JSON.stringify(DENTIST),
        "[]",
        "{}",
      ),
    ]);

    expect((await s.list()).map((e) => e.id)).toEqual([dentist.id]);
    expect((await s.exportAll()).entries.map((e) => e.id)).toEqual([
      dentist.id,
    ]);
    expect(await s.get(brokenJson)).toEqual({ ok: false, error: "not_found" });
    expect(await s.update(badShape, 1, DENTIST)).toEqual({
      ok: false,
      error: "not_found",
    });
    // A corrupt row can still be removed.
    expect(await s.remove(wrongKind, 1)).toEqual({ ok: true, value: null });

    expect(warnings.length).toBeGreaterThan(0);
    for (const line of warnings) {
      expect(line).toMatch(
        /skipped a stored app entry: (invalid_columns|invalid_json|invalid_data)$/,
      );
      expect(line).not.toContain("TESTONLY");
    }
  });
});

describe("schema on first use", () => {
  it("works on an empty database with a shared gate across stores", async () => {
    const gate = new SchemaGate();
    const a = new EntryStore(db, { config: CONFIG, gate });
    const b = new EntryStore(db, { config: CONFIG, gate });
    const [x, y] = await Promise.all([a.create(DENTIST), b.create(LUNCH)]);
    expect(x.ok && y.ok).toBe(true);
    expect(await a.list()).toHaveLength(2);
  });

  it("re-creates the tables after the database was emptied", async () => {
    const s = store();
    ok(await s.create(DENTIST));
    await reset();
    // The first query fails (tables gone) and makes the store re-check the schema.
    await expect(s.list()).rejects.toThrow();
    expect(await s.list()).toEqual([]);
    ok(await s.create(DENTIST));
  });
});

describe("change stamp (one batch with every write)", () => {
  async function stamp(): Promise<string | null> {
    return db
      .prepare("SELECT value FROM kb_meta WHERE key = ?")
      .bind(STAMP_KEY)
      .first<string>("value");
  }

  it("replaces the stamp with every kind of write", async () => {
    const s = store();
    const seen: (string | null)[] = [];
    const expectNewStamp = async (): Promise<void> => {
      const current = await stamp();
      expect(current).toMatch(UUID_RE);
      expect(seen).not.toContain(current);
      seen.push(current);
    };

    const swim = ok(await s.create(SWIMMING));
    await expectNewStamp();
    ok(await s.update(swim.id, 1, { ...SWIMMING, startTime: "15:00" }));
    await expectNewStamp();
    ok(
      await s.setOverride(swim.id, 2, "2026-03-16", {
        ...SWIMMING,
        startTime: "15:00",
        date: "2026-03-16",
        repeat: "none",
      }),
    );
    await expectNewStamp();
    ok(await s.addException(swim.id, 3, "2026-03-23"));
    await expectNewStamp();
    const doc = await s.exportAll();
    ok(await s.remove(swim.id, 4));
    await expectNewStamp();
    ok(await s.importAll(doc, "merge"));
    await expectNewStamp();
    ok(await s.importAll(doc, "replace"));
    await expectNewStamp();
  });

  it("rolls every write back when its stamp cannot be written (same transaction)", async () => {
    const s = store();
    const swim = ok(await s.create(SWIMMING));
    const before = await s.exportAll();
    // From here on, any write of the stamp aborts its statement.
    for (const event of ["INSERT", "UPDATE"]) {
      await db
        .prepare(
          `CREATE TRIGGER no_stamp_${event.toLowerCase()} BEFORE ${event} ON kb_meta
           WHEN NEW.key = '${STAMP_KEY}' BEGIN SELECT RAISE(ABORT, 'no stamp'); END`,
        )
        .run();
    }
    const writes: [string, () => Promise<unknown>][] = [
      ["create", () => s.create(DENTIST)],
      ["update", () => s.update(swim.id, 1, { ...SWIMMING, title: "Neu" })],
      [
        "override",
        () =>
          s.setOverride(swim.id, 1, "2026-03-16", {
            ...SWIMMING,
            date: "2026-03-16",
            repeat: "none",
          }),
      ],
      ["exception", () => s.addException(swim.id, 1, "2026-03-16")],
      ["remove", () => s.remove(swim.id, 1)],
      ["merge import", () => s.importAll(before, "merge")],
      ["replace import", () => s.importAll(before, "replace")],
    ];
    for (const [name, write] of writes) {
      await expect(write(), name).rejects.toThrow();
      expect(
        { ...(await s.exportAll()), exportedAt: before.exportedAt },
        name,
      ).toEqual(before);
    }
    expect(await rawRowCount()).toBe(1);
  });
});
