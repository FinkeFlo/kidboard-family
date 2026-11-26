import {
  APP_EVENTS_SOURCE_ID,
  APP_MEALS_SOURCE_ID,
  type AppConfig,
  type CalendarSource,
  type EditorKind,
} from "@kidboard/shared";

import { sha256Hex } from "../config/loadConfig";
import { type AppEntry, EntryStore } from "../entries/entryStore";
import { renderAppCalendar } from "../entries/renderCalendar";
import type { SchemaGate } from "../entries/schema";
import { STAMP_KEY } from "../entries/stamp";
import { withDeadline } from "../feeds/flight";
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
import { expandCalendar } from "../ical/expandCalendar";
import { logWarn } from "../log";
import { normalize } from "../normalize/normalize";
import type { SourceResult } from "./loadSource";

/**
 * The two virtual sources of app entries (ADR-0014), listed after the configured
 * calendars. They have no child of their own: children come from the titles.
 */
export const APP_SOURCES: readonly (CalendarSource & {
  entryKind: EditorKind;
})[] = [
  { id: APP_EVENTS_SOURCE_ID, kind: "events", entryKind: "event" },
  { id: APP_MEALS_SOURCE_ID, kind: "meals", entryKind: "meal" },
];

/** What both the board read and the invalidation need. */
export interface AppSourceCacheContext {
  db: D1Database;
  /** Schema memo of the isolate (shared with the entry store of the write routes). */
  gate: SchemaGate;
  configHash: string;
  store: SourceStore;
  backend: StoreBackend;
}

export interface AppSourcesContext extends AppSourceCacheContext {
  config: AppConfig;
  /** Cached window `[from, to)`, `YYYY-MM-DD` in the config zone. */
  window: { from: string; to: string };
  nowMs: number;
  freshTtlSeconds: number;
  /**
   * Deadline (ms) for the D1 reads of one request (stamp and, if needed, the entry
   * list): a hanging database must never delay `/api/agenda`. Past it the request
   * serves the last good data (`stale`) or `error`, like any other D1 failure.
   */
  d1TimeoutMs: number;
  /** Keeps background work (cache writes) alive after the response. */
  defer: (work: Promise<unknown>) => void;
}

/** Cache key of a virtual source (changes with the config, like a feed's key). */
async function appSourceKey(
  sourceId: string,
  configHash: string,
): Promise<string> {
  const hash = (await sha256Hex(`${configHash}\napp\n${sourceId}`)).slice(
    0,
    32,
  );
  return sourceKey(sourceId, hash);
}

/**
 * The current change stamp of the app entries ("" before the first write). It is a
 * random value the entry store replaces in the same D1 batch as every write
 * (`../entries/stamp.ts`), so every isolate notices a committed write with one
 * primary-key read, whatever its memory layer holds (D1 is strongly consistent; KV
 * deletes are not).
 */
async function readStamp(ctx: AppSourceCacheContext): Promise<string> {
  return ctx.gate.run(ctx.db, async () => {
    const value = await ctx.db
      .prepare("SELECT value FROM kb_meta WHERE key = ?")
      .bind(STAMP_KEY)
      .first("value");
    return typeof value === "string" ? value : "";
  });
}

function isFresh(
  entry: SourceEntry,
  stamp: string,
  ctx: AppSourcesContext,
): boolean {
  return (
    entry.v === SOURCE_ENTRY_VERSION &&
    entry.stamp === stamp &&
    entry.window.from === ctx.window.from &&
    entry.window.to === ctx.window.to &&
    ctx.nowMs - Date.parse(entry.fetchedAt) < ctx.freshTtlSeconds * 1000
  );
}

function build(
  source: (typeof APP_SOURCES)[number],
  entries: readonly AppEntry[],
  stamp: string,
  ctx: AppSourcesContext,
): SourceEntry {
  const ics = renderAppCalendar(entries, source.entryKind, ctx.config);
  const expanded = expandCalendar(ics, {
    from: ctx.window.from,
    to: ctx.window.to,
    timeZone: ctx.config.timeZone,
  });
  if (expanded.warnings.length > 0) {
    logWarn(
      `source "${source.id}": ${String(expanded.warnings.length)} expansion warnings${expanded.truncated ? " (truncated)" : ""}`,
    );
  }
  const { events, meals, truncated } = normalize(
    expanded.occurrences,
    source,
    ctx.config,
    ctx.window,
  );
  return {
    v: SOURCE_ENTRY_VERSION,
    sourceId: source.id,
    fetchedAt: new Date(ctx.nowMs).toISOString(),
    window: { ...ctx.window },
    truncated: expanded.truncated || truncated,
    stamp,
    events,
    meals,
  };
}

