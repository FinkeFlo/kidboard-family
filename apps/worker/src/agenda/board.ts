import {
  addCalendarDays,
  type AppConfig,
  DateStringSchema,
  MAX_AGENDA_DAYS,
  parseCalendarDate,
  todayInZone,
  WINDOW_DAYS_AFTER,
  WINDOW_DAYS_BEFORE,
} from "@kidboard/shared";
import type { Context } from "hono";
import { z } from "zod";

import { loadConfig } from "../config/loadConfig";
import { SchemaGate } from "../entries/schema";
import type { AppEnv, Env } from "../env";
import { SingleFlight } from "../feeds/flight";
import {
  cacheBackend,
  kvBackend,
  type SourceEntry,
  SourceStore,
  type StoreBackend,
} from "../feeds/sourceStore";
import { logWarn } from "../log";
import { editorEnabled } from "../parent/pin";
import { WEATHER_KV_WRITES_PER_DAY } from "../weather/budget";
import {
  APP_SOURCES,
  invalidateAppSources,
  loadAppSources,
} from "./appSources";
import {
  FEED_RETRY_AFTER_FAILURE_MS,
  loadSource,
  type SourceResult,
} from "./loadSource";

/** Default `days` of `/api/agenda`. */
export const DEFAULT_DAYS = 8;
export const DEFAULT_CACHE_TTL_SECONDS = 3600;
const MIN_CACHE_TTL_SECONDS = 60;
const MAX_CACHE_TTL_SECONDS = 86_400;
/**
 * Share of the Workers Free KV quota (1 000 writes/day) the source cache may use:
 * every refresh writes one key per source, so the TTL is raised to at least
 * `ceil(sources × 86 400 / 500)` seconds when KV is bound (leaves room for day
 * rollovers, concurrent refreshes in other data centers and other uses).
 */
export const KV_WRITES_PER_DAY_BUDGET = 500;

const QUERY_MESSAGES: Record<string, string> = {
  from: "from must be a valid date YYYY-MM-DD",
  days: `days must be an integer from 1 to ${String(MAX_AGENDA_DAYS)}`,
};

const RangeQuerySchema = z.object({
  from: z
    .string()
    .pipe(DateStringSchema)
    .refine((d) => parseCalendarDate(d) !== null)
    .optional(),
  days: z
    .string()
    .regex(/^\d{1,2}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(MAX_AGENDA_DAYS))
    .optional(),
});

export type RangeQuery = z.output<typeof RangeQuerySchema>;

/**
 * Parses `?from&days` of `/api/agenda` and `/api/parent/entries`; the message names
 * the offending parameter (never echoes its value).
 */
export function parseRangeQuery(
  value: Record<string, string | string[]>,
): { ok: true; value: RangeQuery } | { ok: false; message: string } {
  const parsed = RangeQuerySchema.safeParse(value);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    return {
      ok: false,
      message: QUERY_MESSAGES[field] ?? "Invalid query parameters",
    };
  }
  return { ok: true, value: parsed.data };
}

/**
 * `[from, from + days)` of a request, checked against the cached window. `null` when
 * it does not fit (the caller answers 400 with {@link rangeMessage}).
 */
export function requestRange(
  query: RangeQuery,
  board: BoardContext,
): { from: string; to: string } | null {
  const from = query.from ?? board.today;
  const to = addCalendarDays(from, query.days ?? DEFAULT_DAYS);
  return from < board.window.from || to > board.window.to ? null : { from, to };
}

export function rangeMessage(board: BoardContext): string {
  return `from + days must lie between ${board.window.from} and ${board.window.to}`;
}

let ttlMemo: { raw: string | undefined; seconds: number } | undefined;

/** `KIDBOARD_CACHE_TTL` in seconds; invalid or out of range (60-86400) → default. */
export function cacheTtlSeconds(raw: string | undefined): number {
  if (ttlMemo === undefined || ttlMemo.raw !== raw) {
    let seconds = DEFAULT_CACHE_TTL_SECONDS;
    if (raw !== undefined && raw.trim() !== "") {
      const value = Number(raw.trim());
      if (
        Number.isInteger(value) &&
        value >= MIN_CACHE_TTL_SECONDS &&
        value <= MAX_CACHE_TTL_SECONDS
      ) {
        seconds = value;
      } else {
        logWarn(
          `KIDBOARD_CACHE_TTL must be an integer from ${String(MIN_CACHE_TTL_SECONDS)} to ${String(MAX_CACHE_TTL_SECONDS)}; using ${String(DEFAULT_CACHE_TTL_SECONDS)}`,
        );
      }
    }
    ttlMemo = { raw, seconds };
  }
  return ttlMemo.seconds;
}

