import { PARENT_LOCKOUT_SECONDS } from "@kidboard/shared";

import { logWarn } from "../log";

/**
 * ADR-0013: 5 wrong PINs within 15 minutes lock the unlock route. The first lockout
 * lasts {@link PARENT_LOCKOUT_SECONDS}; every further lockout without a right PIN in between
 * doubles it (15 min, 30, 60, 120 up to {@link MAX_LOCKOUT_SECONDS}), so guessing a PIN
 * through the lockout never gets cheaper than a few hundred tries per year.
 */
export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_SECONDS = 15 * 60;
export const MAX_LOCKOUT_SECONDS = 2 * 60 * 60;

/**
 * `kb_meta` keys: one row per attempt (→ epoch seconds of the attempt), reserved as
 * `parent_fail:<uuid>` before the PIN is compared; a wrong PIN renames it to
 * `parent_fail:s:<uuid>` (settled failure), a right PIN deletes it together with every
 * settled failure. Plus the end of an active lockout (`parent_lock_until` → epoch
 * seconds) and the number of lockouts since the last right PIN (`parent_lock_level`).
 * All attempt keys lie in the key range `(FAIL_PREFIX, FAIL_END)` and the settled ones
 * in `(SETTLED_PREFIX, SETTLED_END)` (a UUID never starts with `s`), so the primary key
 * index serves the scans.
 */
const FAIL_PREFIX = "parent_fail:";
const FAIL_END = "parent_fail;";
const SETTLED_PREFIX = "parent_fail:s:";
const SETTLED_END = "parent_fail:s;";
const LOCK_KEY = "parent_lock_until";
const LEVEL_KEY = "parent_lock_level";
/** Attempt rows inside the window; binds ?1 = FAIL_PREFIX, ?2 = FAIL_END, ?3 = window start. */
const IN_WINDOW = "key > ?1 AND key < ?2 AND value > ?3";

export interface Refused {
  ok: false;
  retryAfterSeconds: number;
}

/** A reserved attempt: settle it with `fail` or `release` once the PIN is compared. */
export interface Reservation {
  ok: true;
  id: string;
}

export type FailureOutcome =
  | { locked: false; attemptsLeft: number }
  | { locked: true; retryAfterSeconds: number };

function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/*
 * Unlock attempt limiter (ADR-0013); D1 is the only state, so it holds across isolates.
 * An attempt is *reserved* before the PIN is compared, atomically against the limit
 * (one batch whose conditional insert is the check), so parallel requests cannot test
 * more than MAX_FAILURES PINs per window. A wrong PIN keeps the reservation as a
 * settled failure and starts the lockout once the window holds MAX_FAILURES; a right
 * PIN deletes it, clears the settled failures of the window (the parent typed the PIN;
 * earlier typos no longer count) and resets the escalation. Reservations of attempts
 * still being compared stay counted, so even next to a right PIN no more than
 * MAX_FAILURES PINs are being compared at once.
 */

/**
 * Reserves a new attempt: drops attempts older than the window, inserts the attempt
 * row only if no lockout is active and the window holds fewer than
 * {@link MAX_FAILURES} rows, and reads back whether it was inserted.
 */
export async function reserveAttempt(
  db: D1Database,
  nowSeconds: number,
): Promise<Reservation | Refused> {
  const windowStart = nowSeconds - FAILURE_WINDOW_SECONDS;
  const id = crypto.randomUUID();
  const key = FAIL_PREFIX + id;
  const results = await db.batch<{ value: unknown }>([
    db
      .prepare(
        "DELETE FROM kb_meta WHERE key > ?1 AND key < ?2 AND value <= ?3",
      )
      .bind(FAIL_PREFIX, FAIL_END, windowStart),
    db
      .prepare(
        `INSERT INTO kb_meta (key, value)
         SELECT ?4, ?5
         WHERE NOT EXISTS (SELECT 1 FROM kb_meta WHERE key = ?6 AND value > ?5)
           AND (SELECT COUNT(*) FROM kb_meta WHERE ${IN_WINDOW}) < ?7`,
      )
      .bind(
        FAIL_PREFIX,
        FAIL_END,
        windowStart,
        key,
        nowSeconds,
        LOCK_KEY,
        MAX_FAILURES,
      ),
    db
      .prepare("SELECT COUNT(*) AS value FROM kb_meta WHERE key = ?1")
      .bind(key),
    db.prepare("SELECT value FROM kb_meta WHERE key = ?1").bind(LOCK_KEY),
    db
      .prepare(`SELECT MIN(value) AS value FROM kb_meta WHERE ${IN_WINDOW}`)
      .bind(FAIL_PREFIX, FAIL_END, windowStart),
  ]);
  if (asNumber(results[2]?.results[0]?.value) === 1) {
    return { ok: true, id };
  }
  const lockedUntil = asNumber(results[3]?.results[0]?.value) ?? 0;
  const oldest = asNumber(results[4]?.results[0]?.value);
  const retryAt =
    lockedUntil > nowSeconds
      ? lockedUntil
      : (oldest ?? nowSeconds) + FAILURE_WINDOW_SECONDS;
  return { ok: false, retryAfterSeconds: Math.max(1, retryAt - nowSeconds) };
}

