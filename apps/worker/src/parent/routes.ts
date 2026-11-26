import type { ParentFeedResponse } from "@kidboard/shared";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { except } from "hono/combine";
import { z } from "zod";

import { type Board, defer } from "../agenda/board";
import type { AppEnv } from "../env";
import { feedPath } from "../feed/path";
import { configuredFeedToken } from "../feed/token";
import { tokensEqual } from "../http/auth";
import { errorName, notFound } from "../http/errors";
import { parseJsonBody, payloadTooLarge } from "../http/jsonBody";
import { logWarn } from "../log";
import { IMPORT_ROUTE, registerEditorRoutes } from "./editorRoutes";
import { clearFailures, recordFailure, reserveAttempt } from "./lockout";
import { editorEnabled } from "./pin";
import {
  type ParentEnv,
  requireParentSession,
  SESSION_TTL_SECONDS,
  SessionKeys,
  signSession,
} from "./session";

/** Where {@link parentRoutes} is mounted. */
export const PARENT_BASE_PATH = "/api/parent";

/**
 * ADR-0013: request bodies of `/api/parent/*` are at most 16 KB (the import route has
 * its own limit, `MAX_IMPORT_BODY_BYTES`).
 */
export const MAX_PARENT_BODY_BYTES = 16 * 1024;

/** Body of `POST /api/parent/unlock`. Any string is a guess; only the length is capped. */
const UnlockBodySchema = z.strictObject({ pin: z.string().max(64) });

export interface ParentRoutesOptions {
  /** Clock, epoch ms. */
  now: () => number;
  /** Board sources of the isolate (feeds for the editor list, app cache invalidation). */
  board: Board;
}

export interface ParentRoutes {
  /** Mount at `/api/parent` (after the access token middleware). */
  app: Hono<AppEnv>;
  /** Guard of the editor routes, sharing this instance's key cache. */
  requireSession: MiddlewareHandler<ParentEnv>;
}

function isoSeconds(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

/**
 * Parent lock routes (ADR-0013), mounted under `/api/parent`:
 *
 * * every path: editor off (`editorEnabled`: no D1 binding, no valid PIN or no access
 *   token) → 404 `not_found`; bodies over {@link MAX_PARENT_BODY_BYTES} → 413
 *   `payload_too_large`;
 * * `POST /unlock` `{ pin }` → `{ token, expiresAt }` (15 min); wrong PIN → 403
 *   `wrong_pin` with `attemptsLeft`; the 5th wrong PIN within 15 min and every request
 *   during the following lockout (15 min, doubling per repeated lockout, at most 2 h)
 *   → 429 `parent_lockout` with `Retry-After`. Each attempt is reserved against the
 *   limit before the PIN is compared; the right PIN clears the wrong ones and the
 *   escalation (see `lockout.ts`);
 * * `GET /session` (needs {@link requireParentSession}) → `{ expiresAt }`;
 * * `GET /feed` (session) → `{ feedUrl }`, the relative phone feed path, only while
 *   `KIDBOARD_FEED_TOKEN` is valid (`ParentFeedResponseSchema`);
 * * the editor API (`./editorRoutes.ts`, T-43), behind the same session guard.
 *
 * The key cache lives in the returned instance; the attempt counters live in D1.
 */
export function parentRoutes(options: ParentRoutesOptions): ParentRoutes {
  const keys = new SessionKeys();
  const requireSession = requireParentSession({ keys, now: options.now });
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!editorEnabled(c.env)) {
      return notFound(c);
    }
    await next();
  });
  // The import route checks the session first and then applies its own, larger limit
  // (`except` matches the full request path).
  app.use(
    "*",
    except(
      `${PARENT_BASE_PATH}${IMPORT_ROUTE}`,
      bodyLimit({
        maxSize: MAX_PARENT_BODY_BYTES,
        onError: (c) => payloadTooLarge(c, MAX_PARENT_BODY_BYTES),
      }),
    ),
  );

  app.post("/unlock", async (c) => {
    const db = c.env.KIDBOARD_DATA;
    const expected = c.env.KIDBOARD_PARENT_PIN;
    if (db === undefined || expected === undefined) {
      // Unreachable behind the editor gate; keeps the types honest.
      return notFound(c);
    }
    const nowSeconds = Math.floor(options.now() / 1000);
    const body = await parseJsonBody(c, UnlockBodySchema);
    if (!body.ok) {
      return body.response;
    }
    await keys.ensureSchema(db);
    // Reserve the attempt against the limit before the PIN is compared (ADR-0013): if
    // D1 fails here, no PIN is compared at all.
    const reserved = await reserveAttempt(db, nowSeconds);
    if (!reserved.ok) {
      return lockout(c, reserved.retryAfterSeconds);
    }
    if (!(await tokensEqual(body.value.pin, expected))) {
      const outcome = await recordFailure(db, reserved, nowSeconds);
      if (outcome.locked) {
        return lockout(c, outcome.retryAfterSeconds);
      }
      // 403, not 401: 401 means "access token invalid" to the board client.
      return c.json(
        {
          error: "wrong_pin",
          message: "Wrong PIN",
          attemptsLeft: outcome.attemptsLeft,
        },
        403,
      );
    }
    try {
      await clearFailures(db, reserved);
    } catch (error) {
      // The PIN was right: go on with the session and retry the delete past the
      // response, so the attempt does not stay counted against the lockout. If the
      // retry fails too, the row ages out with the 15-minute window.
      logWarn(
        `parent unlock: releasing the attempt failed (${errorName(error)}), retrying`,
      );
      defer(
        c,
        clearFailures(db, reserved).catch((retryError: unknown) => {
          logWarn(
            `parent unlock: releasing the attempt failed again (${errorName(retryError)})`,
          );
        }),
      );
    }
    const expiresAt = nowSeconds + SESSION_TTL_SECONDS;
    const token = await signSession(await keys.key(db, expected), expiresAt);
    return c.json({ token, expiresAt: isoSeconds(expiresAt) });
  });

  app.get("/session", requireSession, (c) =>
    c.json({ expiresAt: isoSeconds(c.var.parentSessionExpiresAt) }),
  );

  app.get("/feed", requireSession, (c) => {
    const token = configuredFeedToken(c.env);
    const body: ParentFeedResponse =
      token === undefined ? {} : { feedUrl: feedPath(token) };
    return c.json(body);
  });

  registerEditorRoutes(app, {
    now: options.now,
    board: options.board,
    requireSession,
  });

  return { app, requireSession };
}

function lockout(c: Context<AppEnv>, retryAfterSeconds: number): Response {
  c.header("Retry-After", String(Math.max(1, retryAfterSeconds)));
  return c.json(
    {
      error: "parent_lockout",
      message: "Too many wrong PINs; try again later",
      retryAfterSeconds,
    },
    429,
  );
}
