import type { Hono } from "hono";

import type { Board } from "../agenda/board";
import { EntryStore } from "../entries/entryStore";
import type { AppEnv } from "../env";
import { tokensEqual } from "../http/auth";
import {
  errorName,
  notFound,
  serverMisconfigured,
  storageUnavailable,
} from "../http/errors";
import { logWarn } from "../log";
import { editorEnabled } from "../parent/pin";
import { FEED_PATH, FEED_TOKEN_PARAM } from "./path";
import { renderAppFeed } from "./renderFeed";
import { configuredFeedToken } from "./token";

/** `Content-Type` of the feed (RFC 5545 media type, UTF-8 text). */
export const FEED_CONTENT_TYPE = "text/calendar; charset=utf-8";

export interface FeedRouteOptions {
  board: Board;
}

/**
 * The phone feed (ADR-0014 "Getting data out"):
 * `GET /api/feed.ics?token=<KIDBOARD_FEED_TOKEN>` → the app entries as one iCalendar (`renderAppFeed`), `Content-Type: text/calendar`,
 * `Cache-Control: no-store` (global middleware). Exempt from the access token
 * (`isFeedRequest`), because calendar apps subscribe by URL only.
 *
 * * editor off (`editorEnabled`: no D1 binding, no valid PIN or no access token),
 *   token unset or invalid (see `secretTokenStatus`), missing or wrong `token` → 404
 *   like any unknown path;
 * * the token is compared in constant time (`tokensEqual`);
 * * invalid `KIDBOARD_CONFIG` → 500 `server_misconfigured`; D1 unavailable → 503
 *   without detail (type logged only).
 *
 * The token travels in the query string, which Workers Logs redact
 * (`redact_query_string`) and which no log line of the worker includes (`c.req.path`
 * has no query); it is never logged.
 */
export function registerFeedRoute(
  app: Hono<AppEnv>,
  options: FeedRouteOptions,
): void {
  const { board } = options;

  app.get(FEED_PATH, async (c) => {
    const expected = configuredFeedToken(c.env);
    const provided = c.req.query(FEED_TOKEN_PARAM) ?? "";
    if (!editorEnabled(c.env) || expected === undefined || provided === "") {
      return notFound(c);
    }
    if (!(await tokensEqual(provided, expected))) {
      return notFound(c);
    }
    const ctx = await board.context(c);
    if (ctx === null) {
      return serverMisconfigured(c);
    }
    if (ctx.db === undefined) {
      // Unreachable behind the editor check; keeps the types honest.
      return notFound(c);
    }
    let ics: string;
    try {
      const entries = await new EntryStore(ctx.db, {
        config: ctx.config,
        gate: board.gate,
      }).list();
      ics = renderAppFeed(entries, ctx.config);
    } catch (error) {
      logWarn(`phone feed: entries unavailable (${errorName(error)})`);
      return storageUnavailable(c);
    }
    c.header("Content-Type", FEED_CONTENT_TYPE);
    return c.body(ics, 200);
  });
}
