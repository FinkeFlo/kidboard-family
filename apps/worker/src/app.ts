import { APP_NAME, toPublicConfig } from "@kidboard/shared";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { validator } from "hono/validator";

import {
  createBoard,
  parseRangeQuery,
  rangeMessage,
  requestRange,
} from "./agenda/board";
import { buildAgenda } from "./agenda/buildAgenda";
import { loadConfig } from "./config/loadConfig";
import type { AppEnv } from "./env";
import { registerFeedRoute } from "./feed/routes";
import { accessToken } from "./http/auth";
import { apiCors } from "./http/cors";
import { badRequest, notFound, serverMisconfigured } from "./http/errors";
import { logError } from "./log";
import { editorEnabled } from "./parent/pin";
import { PARENT_BASE_PATH, parentRoutes } from "./parent/routes";
import { registerWeatherRoute } from "./weather/routes";

export {
  cacheTtlSeconds,
  DEFAULT_CACHE_TTL_SECONDS,
  DEFAULT_DAYS,
  effectiveTtlSeconds,
  KV_WRITES_PER_DAY_BUDGET,
} from "./agenda/board";

export interface AppOptions {
  /** Clock (epoch ms); defaults to `Date.now`. */
  now?: () => number;
  /** Cache API cache used without a KV binding; defaults to `caches.default`. */
  openCache?: () => Promise<Cache>;
  /** Upstream timeout override (default 10 s). */
  fetchTimeoutMs?: number;
  /** Upstream size limit override (default 5 MB). */
  fetchMaxBytes?: number;
  /** D1 deadline of the app sources on `/api/agenda` (default 2.5 s). */
  d1TimeoutMs?: number;
  /** Weather upstream timeout override (default 5 s). */
  weatherTimeoutMs?: number;
  /** Weather upstream size limit override (default 1 MB). */
  weatherMaxBytes?: number;
}

/** Builds the Hono app. Options exist for tests (clock, cache, limits). */
export function createApp(options: AppOptions = {}): Hono<AppEnv> {
  const now = options.now ?? Date.now;
  const openCache =
    options.openCache ?? (() => Promise.resolve(caches.default));
  const board = createBoard({
    now,
    openCache,
    fetchTimeoutMs: options.fetchTimeoutMs,
    fetchMaxBytes: options.fetchMaxBytes,
    d1TimeoutMs: options.d1TimeoutMs,
  });
  const app = new Hono<AppEnv>();

  // ADR-0006: the client (TanStack Query) owns API caching; never cache in browsers
  // or intermediaries.
  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });
  app.use("*", secureHeaders());
  app.use("*", apiCors());
  app.use("*", accessToken());

  app.get("/api/health", (c) => {
    c.header("X-App-Name", APP_NAME);
    return c.json({ ok: true });
  });

  app.get("/api/config", (c) => {
    const loaded = loadConfig(c.env.KIDBOARD_CONFIG);
    if (!loaded.ok) {
      return serverMisconfigured(c);
    }
    return c.json(
      toPublicConfig(loaded.config, { editor: editorEnabled(c.env) }),
    );
  });

  app.get(
    "/api/agenda",
    validator("query", (value, c) => {
      const parsed = parseRangeQuery(value);
      return parsed.ok ? parsed.value : badRequest(c, parsed.message);
    }),
    async (c) => {
      const ctx = await board.context(c);
      if (ctx === null) {
        return serverMisconfigured(c);
      }
      const range = requestRange(c.req.valid("query"), ctx);
      if (range === null) {
        return badRequest(c, rangeMessage(ctx));
      }
      const [feeds, apps] = await Promise.all([
        board.feeds(c, ctx),
        board.apps(c, ctx),
      ]);
      const { body, status } = buildAgenda(
        [...feeds, ...apps],
        range,
        ctx.config.timeZone,
        ctx.nowMs,
      );
      return c.json(body, status);
    },
  );

  // Weather forecast from Open-Meteo (ADR-0015), behind the access token.
  registerWeatherRoute(app, {
    now,
    openCache,
    timeoutMs: options.weatherTimeoutMs,
    maxBytes: options.weatherMaxBytes,
  });

  // Parent lock and editor API (ADR-0013, ADR-0014), behind the access token.
  app.route(PARENT_BASE_PATH, parentRoutes({ now, board }).app);

  // Phone feed of the app entries (ADR-0014), guarded by its own secret token.
  registerFeedRoute(app, { board });

  app.notFound(notFound);

  app.onError((error, c) => {
    // Log the error type only: messages of runtime errors may quote URLs or feed text.
    // The path only: query strings carry the access token (`key`) and the phone feed
    // token (`token`).
    logError(`unhandled ${error.name} on ${c.req.method} ${c.req.path}`);
    return c.json(
      { error: "internal_error", message: "Internal server error" },
      500,
    );
  });

  return app;
}
