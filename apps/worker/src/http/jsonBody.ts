import type { Context } from "hono";
import type { z } from "zod";

export type JsonBodyResult<T> =
  { ok: true; value: T } | { ok: false; response: Response };

/**
 * Reads the request body as JSON and validates it with `schema`. Malformed JSON or a
 * schema mismatch → `{ ok: false, response }` with 400 `bad_request` (the message names
 * the first offending field, never echoes its value). Size limits are the job of the
 * `bodyLimit` middleware in front of the route.
 */
export async function parseJsonBody<S extends z.ZodType>(
  c: Context,
  schema: S,
): Promise<JsonBodyResult<z.output<S>>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return {
      ok: false,
      response: c.json(
        { error: "bad_request", message: "Body must be JSON" },
        400,
      ),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".") ?? "";
    return {
      ok: false,
      response: c.json(
        {
          error: "bad_request",
          message:
            field === "" ? "Invalid request body" : `Invalid field: ${field}`,
        },
        400,
      ),
    };
  }
  return { ok: true, value: parsed.data };
}

/** 413 `payload_too_large` naming the limit (the `bodyLimit` error handler). */
export function payloadTooLarge(c: Context, maxBytes: number): Response {
  return c.json(
    {
      error: "payload_too_large",
      message: `Request body must be at most ${String(maxBytes)} bytes`,
    },
    413,
  );
}
