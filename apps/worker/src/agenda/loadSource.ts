import {
  type AppConfig,
  calendarSecretName,
  type CalendarSource,
  FEED_TIMEOUT_MS,
  FLIGHT_MARGIN_MS,
} from "@kidboard/shared";

import { sha256Hex } from "../config/loadConfig";
import type { Env } from "../env";
import { FeedFetchError, fetchFeed } from "../feeds/fetchFeed";
import {
  DeadlineError,
  FlightPausedError,
  type SingleFlight,
} from "../feeds/flight";
import {
  getSourceEntry,
  putSourceEntry,
  SOURCE_ENTRY_VERSION,
  type SourceEntry,
  sourceKey,
  type SourceStore,
  type StoreBackend,
} from "../feeds/sourceStore";
import { errorName } from "../http/errors";
import { FeedParseError } from "../ical/errors";
import { expandCalendar, type ExpandWarning } from "../ical/expandCalendar";
import { logError, logWarn } from "../log";
import { normalize } from "../normalize/normalize";

/** After a failed feed load the source is not fetched again for 5 minutes (per isolate). */
export const FEED_RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

export type SourceResult =
  | { id: string; status: "ok" | "stale"; entry: SourceEntry }
  | { id: string; status: "error" };

export interface LoadSourceContext {
  env: Env;
  config: AppConfig;
  configHash: string;
  /** Cached window `[from, to)`, `YYYY-MM-DD` in the config zone. */
  window: { from: string; to: string };
  nowMs: number;
  freshTtlSeconds: number;
  store: SourceStore;
  backend: StoreBackend;
  /** Upstream loads of this isolate by source key and window (single flight, failure pause). */
  flights: SingleFlight<SourceEntry>;
  /** Keeps background work (cache writes) alive after the response. */
  defer: (work: Promise<unknown>) => void;
  fetchTimeoutMs?: number;
  fetchMaxBytes?: number;
}

/**
 * Resolves the secret URL. `webcal://` (as offered by some calendar apps) is mapped to
 * `https://`. Returns null for anything that is not an https URL: the address is the
 * calendar's password and must not travel unencrypted.
 */
function resolveFeedUrl(raw: string): string | null {
  const value = raw.trim().replace(/^webcal:\/\//i, "https://");
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Fresh = written by this version of the normalizer, expanded for the current window
 * and younger than the TTL. Entries of an older version are last-good only.
 */
function isFresh(entry: SourceEntry, ctx: LoadSourceContext): boolean {
  return (
    entry.v === SOURCE_ENTRY_VERSION &&
    entry.window.from === ctx.window.from &&
    entry.window.to === ctx.window.to &&
    ctx.nowMs - Date.parse(entry.fetchedAt) < ctx.freshTtlSeconds * 1000
  );
}

function describeFailure(error: unknown): string {
  if (error instanceof FeedFetchError) {
    return error.status === undefined
      ? error.reason
      : `${error.reason} ${String(error.status)}`;
  }
  if (error instanceof FeedParseError) {
    return `parse-${error.reason}`;
  }
  if (error instanceof DeadlineError) {
    return "timeout";
  }
  if (error instanceof FlightPausedError) {
    return "paused after an earlier failure";
  }
  // Unexpected error: log its type only (messages may quote feed content).
  return `internal ${errorName(error)}`;
}

function summarizeWarnings(warnings: readonly ExpandWarning[]): string {
  const counts = new Map<string, number>();
  for (const w of warnings) {
    counts.set(w.code, (counts.get(w.code) ?? 0) + 1);
  }
  return [...counts].map(([code, n]) => `${code} x${String(n)}`).join(", ");
}

async function fetchAndNormalize(
  source: CalendarSource,
  url: string,
  ctx: LoadSourceContext,
): Promise<SourceEntry> {
  const ics = await fetchFeed(url, {
    ...(ctx.fetchTimeoutMs === undefined
      ? {}
      : { timeoutMs: ctx.fetchTimeoutMs }),
    ...(ctx.fetchMaxBytes === undefined ? {} : { maxBytes: ctx.fetchMaxBytes }),
  });
  const expanded = expandCalendar(ics, {
    from: ctx.window.from,
    to: ctx.window.to,
    timeZone: ctx.config.timeZone,
  });
  if (expanded.warnings.length > 0) {
    logWarn(
      `source "${source.id}": ${summarizeWarnings(expanded.warnings)}${expanded.truncated ? " (truncated)" : ""}`,
    );
  }
  const { events, meals, truncated } = normalize(
    expanded.occurrences,
    source,
    ctx.config,
    {
      from: ctx.window.from,
      to: ctx.window.to,
    },
  );
  return {
    v: SOURCE_ENTRY_VERSION,
    sourceId: source.id,
    fetchedAt: new Date(ctx.nowMs).toISOString(),
    window: { ...ctx.window },
    truncated: expanded.truncated || truncated,
    events,
    meals,
  };
}

/**
 * Loads one source: fresh entry (same window, younger than the TTL) → upstream (fetch,
 * expand, normalize; then stored) → the older entry as last-good (`stale`) → `error`.
 *
 * The secret URL is only passed to `fetch` and hashed into the cache key; it never
 * appears in results, logs or error messages.
 */
export async function loadSource(
  source: CalendarSource,
  ctx: LoadSourceContext,
): Promise<SourceResult> {
  const secretName = calendarSecretName(source.id);
  const raw = ctx.env[secretName];
  if (raw === undefined || raw.trim() === "") {
    logError(`source "${source.id}": secret ${secretName} is not set`);
    return { id: source.id, status: "error" };
  }
  const url = resolveFeedUrl(raw);
  if (url === null) {
    logError(`source "${source.id}": secret ${secretName} is not an https URL`);
    return { id: source.id, status: "error" };
  }

  // The URL takes part in the key so that pointing a source at another calendar
  // invalidates its cache; only its hash is used.
  const hash = (
    await sha256Hex(`${ctx.configHash}\n${source.id}\n${url}`)
  ).slice(0, 32);
  const key = sourceKey(source.id, hash);
  const cached = await getSourceEntry(ctx.store, ctx.backend, key, ctx.nowMs);
  if (cached !== null && isFresh(cached, ctx)) {
    return { id: source.id, status: "ok", entry: cached };
  }

  // Single flight per isolate: concurrent requests share one upstream load; after a
  // failure the source is not asked again for FEED_RETRY_AFTER_FAILURE_MS.
  try {
    const entry = await ctx.flights.run(`${key}@${ctx.window.from}`, {
      nowMs: ctx.nowMs,
      maxMs: (ctx.fetchTimeoutMs ?? FEED_TIMEOUT_MS) + FLIGHT_MARGIN_MS,
      defer: ctx.defer,
      load: async () => {
        const fresh = await fetchAndNormalize(source, url, ctx);
        ctx.defer(
          putSourceEntry(ctx.store, ctx.backend, key, fresh).catch(() => {
            logWarn(
              `source "${source.id}": ${ctx.backend.kind} cache write failed`,
            );
          }),
        );
        return fresh;
      },
    });
    return { id: source.id, status: "ok", entry };
  } catch (error) {
    logWarn(
      `source "${source.id}": upstream failed (${describeFailure(error)}), ${cached === null ? "no last-good data" : "serving last-good data"}`,
    );
    return cached === null
      ? { id: source.id, status: "error" }
      : { id: source.id, status: "stale", entry: cached };
  }
}
