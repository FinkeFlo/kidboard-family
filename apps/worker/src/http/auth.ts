import type { MiddlewareHandler } from "hono";

import type { AppEnv } from "../env";
import { isFeedRequest } from "../feed/path";
import { logError } from "../log";
import { secretTokenStatus } from "./secretToken";

const encoder = new TextEncoder();

/**
 * Constant-time string comparison: both values are hashed to fixed-size SHA-256
 * digests first (no length leak), then compared with `crypto.subtle.timingSafeEqual`
 * (Cloudflare "Workers best practices").
 */
export async function tokensEqual(
  provided: string,
  expected: string,
): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header ?? "");
  return match?.[1];
}

/** Paths that stay public even with an access token (they expose only `{ ok: true }`). */
const PUBLIC_PATHS = new Set(["/api/health"]);

/**
 * Access token (`KIDBOARD_ACCESS_TOKEN`), fail closed. Every API path except
 * {@link PUBLIC_PATHS} and `GET`/`HEAD` of exactly the phone feed path (`/api/feed.ics`,
 * `isFeedRequest`; it checks its own `?token=`) needs `Authorization: Bearer <token>` or
 * `?key=<token>`, otherwise 401. A token that is not usable (`secretTokenStatus`: the
 * template value, shorter than 32 characters, other characters) or no token at all
 * answers 500 `server_misconfigured` instead of letting requests through. A deliberately
 * public read-only board needs the explicit opt-in `KIDBOARD_PUBLIC="1"` and no token.
 * CORS preflights are answered by the CORS middleware before this runs.
 */
export function accessToken(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (
      PUBLIC_PATHS.has(c.req.path) ||
      isFeedRequest(c.req.method, c.req.path)
    ) {
      await next();
      return;
    }
    const expected = c.env.KIDBOARD_ACCESS_TOKEN;
    const status = secretTokenStatus(expected);
    if (status === "unset" && c.env.KIDBOARD_PUBLIC === "1") {
      await next();
      return;
    }
    if (status !== "valid" || expected === undefined) {
      logError(
        status === "unset"
          ? 'KIDBOARD_ACCESS_TOKEN is not set; set a random token of 32 to 256 characters (or KIDBOARD_PUBLIC="1" for a public read-only board)'
          : "KIDBOARD_ACCESS_TOKEN is not usable (template value, shorter than 32 or other than A-Z, a-z, 0-9, _ and -); set a random token",
      );
      return c.json(
        {
          error: "server_misconfigured",
          message: "Server configuration is invalid",
        },
        500,
      );
    }
    const candidates = [
      bearerToken(c.req.header("Authorization")),
      c.req.query("key"),
    ].filter((t): t is string => t !== undefined && t !== "");
    const results = await Promise.all(
      candidates.map((t) => tokensEqual(t, expected)),
    );
    if (!results.includes(true)) {
      c.header("WWW-Authenticate", 'Bearer realm="kidboard"');
      return c.json(
        { error: "unauthorized", message: "A valid access token is required" },
        401,
      );
    }
    await next();
  };
}
