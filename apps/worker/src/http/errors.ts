import type { Context } from "hono";

/** What the error helpers need of a Hono context (any environment, any path). */
type JsonContext = Pick<Context, "json">;

/** The one 404 of the API: unknown paths, editor off, feed off all look the same. */
export function notFound(c: JsonContext): Response {
  return c.json({ error: "not_found", message: "Not found" }, 404);
}

export function badRequest(c: JsonContext, message: string): Response {
  return c.json({ error: "bad_request", message }, 400);
}

/** 500 for an unusable deployment setting; the log says which, the response never. */
export function serverMisconfigured(c: JsonContext): Response {
  return c.json(
    {
      error: "server_misconfigured",
      message: "Server configuration is invalid",
    },
    500,
  );
}

/** 503 for a D1 failure; callers log the cause (type only) themselves. */
export function storageUnavailable(c: JsonContext): Response {
  return c.json(
    {
      error: "storage_unavailable",
      message: "Entries are unavailable; try again",
    },
    503,
  );
}

/** Error type for log lines: messages may quote statements, URLs or stored text. */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
