import {
  addCalendarDays,
  BOARD_REFRESH_NOW,
  buildTemplates,
  compareItems,
  DateStringSchema,
  EDITOR_TEMPLATE_DAYS_AFTER,
  EDITOR_TEMPLATE_DAYS_BEFORE,
  type EditorImportResponse,
  type EditorIssue,
  type EditorListItem,
  type EditorListResponse,
  type EditorTemplatesResponse,
  type EditorWriteResponse,
  googleEventItem,
  googleMealItem,
  ImportModeSchema,
  isDateKey,
  MAX_APP_ENTRIES,
  splitResolvable,
} from "@kidboard/shared";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { validator } from "hono/validator";
import { z } from "zod";

import {
  type Board,
  type BoardContext,
  parseRangeQuery,
  rangeMessage,
  requestRange,
} from "../agenda/board";
import { buildAgenda } from "../agenda/buildAgenda";
import {
  type AppEntry,
  EntryStore,
  MAX_ENTRY_BYTES,
  type StoreFailure,
} from "../entries/entryStore";
import type { AppEnv } from "../env";
import {
  badRequest,
  errorName,
  notFound,
  serverMisconfigured,
  storageUnavailable,
} from "../http/errors";
import { parseJsonBody, payloadTooLarge } from "../http/jsonBody";
import { logWarn } from "../log";
import { appItems } from "./editorItems";
import type { ParentEnv } from "./session";

/** Path of the import route below `/api/parent`. */
export const IMPORT_ROUTE = "/import";

/**
 * Body limit of `POST /api/parent/import`: large enough for any document `GET
 * /api/parent/export` can produce (1 000 entries of at most 8 KB of data each, plus
 * up to 512 bytes of id, revision and timestamps per entry and the envelope), so
 * every backup can be restored; about 8.3 MiB. Checked after the session guard, so
 * only an unlocked parent can make the worker read that much.
 */
export const MAX_IMPORT_BODY_BYTES =
  MAX_APP_ENTRIES * (MAX_ENTRY_BYTES + 512) + 4096;

/** At most this many field issues are returned (an import may have thousands). */
export const MAX_ISSUES = 50;

const ScopeQuerySchema = z
  .object({
    scope: z.enum(["one", "series"]).default("series"),
    date: DateStringSchema.refine(isDateKey).optional(),
  })
  .refine((q) => q.scope === "series" || q.date !== undefined, {
    path: ["date"],
    message: "scope=one needs a date",
  });

const DeleteQuerySchema = z.object({
  revision: z
    .string()
    .regex(/^[1-9]\d{0,14}$/)
    .transform(Number),
});

/** `PATCH` body: the revision the client edited and the new entry. */
const PatchBodySchema = z.strictObject({
  revision: z.number().int().min(1),
  entry: z.unknown(),
});

const ImportQuerySchema = z.object({ mode: ImportModeSchema });

export interface EditorRoutesOptions {
  /** Clock, epoch ms. */
  now: () => number;
  board: Board;
  requireSession: MiddlewareHandler<ParentEnv>;
}

function queryMessage(error: z.ZodError, fallback: string): string {
  const field = error.issues[0]?.path.join(".") ?? "";
  return field === "" ? fallback : `Invalid query parameter: ${field}`;
}

function issuesResponse(c: Context, issues: readonly EditorIssue[]): Response {
  return c.json(
    {
      error: "invalid_entry",
      message: "The entry is not valid",
      issues: issues.slice(0, MAX_ISSUES).map((issue) => ({
        code: issue.code,
        path: issue.path,
        message: issue.message,
      })),
    },
    422,
  );
}

/** Maps a store failure to the editor API error body (shared `EditorErrorResponseSchema`). */
function failureResponse(c: Context, failure: StoreFailure): Response {
  switch (failure.error) {
    case "not_found":
      return c.json({ error: "not_found", message: "Entry not found" }, 404);
    case "conflict":
      return c.json(
        {
          error: "conflict",
          message: "The entry was changed meanwhile",
          revision: failure.revision,
        },
        409,
      );
    case "limit_reached":
      return c.json(
        {
          error: "limit_reached",
          message:
            failure.limit === "entries"
              ? `At most ${String(MAX_APP_ENTRIES)} entries`
              : `At most ${String(MAX_ENTRY_BYTES)} bytes per entry`,
          limit: failure.limit,
        },
        422,
      );
    case "invalid":
      return issuesResponse(c, failure.issues);
  }
}

function logStorageError(error: unknown): void {
  // Type only: D1 messages may quote statements or stored text.
  logWarn(`editor: D1 unavailable (${errorName(error)})`);
}

