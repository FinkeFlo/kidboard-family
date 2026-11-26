import { reset } from "cloudflare:test";
import { env as testEnv } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ensureSchema, SCHEMA_VERSION, SchemaGate } from "./schema";

const db = testEnv.KIDBOARD_DATA;

async function tableNames(): Promise<string[]> {
  const { results } = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('kb_schema', 'app_entries', 'kb_guard', 'kb_meta') ORDER BY name",
    )
    .run<{ name: string }>();
  return results.map((row) => row.name);
}

async function versionRows(): Promise<{ id: number; version: number }[]> {
  const { results } = await db
    .prepare("SELECT id, version FROM kb_schema")
    .run<{ id: number; version: number }>();
  return results;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

describe("ensureSchema", () => {
  it("creates the tables and the version row in an empty database", async () => {
    expect(await tableNames()).toEqual([]);

    await ensureSchema(db);

    expect(await tableNames()).toEqual([
      "app_entries",
      "kb_guard",
      "kb_meta",
      "kb_schema",
    ]);
    expect(await versionRows()).toEqual([{ id: 1, version: SCHEMA_VERSION }]);
  });

  it("is idempotent and keeps existing rows", async () => {
    await ensureSchema(db);
    await db
      .prepare(
        "INSERT INTO app_entries (id, revision, kind, data, first_date, created_at, updated_at) VALUES ('x', 1, 'event', '{}', '2026-03-09', 'a', 'a')",
      )
      .run();

    await ensureSchema(db);

    expect(await versionRows()).toEqual([{ id: 1, version: SCHEMA_VERSION }]);
    const count = await db
      .prepare("SELECT COUNT(*) AS n FROM app_entries")
      .first<number>("n");
    expect(count).toBe(1);
  });

  it("is safe under concurrent first requests (separate isolates)", async () => {
    await Promise.all(
      Array.from({ length: 8 }, () => new SchemaGate().ensure(db)),
    );

    expect(await tableNames()).toEqual([
      "app_entries",
      "kb_guard",
      "kb_meta",
      "kb_schema",
    ]);
    expect(await versionRows()).toEqual([{ id: 1, version: SCHEMA_VERSION }]);
  });

  it("does not downgrade a newer schema version and warns once per call", async () => {
    await ensureSchema(db);
    await db
      .prepare("UPDATE kb_schema SET version = ? WHERE id = 1")
      .bind(SCHEMA_VERSION + 1)
      .run();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await ensureSchema(db);

    expect(await versionRows()).toEqual([
      { id: 1, version: SCHEMA_VERSION + 1 },
    ]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("the guard table rejects every row", async () => {
    await ensureSchema(db);
    await expect(
      db.prepare("INSERT INTO kb_guard (ok) VALUES (0)").run(),
    ).rejects.toThrow();
  });
});

describe("SchemaGate", () => {
  it("runs the schema check once per database until forgotten", async () => {
    const gate = new SchemaGate();
    const batch = vi.spyOn(db, "batch");

    await gate.ensure(db);
    await gate.ensure(db);
    expect(batch).toHaveBeenCalledTimes(2); // bootstrap + version-1 step, once

    gate.forget(db);
    await gate.ensure(db);
    expect(batch).toHaveBeenCalledTimes(3); // bootstrap only, already current
  });

  it("does not remember a failed check", async () => {
    const gate = new SchemaGate();
    const batch = vi
      .spyOn(db, "batch")
      .mockRejectedValueOnce(new Error("D1 unavailable"));

    await expect(gate.ensure(db)).rejects.toThrow("D1 unavailable");
    await gate.ensure(db);

    expect(batch).toHaveBeenCalledTimes(3);
    expect(await tableNames()).toEqual([
      "app_entries",
      "kb_guard",
      "kb_meta",
      "kb_schema",
    ]);
  });
});