/**
 * Loads the virtual sources `app-events` and `app-meals` (ADR-0014). Per request: one
 * read of the change stamp; a cached entry with that stamp, the current window and
 * version, younger than the TTL, is served as is; otherwise the entries are listed
 * from D1 once for both, rendered as an iCalendar (`renderAppCalendar`), expanded and
 * normalized like a feed, and cached. D1 unavailable or slower than `d1TimeoutMs` (or a
 * render failure) → the last cached entry as `stale`, else `error`; the configured
 * calendars are not affected.
 * Entry text never reaches the log.
 */
export async function loadAppSources(
  ctx: AppSourcesContext,
): Promise<SourceResult[]> {
  const keys = await Promise.all(
    APP_SOURCES.map((source) => appSourceKey(source.id, ctx.configHash)),
  );
  const cached = await Promise.all(
    keys.map((key) => getSourceEntry(ctx.store, ctx.backend, key, ctx.nowMs)),
  );
  const fallback = (index: number): SourceResult => {
    const id = APP_SOURCES[index]?.id ?? "";
    const entry = cached[index] ?? null;
    return entry === null
      ? { id, status: "error" }
      : { id, status: "stale", entry };
  };

  let stamp: string;
  let entries: AppEntry[] | undefined;
  try {
    const read = async (): Promise<[string, AppEntry[] | undefined]> => {
      const current = await readStamp(ctx);
      if (
        cached.every((entry) => entry !== null && isFresh(entry, current, ctx))
      ) {
        return [current, undefined];
      }
      const listed = await new EntryStore(ctx.db, {
        config: ctx.config,
        gate: ctx.gate,
      }).list(ctx.window.from, ctx.window.to);
      return [current, listed];
    };
    // One deadline for both reads; a late result is dropped (nothing is written).
    [stamp, entries] = await withDeadline(read(), ctx.d1TimeoutMs);
  } catch (error) {
    logWarn(
      `app entries: D1 read failed (${errorName(error)}), ${cached.some((e) => e !== null) ? "serving last-good data" : "no last-good data"}`,
    );
    return APP_SOURCES.map((_, index) => fallback(index));
  }

  return APP_SOURCES.map((source, index): SourceResult => {
    const hit = cached[index] ?? null;
    if (hit !== null && isFresh(hit, stamp, ctx)) {
      return { id: source.id, status: "ok", entry: hit };
    }
    let entry: SourceEntry;
    try {
      entry = build(source, entries ?? [], stamp, ctx);
    } catch (error) {
      logWarn(
        `source "${source.id}": rendering app entries failed (${errorName(error)})`,
      );
      return fallback(index);
    }
    const key = keys[index];
    if (key !== undefined) {
      ctx.defer(
        putSourceEntry(ctx.store, ctx.backend, key, entry).catch(() => {
          logWarn(
            `source "${source.id}": ${ctx.backend.kind} cache write failed`,
          );
        }),
      );
    }
    return { id: source.id, status: "ok", entry };
  });
}

/**
 * Drops the cached entries of both virtual sources from this isolate's memory and from
 * KV or the Cache API; the editor's write routes (T-43) call it after every successful
 * write. Correctness does not depend on it: the write's own batch already replaced the
 * D1 change stamp, so every isolate treats its cached entries as outdated anyway; this
 * only frees the outdated copies. Never rejects: failures are logged.
 */
export async function invalidateAppSources(
  ctx: Pick<AppSourceCacheContext, "configHash" | "store" | "backend">,
): Promise<void> {
  const keys = await Promise.all(
    APP_SOURCES.map((source) => appSourceKey(source.id, ctx.configHash)),
  );
  const deletes = await Promise.allSettled(
    keys.map((key) => ctx.store.delete(ctx.backend, key)),
  );
  if (deletes.some((result) => result.status === "rejected")) {
    logWarn(`app entries: ${ctx.backend.kind} cache delete failed`);
  }
}