function toDto(entry: AppEntry): AppEntry {
  return {
    id: entry.id,
    revision: entry.revision,
    kind: entry.kind,
    data: entry.data,
    exdates: entry.exdates,
    overrides: entry.overrides,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

/**
 * Editor API (T-43, ADR-0014) on the parent sub-app, every route behind the parent
 * session (403 `parent_locked`); the editor-off 404 and the 16 KB body limit of the
 * sub-app apply in front (the import route has {@link MAX_IMPORT_BODY_BYTES}, checked
 * after the session).
 *
 * * `GET /entries?from&days` → app occurrences (editable) and Google occurrences
 *   (read-only, from the board's cached feed data), sorted by start;
 * * `POST /entries`, `PATCH /entries/:id?scope=one|series&date=` (body `{ revision,
 *   entry }`), `DELETE /entries/:id?scope=one|series&date=&revision=` →
 *   `{ entry, boardRefresh: "now" }` (`scope=one` writes an override or exception);
 * * `GET /templates` → up to 12 suggestions;
 * * `GET /export` (JSON download), `POST /import?mode=merge|replace`.
 *
 * Every write replaces the D1 change stamp in its own batch (`EntryStore`, so every
 * isolate notices it), and a successful one also drops the board's cached app sources
 * (`invalidateApps`) before answering, so the agenda refetch the client starts at once
 * shows the change.
 */
export function registerEditorRoutes(
  app: Hono<AppEnv>,
  options: EditorRoutesOptions,
): void {
  const { board, requireSession } = options;

  type Ready =
    | { ok: true; ctx: BoardContext; store: EntryStore }
    | { ok: false; response: Response };

  const ready = async (c: Context<ParentEnv>): Promise<Ready> => {
    const ctx = await board.context(c);
    if (ctx === null) {
      return { ok: false, response: serverMisconfigured(c) };
    }
    if (ctx.db === undefined) {
      // Unreachable behind the editor gate; keeps the types honest.
      return {
        ok: false,
        response: notFound(c),
      };
    }
    return {
      ok: true,
      ctx,
      store: new EntryStore(ctx.db, {
        config: ctx.config,
        now: options.now,
        gate: board.gate,
      }),
    };
  };

  /** Runs a store call; D1 errors → 503 `storage_unavailable`. */
  const guarded = async (
    c: Context<ParentEnv>,
    op: () => Promise<Response>,
  ): Promise<Response> => {
    try {
      return await op();
    } catch (error) {
      logStorageError(error);
      return storageUnavailable(c);
    }
  };

  const written = async (
    c: Context<ParentEnv>,
    ctx: BoardContext,
    entry: AppEntry | null,
    status: 200 | 201 = 200,
  ): Promise<Response> => {
    await board.invalidateApps(ctx);
    const body: EditorWriteResponse = {
      entry: entry === null ? null : toDto(entry),
      boardRefresh: BOARD_REFRESH_NOW,
    };
    return c.json(body, status);
  };

  const googleItems = async (
    c: Context<ParentEnv>,
    ctx: BoardContext,
    range: { from: string; to: string },
  ): Promise<{
    items: EditorListItem[];
    sources: EditorListResponse["sources"];
  }> => {
    const feeds = await board.feeds(c, ctx);
    const { body } = buildAgenda(feeds, range, ctx.config.timeZone, ctx.nowMs);
    return {
      items: [
        ...body.events.map(googleEventItem),
        ...body.meals.map(googleMealItem),
      ],
      sources: body.sources.map((source) => ({
        id: source.id,
        status: source.status,
      })),
    };
  };

  app.get(
    "/entries",
    requireSession,
    validator("query", (value, c) => {
      const parsed = parseRangeQuery(value);
      return parsed.ok ? parsed.value : badRequest(c, parsed.message);
    }),
    async (c) => {
      const r = await ready(c);
      if (!r.ok) {
        return r.response;
      }
      const range = requestRange(c.req.valid("query"), r.ctx);
      if (range === null) {
        return badRequest(c, rangeMessage(r.ctx));
      }
      // D1 unavailable → the Google occurrences with `storageUnavailable: true`.
      const [stored, google] = await Promise.all([
        r.store.list(range.from, range.to).then(
          (entries) => ({ ok: true as const, entries }),
          (error: unknown) => {
            logStorageError(error);
            return { ok: false as const };
          },
        ),
        googleItems(c, r.ctx, range),
      ]);
      const timeZone = r.ctx.config.timeZone;
      const { resolvable, unresolved } = stored.ok
        ? splitResolvable(stored.entries, r.ctx.config)
        : { resolvable: [], unresolved: [] };
      const items: EditorListItem[] = [
        ...appItems(resolvable, range, r.ctx.config),
        ...google.items,
      ].sort((a, b) => compareItems(a, b, timeZone));
      const body: EditorListResponse = {
        timeZone,
        range,
        sources: google.sources,
        items,
        unresolved,
        storageUnavailable: !stored.ok,
      };
      return c.json(body);
    },
  );

  app.get("/templates", requireSession, async (c) => {
    const r = await ready(c);
    if (!r.ok) {
      return r.response;
    }
    const { ctx } = r;
    const appRange = {
      from: addCalendarDays(ctx.today, -EDITOR_TEMPLATE_DAYS_BEFORE),
      to: addCalendarDays(ctx.today, EDITOR_TEMPLATE_DAYS_AFTER),
    };
    // Google data comes from the board's cached window only (from today - 1): looking
    // further back would mean another fetch and expansion outside the CPU budget
    // (ADR-0003). Weekly Google series still show up through their next 4 weeks.
    const googleRange = {
      from: ctx.window.from,
      to: appRange.to < ctx.window.to ? appRange.to : ctx.window.to,
    };
    return guarded(c, async () => {
      const [entries, google] = await Promise.all([
        r.store.list(appRange.from, appRange.to),
        googleItems(c, ctx, googleRange),
      ]);
      const body: EditorTemplatesResponse = {
        templates: buildTemplates(
          [
            ...appItems(
              splitResolvable(entries, ctx.config).resolvable,
              appRange,
              ctx.config,
            ),
            ...google.items,
          ],
          ctx.nowMs,
          ctx.config.timeZone,
        ),
      };
      return c.json(body);
    });
  });

  app.post("/entries", requireSession, async (c) => {
    const body = await parseJsonBody(c, z.unknown());
    if (!body.ok) {
      return body.response;
    }
    const r = await ready(c);
    if (!r.ok) {
      return r.response;
    }
    return guarded(c, async () => {
      const created = await r.store.create(body.value);
      return created.ok
        ? written(c, r.ctx, created.value, 201)
        : failureResponse(c, created);
    });
  });

  app.patch(
    "/entries/:id",
    requireSession,
    validator("query", (value, c) => {
      const parsed = ScopeQuerySchema.safeParse(value);
      return parsed.success
        ? parsed.data
        : badRequest(c, queryMessage(parsed.error, "Invalid scope"));
    }),
    async (c) => {
      const body = await parseJsonBody(c, PatchBodySchema);
      if (!body.ok) {
        return body.response;
      }
      const r = await ready(c);
      if (!r.ok) {
        return r.response;
      }
      const id = c.req.param("id");
      const query = c.req.valid("query");
      const { revision, entry } = body.value;
      return guarded(c, async () => {
        const result =
          query.scope === "one" && query.date !== undefined
            ? await r.store.setOverride(id, revision, query.date, entry)
            : await r.store.update(id, revision, entry);
        return result.ok
          ? written(c, r.ctx, result.value)
          : failureResponse(c, result);
      });
    },
  );

  app.delete(
    "/entries/:id",
    requireSession,
    validator("query", (value, c) => {
      const scope = ScopeQuerySchema.safeParse(value);
      const revision = DeleteQuerySchema.safeParse(value);
      if (!scope.success) {
        return badRequest(c, queryMessage(scope.error, "Invalid scope"));
      }
      if (!revision.success) {
        return badRequest(c, "revision must be a positive integer");
      }
      return { ...scope.data, revision: revision.data.revision };
    }),
    async (c) => {
      const r = await ready(c);
      if (!r.ok) {
        return r.response;
      }
      const id = c.req.param("id");
      const query = c.req.valid("query");
      return guarded(c, async () => {
        if (query.scope === "one" && query.date !== undefined) {
          const result = await r.store.addException(
            id,
            query.revision,
            query.date,
          );
          return result.ok
            ? written(c, r.ctx, result.value)
            : failureResponse(c, result);
        }
        const result = await r.store.remove(id, query.revision);
        return result.ok ? written(c, r.ctx, null) : failureResponse(c, result);
      });
    },
  );

  app.get("/export", requireSession, async (c) => {
    const r = await ready(c);
    if (!r.ok) {
      return r.response;
    }
    return guarded(c, async () => {
      const doc = await r.store.exportAll();
      // RFC 6266: a download, with a plain ASCII file name (no user text in it).
      c.header(
        "Content-Disposition",
        `attachment; filename="kidboard-entries-${r.ctx.today}.json"`,
      );
      return c.json(doc);
    });
  });

  app.post(
    IMPORT_ROUTE,
    requireSession,
    bodyLimit({
      maxSize: MAX_IMPORT_BODY_BYTES,
      onError: (c) => payloadTooLarge(c, MAX_IMPORT_BODY_BYTES),
    }),
    validator("query", (value, c) => {
      const parsed = ImportQuerySchema.safeParse(value);
      return parsed.success
        ? parsed.data
        : badRequest(c, "mode must be merge or replace");
    }),
    async (c) => {
      const body = await parseJsonBody(c, z.unknown());
      if (!body.ok) {
        return body.response;
      }
      const r = await ready(c);
      if (!r.ok) {
        return r.response;
      }
      const { mode } = c.req.valid("query");
      return guarded(c, async () => {
        const result = await r.store.importAll(body.value, mode);
        if (!result.ok) {
          return failureResponse(c, result);
        }
        await board.invalidateApps(r.ctx);
        const response: EditorImportResponse = {
          mode,
          imported: result.value.imported,
          created: result.value.created,
          updated: result.value.updated,
          boardRefresh: BOARD_REFRESH_NOW,
        };
        return c.json(response);
      });
    },
  );
}