let clampMemo: string | undefined;

/**
 * Fresh TTL actually used: with KV, at least the minimum that keeps the daily writes
 * within {@link KV_WRITES_PER_DAY_BUDGET} (logged once per value). `reservedWritesPerDay`
 * is the part of the budget other KV users take first (the weather forecast while it is
 * on, `WEATHER_KV_WRITES_PER_DAY`); the sources share the rest.
 */
export function effectiveTtlSeconds(
  configured: number,
  sourceCount: number,
  usesKv: boolean,
  reservedWritesPerDay = 0,
): number {
  if (!usesKv) {
    return configured;
  }
  const minimum = Math.ceil(
    (sourceCount * 86_400) / (KV_WRITES_PER_DAY_BUDGET - reservedWritesPerDay),
  );
  if (configured >= minimum) {
    return configured;
  }
  const memoKey = `${String(configured)}/${String(sourceCount)}/${String(reservedWritesPerDay)}`;
  if (clampMemo !== memoKey) {
    clampMemo = memoKey;
    logWarn(
      `KIDBOARD_CACHE_TTL ${String(configured)} s would exceed the KV write budget for ${String(sourceCount)} calendars; using ${String(minimum)} s`,
    );
  }
  return minimum;
}

let noSourcesMemo: string | undefined;

/**
 * Logs once per config (per isolate) that the board has nothing to show: no calendars
 * in `KIDBOARD_CONFIG` and the editor off (ADR-0014: app entries are the default source,
 * Google feeds are optional). The board then shows its normal empty state.
 */
function warnIfNoSources(
  config: AppConfig,
  configHash: string,
  editorOn: boolean,
): void {
  if (config.calendars.length > 0 || editorOn) {
    noSourcesMemo = undefined;
    return;
  }
  if (noSourcesMemo !== configHash) {
    noSourcesMemo = configHash;
    logWarn(
      "KIDBOARD_CONFIG lists no calendars and the editor is off (it needs KIDBOARD_PARENT_PIN, KIDBOARD_ACCESS_TOKEN and the D1 binding KIDBOARD_DATA); the board stays empty",
    );
  }
}

/** What the board needs of a request (any route env based on {@link AppEnv}). */
export type BoardRequest = Pick<Context<AppEnv>, "env" | "executionCtx">;

/** Everything one request needs to read the board's sources. */
export interface BoardContext {
  config: AppConfig;
  configHash: string;
  /** Today in the config zone. */
  today: string;
  /** Cached window `[today - 1, today + 32)`. */
  window: { from: string; to: string };
  nowMs: number;
  backend: StoreBackend;
  freshTtlSeconds: number;
  /** The entry database while the editor is on (ADR-0014), else `undefined`. */
  db: D1Database | undefined;
}

export interface BoardOptions {
  /** Clock (epoch ms). */
  now: () => number;
  /** Cache API cache used without a KV binding. */
  openCache: () => Promise<Cache>;
  fetchTimeoutMs?: number | undefined;
  fetchMaxBytes?: number | undefined;
  /** D1 deadline of the app sources on the agenda path (default {@link APP_SOURCES_D1_TIMEOUT_MS}). */
  d1TimeoutMs?: number | undefined;
}

/**
 * Board sources of one isolate (feeds and app entries), shared by `/api/agenda` and
 * the editor routes: one memory layer, one single-flight map, one D1 schema gate, so
 * the editor reuses exactly the cached, normalized feed data the board shows.
 */
