/**
 * Change stamp of the app entries (ADR-0014): a `kb_meta` row whose value is replaced
 * by a random UUID in the same `db.batch` as every write of the entry store (create,
 * update, override, exception, remove, import). A batch is one transaction, so a
 * committed write always comes with a new stamp and every isolate notices it with one
 * primary-key read (`loadAppSources`), whatever its cache layers hold. Random rather
 * than a counter: a database restored to an earlier point can never repeat a stamp
 * with other data.
 */
export const STAMP_KEY = "entries_stamp";

/**
 * The statement that replaces the change stamp; add it to the write's batch. It is
 * unconditional: a write the batch refuses (revision conflict, limit) bumps it too,
 * which costs one cache rebuild and can never leave a stale board.
 */
export function bumpStamp(db: D1Database): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO kb_meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = ?2",
    )
    .bind(STAMP_KEY, crypto.randomUUID());
}
