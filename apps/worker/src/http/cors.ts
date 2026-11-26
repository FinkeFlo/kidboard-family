import { PARENT_SESSION_HEADER } from "@kidboard/shared";
import type { Context, MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

import type { AppEnv } from "../env";

function allowedOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o !== "");
}

function originAllowed(c: Context<AppEnv>): boolean {
  const origin = c.req.header("Origin") ?? "";
  return (
    origin !== "" &&
    allowedOrigins(c.env.KIDBOARD_ALLOWED_ORIGINS).includes(origin)
  );
}

/** Whether `path` belongs to the parent editor API (ADR-0013). */
export function isParentPath(path: string): boolean {
  return path === "/api/parent" || path.startsWith("/api/parent/");
}

const BOARD_CORS = {
  // Same-origin requests need no CORS; cross-origin only for listed origins.
  origin: (origin: string, c: Context<AppEnv>): string | null =>
    allowedOrigins(c.env.KIDBOARD_ALLOWED_ORIGINS).includes(origin)
      ? origin
      : null,
  allowMethods: ["GET", "HEAD", "OPTIONS"],
  allowHeaders: ["Authorization"],
  maxAge: 600,
};

/**
 * CORS for the API. Listed origins (`KIDBOARD_ALLOWED_ORIGINS`) may read the board API
 * with `GET`/`HEAD` and the `Authorization` header. On `/api/parent/*` a listed origin
 * additionally gets `POST, PATCH, DELETE`, the `Content-Type` and
 * {@link PARENT_SESSION_HEADER} request headers and may read `Retry-After` (ADR-0013)
 * and `Content-Disposition` (export file name, T-43);
 * any other origin never gets more than the board set (and no allow-origin at all).
 */
export function apiCors(): MiddlewareHandler<AppEnv> {
  const boardCors = cors(BOARD_CORS);
  const parentCors = cors({
    ...BOARD_CORS,
    allowMethods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", PARENT_SESSION_HEADER],
    exposeHeaders: ["Retry-After", "Content-Disposition"],
  });
  return (c, next) =>
    isParentPath(c.req.path) && originAllowed(c)
      ? parentCors(c, next)
      : boardCors(c, next);
}