/**
 * The reserved attempt was a wrong PIN: it stays counted; once the window holds
 * {@link MAX_FAILURES} attempts and no lockout is active, the lockout starts and its
 * level rises (duration {@link PARENT_LOCKOUT_SECONDS} doubled per earlier lockout, at most
 * {@link MAX_LOCKOUT_SECONDS}). Both conditional inserts test the same state, and the
 * batch is one transaction, so parallel failures escalate once.
 *
 * The lock condition counts every attempt in the window, including reservations of
 * parallel requests whose PIN is still being compared, not only settled failures.
 * Deliberate: it errs on the closed side and differs only while attempts run in
 * parallel, which one family tablet does not produce (a parent types one PIN at a
 * time). The settle write (rename to the settled key range) only decides what a
 * later right PIN clears.
 */
export async function recordFailure(
  db: D1Database,
  reservation: Reservation,
  nowSeconds: number,
): Promise<FailureOutcome> {
  const windowStart = nowSeconds - FAILURE_WINDOW_SECONDS;
  const mustLock = `(SELECT COUNT(*) FROM kb_meta WHERE ${IN_WINDOW}) >= ?6
         AND NOT EXISTS (SELECT 1 FROM kb_meta WHERE key = ?4 AND value > ?5)`;
  const results = await db.batch<{ value: unknown }>([
    // Settle the reservation: it stays counted, now as a failure a right PIN clears.
    db
      .prepare("UPDATE kb_meta SET key = ?1 WHERE key = ?2")
      .bind(SETTLED_PREFIX + reservation.id, FAIL_PREFIX + reservation.id),
    // Raise the level first; the lock below is sized from the raised level.
    db
      .prepare(
        `INSERT INTO kb_meta (key, value)
         SELECT ?7, 1
         WHERE ${mustLock}
         ON CONFLICT (key) DO UPDATE SET value = value + 1`,
      )
      .bind(
        FAIL_PREFIX,
        FAIL_END,
        windowStart,
        LOCK_KEY,
        nowSeconds,
        MAX_FAILURES,
        LEVEL_KEY,
      ),
    db
      .prepare(
        `INSERT INTO kb_meta (key, value)
         SELECT ?4, ?5 + MIN(?8 * (1 << MIN(MAX(
           (SELECT value FROM kb_meta WHERE key = ?7) - 1, 0), 20)), ?9)
         WHERE ${mustLock}
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      )
      .bind(
        FAIL_PREFIX,
        FAIL_END,
        windowStart,
        LOCK_KEY,
        nowSeconds,
        MAX_FAILURES,
        LEVEL_KEY,
        PARENT_LOCKOUT_SECONDS,
        MAX_LOCKOUT_SECONDS,
      ),
    db
      .prepare(`SELECT COUNT(*) AS value FROM kb_meta WHERE ${IN_WINDOW}`)
      .bind(FAIL_PREFIX, FAIL_END, windowStart),
    db.prepare("SELECT value FROM kb_meta WHERE key = ?1").bind(LOCK_KEY),
  ]);
  const count = asNumber(results[3]?.results[0]?.value) ?? 0;
  const lockedUntil = asNumber(results[4]?.results[0]?.value) ?? 0;
  if (lockedUntil > nowSeconds) {
    logWarn("parent unlock locked after repeated wrong PINs");
    return { locked: true, retryAfterSeconds: lockedUntil - nowSeconds };
  }
  return { locked: false, attemptsLeft: Math.max(0, MAX_FAILURES - count) };
}

/**
 * The reserved attempt was the right PIN: forget it, every settled failure and the
 * lockout level (one delete). Reservations of parallel attempts whose PIN is still
 * being compared stay counted (they settle on their own). An active lockout is
 * untouched: while it runs no PIN is compared at all.
 */
export async function clearFailures(
  db: D1Database,
  reservation: Reservation,
): Promise<void> {
  await db
    .prepare(
      "DELETE FROM kb_meta WHERE key = ?1 OR key = ?4 OR (key > ?2 AND key < ?3)",
    )
    .bind(FAIL_PREFIX + reservation.id, SETTLED_PREFIX, SETTLED_END, LEVEL_KEY)
    .run();
}
