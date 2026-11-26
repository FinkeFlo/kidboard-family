/**
 * Constants of the HTTP protocol between the board app and the worker, defined once so
 * both sides cannot drift apart.
 */

/** Header that carries the parent session token (ADR-0013). */
export const PARENT_SESSION_HEADER = "X-KidBoard-Parent";

/** Length of the first parent lockout (ADR-0013); repeated lockouts double it. */
export const PARENT_LOCKOUT_SECONDS = 15 * 60;

/**
 * Maximum `days` of `/api/agenda` and the editor list: 31 = today plus the 30 days the
 * countdown looks ahead (T-19), so day, week and countdown share one request. A 31-day
 * range fits the worker's cached window for every `from` from `today - 1` to
 * `today + 1` (a client clock up to a day off around midnight still gets an answer);
 * further out it is a 400.
 */
export const MAX_AGENDA_DAYS = 31;

/** Timeout of one upstream calendar feed fetch of the worker. */
export const FEED_TIMEOUT_MS = 10_000;

/** Slack on top of an upstream timeout for the work around it (expansion, writes). */
export const FLIGHT_MARGIN_MS = 1000;

/**
 * Worst-case time the worker needs for `/api/agenda` before it answers with last-good
 * data or 502: the feed timeout plus the flight margin. Sources load in parallel.
 */
export const WORKER_UPSTREAM_BUDGET_MS = FEED_TIMEOUT_MS + FLIGHT_MARGIN_MS;

/** ADR-0014: at most 1 000 app entries per deployment. */
export const MAX_APP_ENTRIES = 1000;

/**
 * Window of days the worker caches and serves, relative to today in the configured
 * zone: `[today - WINDOW_DAYS_BEFORE, today + WINDOW_DAYS_AFTER)`. Expansion runs once
 * per window and TTL; a requested range must lie inside it (else 400).
 */
export const WINDOW_DAYS_BEFORE = 1;
export const WINDOW_DAYS_AFTER = 32;

/** Templates of the editor look this many days back and ahead of today. */
export const EDITOR_TEMPLATE_DAYS_BEFORE = 8 * 7;
export const EDITOR_TEMPLATE_DAYS_AFTER = 4 * 7;