export interface Board {
  /** D1 schema memo of this isolate (app entries, ADR-0014). */
  readonly gate: SchemaGate;
  /**
   * Config, window and cache backend of a request; `null` when the config is invalid
   * (the caller answers `serverMisconfigured`).
   */
  context(c: BoardRequest): Promise<BoardContext | null>;
  /** The configured calendars (cached, normalized; never descriptions). */
  feeds(c: BoardRequest, board: BoardContext): Promise<SourceResult[]>;
  /** The virtual app sources (`[]` while the editor is off). */
  apps(c: BoardRequest, board: BoardContext): Promise<SourceResult[]>;
  /**
   * After a write: drops the cached app sources (the write's batch already replaced the
   * D1 change stamp, which makes every isolate rebuild them). Never rejects.
   */
  invalidateApps(board: BoardContext): Promise<void>;
}

/** Default D1 deadline of the app sources on the agenda path (see `loadAppSources`). */
export const APP_SOURCES_D1_TIMEOUT_MS = 2500;

export function createBoard(options: BoardOptions): Board {
  const store = new SourceStore();
  const fallbackBackend = cacheBackend(options.openCache);
  // ADR-0006: KV when bound (works everywhere, global), else the Cache API.
  const backendFor = (env: Env): StoreBackend =>
    env.KIDBOARD_CACHE === undefined
      ? fallbackBackend
      : kvBackend(env.KIDBOARD_CACHE);
  const gate = new SchemaGate();
  const flights = new SingleFlight<SourceEntry>({
    now: options.now,
    pauseAfterFailureMs: FEED_RETRY_AFTER_FAILURE_MS,
  });

  return {
    gate,
    async context(c) {
      const loaded = loadConfig(c.env.KIDBOARD_CONFIG);
      if (!loaded.ok) {
        return null;
      }
      const { config } = loaded;
      const nowMs = options.now();
      const today = todayInZone(nowMs, config.timeZone);
      const backend = backendFor(c.env);
      // ADR-0014: app entries join the board as virtual sources while the editor is on.
      const db = editorEnabled(c.env) ? c.env.KIDBOARD_DATA : undefined;
      const configHash = await loaded.hash;
      warnIfNoSources(config, configHash, db !== undefined);
      return {
        config,
        configHash,
        today,
        window: {
          from: addCalendarDays(today, -WINDOW_DAYS_BEFORE),
          to: addCalendarDays(today, WINDOW_DAYS_AFTER),
        },
        nowMs,
        backend,
        freshTtlSeconds: effectiveTtlSeconds(
          cacheTtlSeconds(c.env.KIDBOARD_CACHE_TTL),
          config.calendars.length + (db === undefined ? 0 : APP_SOURCES.length),
          backend.kind === "kv",
          config.weather === undefined ? 0 : WEATHER_KV_WRITES_PER_DAY,
        ),
        db,
      };
    },
    feeds(c, board) {
      return Promise.all(
        board.config.calendars.map((source) =>
          loadSource(source, {
            env: c.env,
            config: board.config,
            configHash: board.configHash,
            window: board.window,
            nowMs: board.nowMs,
            freshTtlSeconds: board.freshTtlSeconds,
            store,
            backend: board.backend,
            flights,
            defer: (work) => {
              defer(c, work);
            },
            ...(options.fetchTimeoutMs === undefined
              ? {}
              : { fetchTimeoutMs: options.fetchTimeoutMs }),
            ...(options.fetchMaxBytes === undefined
              ? {}
              : { fetchMaxBytes: options.fetchMaxBytes }),
          }),
        ),
      );
    },
    apps(c, board) {
      if (board.db === undefined) {
        return Promise.resolve([]);
      }
      return loadAppSources({
        db: board.db,
        gate,
        config: board.config,
        configHash: board.configHash,
        window: board.window,
        nowMs: board.nowMs,
        freshTtlSeconds: board.freshTtlSeconds,
        store,
        backend: board.backend,
        d1TimeoutMs: options.d1TimeoutMs ?? APP_SOURCES_D1_TIMEOUT_MS,
        defer: (work) => {
          defer(c, work);
        },
      });
    },
    async invalidateApps(board) {
      if (board.db === undefined) {
        return;
      }
      await invalidateAppSources({
        configHash: board.configHash,
        store,
        backend: board.backend,
      });
    },
  };
}

/** Runs `work` past the response via `waitUntil`; without an ExecutionContext it just runs. */
export function defer(c: BoardRequest, work: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    // No ExecutionContext (e.g. `app.request()`): the promise keeps running on its own.
    void work;
  }
}
