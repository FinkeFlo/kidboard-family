import { logWarn } from "../log";

/**
 * D1 schema of the app entry store (ADR-0014), created by the worker on first use so
 * families never run a migration step.
 *
 * `kb_schema` holds exactly one row with the applied version. {@link SCHEMA_STEPS} are
 * forward-only: step `n` (1-based) brings the database from version `n - 1` to `n`.
 * Every statement must be idempotent (`IF NOT EXISTS`, `OR IGNORE`, ...): two isolates
 * that see the same old version at the same time both run the step, one after the
 * other (each batch is a transaction), and the second run must change nothing.
 */
export const SCHEMA_STEPS: readonly (readonly string[])[] = [
  // Version 1 (T-40): app entries.
  [
    `CREATE TABLE IF NOT EXISTS app_entries (
      id TEXT PRIMARY KEY NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 1),
      kind TEXT NOT NULL,
      data TEXT NOT NULL,
      exdates TEXT NOT NULL DEFAULT '[]',
      overrides TEXT NOT NULL DEFAULT '{}',
      first_date TEXT NOT NULL,
      last_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS app_entries_dates ON app_entries (first_date, last_date)`,
    // Never holds a row: an insert of 0 fails the CHECK and rolls back the whole batch.
    // Used as an atomic "abort if over the limit" guard inside batches.
    `CREATE TABLE IF NOT EXISTS kb_guard (ok INTEGER NOT NULL CHECK (ok = 1))`,
    // Small key/value scratch space, e.g. the base revision of an import computed inside
    // the import batch.
    `CREATE TABLE IF NOT EXISTS kb_meta (key TEXT PRIMARY KEY NOT NULL, value)`,
  ],
];

/** Version the code expects (number of {@link SCHEMA_STEPS}). */
export const SCHEMA_VERSION = SCHEMA_STEPS.length;

const BOOTSTRAP = [
  `CREATE TABLE IF NOT EXISTS kb_schema (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL
  )`,
  `INSERT OR IGNORE INTO kb_schema (id, version) VALUES (1, 0)`,
];

/**
 * Brings `db` to {@link SCHEMA_VERSION}: one batch to create the version table and read
 * the version, plus one batch with the missing steps and the version bump (only on the
 * first use of a database or after an upgrade). Safe under concurrent calls.
 */
export async function ensureSchema(db: D1Database): Promise<void> {
  const results = await db.batch<{ version: number }>([
    ...BOOTSTRAP.map((sql) => db.prepare(sql)),
    db.prepare("SELECT version FROM kb_schema WHERE id = 1"),
  ]);
  const version = results.at(-1)?.results[0]?.version;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new Error("kb_schema has no valid version row");
  }
  if (version >= SCHEMA_VERSION) {
    if (version > SCHEMA_VERSION) {
      // A newer deployment upgraded the database and was rolled back. Steps only add
      // things, so the older code keeps working with what it knows.
      logWarn(
        `D1 schema version ${String(version)} is newer than this worker (${String(SCHEMA_VERSION)})`,
      );
    }
    return;
  }
  const statements = SCHEMA_STEPS.slice(version).flatMap((step) =>
    step.map((sql) => db.prepare(sql)),
  );
  statements.push(
    db
      .prepare(
        "UPDATE kb_schema SET version = ?1 WHERE id = 1 AND version < ?1",
      )
      .bind(SCHEMA_VERSION),
  );
  await db.batch(statements);
}

/**
 * Remembers per database (binding object) that {@link ensureSchema} succeeded, so it
 * runs once per isolate. A failed run is not remembered, and {@link SchemaGate.forget}
 * lets a caller force a re-check after a query error (e.g. a restored database).
 */
export class SchemaGate {
  private readonly ready = new WeakMap<D1Database, Promise<void>>();

  async ensure(db: D1Database): Promise<void> {
    const known = this.ready.get(db);
    if (known !== undefined) {
      await known;
      return;
    }
    const pending = ensureSchema(db);
    this.ready.set(db, pending);
    try {
      await pending;
    } catch (error) {
      if (this.ready.get(db) === pending) {
        this.ready.delete(db);
      }
      throw error;
    }
  }

  forget(db: D1Database): void {
    this.ready.delete(db);
  }

  /** Ensures the schema, then runs `op`; a D1 error re-checks the schema next time. */
  async run<T>(db: D1Database, op: () => Promise<T>): Promise<T> {
    await this.ensure(db);
    try {
      return await op();
    } catch (error) {
      this.forget(db);
      throw error;
    }
  }
}
