import {
  CalendarEventSchema,
  DateStringSchema,
  DateTimeStringSchema,
  MealSchema,
} from "@kidboard/shared";
import { z } from "zod";

/**
 * Version of the normalized data in an entry. Bumped whenever `normalize` emits new
 * fields, so entries written by an older deploy are never served as *fresh* (they lack
 * the new fields) but stay usable as last-good. 2: events carry `bring` (T-33).
 */
export const SOURCE_ENTRY_VERSION = 2;

/** Normalized data of one source for a fixed window (what the caches hold). */
export const SourceEntrySchema = z.object({
  /** {@link SOURCE_ENTRY_VERSION} of the deploy that wrote it; older versions are last-good only. */
  v: z.union([z.literal(1), z.literal(SOURCE_ENTRY_VERSION)]),
  sourceId: z.string().min(1),
  fetchedAt: DateTimeStringSchema,
  /** `[from, to)` the data was expanded for, `YYYY-MM-DD` in the config zone. */
  window: z.object({ from: DateStringSchema, to: DateStringSchema }),
  truncated: z.boolean(),
  /**
   * Virtual sources of app entries only: the D1 change stamp the data was read at
   * (`agenda/appSources.ts`); a different current stamp makes the entry not fresh.
   */
  stamp: z.string().optional(),
  events: z.array(CalendarEventSchema),
  meals: z.array(MealSchema),
});
export type SourceEntry = z.infer<typeof SourceEntrySchema>;

/** ADR-0006: an entry is kept (and usable as last-good) for 7 days. */
export const LAST_GOOD_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Default max entries in the per-isolate memory layer (one per source). */
const DEFAULT_MEMORY_LIMIT = 64;

/**
 * Logical key of a source's entry. One entry per source serves both roles: it is
 * *fresh* while younger than the TTL, expanded for the current window and of the current
 * {@link SOURCE_ENTRY_VERSION}, and *last-good* for 7 days (one write per refresh, which
 * matters for KV's write quota). The key does not carry the entry version, so a new deploy
 * still finds the old entry as last-good and overwrites it on the next refresh.
 */
export function sourceKey(sourceId: string, hash: string): string {
  return `v1/source/${sourceId}/${hash}`;
}

/** Persistent layer behind the memory map. */
export interface StoreBackend {
  readonly kind: "kv" | "cache";
  /** Raw JSON text under `key`, or null. */
  read(key: string): Promise<string | null>;
  write(key: string, json: string, ttlSeconds: number): Promise<void>;
  /** Removes `key` (a missing key is not an error). */
  delete(key: string): Promise<void>;
}

/** Workers KV (`KIDBOARD_CACHE` binding): global, survives isolates, works on workers.dev. */
export function kvBackend(namespace: KVNamespace): StoreBackend {
  return {
    kind: "kv",
    read: (key) => namespace.get(key, "text"),
    write: (key, json, ttlSeconds) =>
      // KV requires expirationTtl >= 60 s.
      namespace.put(key, json, { expirationTtl: Math.max(60, ttlSeconds) }),
    delete: (key) => namespace.delete(key),
  };
}

/** Host of the synthetic Cache API keys; never fetched (`.invalid` is reserved, RFC 2606). */
const CACHE_KEY_ORIGIN = "https://cache.kidboard.invalid";

/**
 * Workers Cache API fallback (per data center; functional only on custom domains, a
 * no-op e.g. on `*.workers.dev`).
 */
export function cacheBackend(openCache: () => Promise<Cache>): StoreBackend {
  return {
    kind: "cache",
    read: async (key) => {
      const cache = await openCache();
      const response = await cache.match(`${CACHE_KEY_ORIGIN}/${key}`);
      return response === undefined ? null : response.text();
    },
    write: async (key, json, ttlSeconds) => {
      const cache = await openCache();
      await cache.put(
        `${CACHE_KEY_ORIGIN}/${key}`,
        new Response(json, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `max-age=${String(ttlSeconds)}`,
          },
        }),
      );
    },
    delete: async (key) => {
      const cache = await openCache();
      await cache.delete(`${CACHE_KEY_ORIGIN}/${key}`);
    },
  };
}

interface MemoryItem {
  entry: unknown;
  expiresAtMs: number;
}

/**
 * Cache of validated entries (feed sources, weather): a small per-isolate memory map in
 * front of a persistent {@link StoreBackend} (KV when bound, else the Cache API;
 * ADR-0006). Entries are checked against their zod schema on read and expire at the
 * time `expiresAtMs` computes from them, additionally enforced by the backend's TTL.
 * Keys must not be shared between schemas (they carry a type prefix such as
 * `v1/source/...`).
 */
export class SourceStore {
  readonly #memory = new Map<string, MemoryItem>();
  readonly #memoryLimit: number;

  constructor(memoryLimit = DEFAULT_MEMORY_LIMIT) {
    this.#memoryLimit = memoryLimit;
  }

  /** The entry under `key` if it is valid and not expired at `nowMs`, else `null`. */
  async get<T>(
    backend: StoreBackend,
    key: string,
    schema: z.ZodType<T>,
    expiresAtMs: (entry: T) => number,
    nowMs: number,
  ): Promise<T | null> {
    const item = this.#memory.get(key);
    if (item !== undefined) {
      if (item.expiresAtMs > nowMs) {
        return item.entry as T;
      }
      this.#memory.delete(key);
    }
    try {
      const text = await backend.read(key);
      if (text === null) {
        return null;
      }
      const parsed = schema.safeParse(JSON.parse(text));
      if (!parsed.success || expiresAtMs(parsed.data) <= nowMs) {
        return null;
      }
      this.#remember(key, parsed.data, expiresAtMs(parsed.data));
      return parsed.data;
    } catch {
      // Unreadable entry or backend failure: treat as a miss.
      return null;
    }
  }

  /** Stores `entry` in memory immediately and in the backend for `ttlSeconds`. */
  async put(
    backend: StoreBackend,
    key: string,
    entry: unknown,
    expiresAtMs: number,
    ttlSeconds: number,
  ): Promise<void> {
    this.#remember(key, entry, expiresAtMs);
    await backend.write(key, JSON.stringify(entry), ttlSeconds);
  }

  /**
   * Drops the entry under `key` from memory at once and from the backend (KV deletes
   * may take up to a minute to reach other locations).
   */
  async delete(backend: StoreBackend, key: string): Promise<void> {
    this.#memory.delete(key);
    await backend.delete(key);
  }

  #remember(key: string, entry: unknown, expiresAtMs: number): void {
    this.#memory.delete(key);
    if (this.#memory.size >= this.#memoryLimit) {
      const oldest = this.#memory.keys().next();
      if (oldest.done !== true) {
        this.#memory.delete(oldest.value);
      }
    }
    this.#memory.set(key, { entry, expiresAtMs });
  }
}

function sourceExpiresAtMs(entry: SourceEntry): number {
  return Date.parse(entry.fetchedAt) + LAST_GOOD_TTL_SECONDS * 1000;
}

/** The {@link SourceEntry} under `key` if younger than 7 days at `nowMs`. */
export function getSourceEntry(
  store: SourceStore,
  backend: StoreBackend,
  key: string,
  nowMs: number,
): Promise<SourceEntry | null> {
  return store.get(backend, key, SourceEntrySchema, sourceExpiresAtMs, nowMs);
}

/** Stores a {@link SourceEntry} for 7 days (last-good, ADR-0006). */
export function putSourceEntry(
  store: SourceStore,
  backend: StoreBackend,
  key: string,
  entry: SourceEntry,
): Promise<void> {
  return store.put(
    backend,
    key,
    entry,
    sourceExpiresAtMs(entry),
    LAST_GOOD_TTL_SECONDS,
  );
}
