import {
  type AgendaResponse,
  AgendaResponseSchema,
  DateTimeStringSchema,
  type EditorEntryInputRaw,
  type EditorErrorResponse,
  EditorErrorResponseSchema,
  type EditorImportResponse,
  EditorImportResponseSchema,
  type EditorListResponse,
  EditorListResponseSchema,
  type EditorTemplatesResponse,
  EditorTemplatesResponseSchema,
  type EditorWriteResponse,
  EditorWriteResponseSchema,
  type ImportModeValue,
  PARENT_LOCKOUT_SECONDS,
  PARENT_SESSION_HEADER,
  type ParentFeedResponse,
  ParentFeedResponseSchema,
  type PublicConfig,
  PublicConfigSchema,
  type WeatherResponse,
  WeatherResponseSchema,
  WORKER_UPSTREAM_BUDGET_MS,
} from "@kidboard/shared";
import { z } from "zod";

/**
 * Client request timeout (headers and body). Must exceed the worker budget so a slow
 * upstream still lets stale data arrive; 4 s margin for KV I/O and weak Wi-Fi.
 */
export const REQUEST_TIMEOUT_MS = WORKER_UPSTREAM_BUDGET_MS + 4000;

/** Classification of failed API calls; drives retries and the connection status. */
export type ApiErrorKind =
  /** No response (offline, DNS, connection reset). */
  | "network"
  /** No complete response within {@link REQUEST_TIMEOUT_MS}. */
  | "timeout"
  /** 401: access token missing or wrong. */
  | "unauthorized"
  /** 400: invalid query parameters (a client bug). */
  | "bad-request"
  /** 502: every calendar source failed and the worker had no last-good data. */
  | "upstream"
  /** 500: server misconfigured or internal error. */
  | "server"
  /** Any other non-2xx status. */
  | "http"
  /** 2xx, but not JSON or not matching the shared zod schema. */
  | "invalid-response";

/**
 * Error thrown by {@link ApiClient}. Messages name the path and status only: never
 * the token, never response bodies (they may quote feed content).
 */
export class ApiError extends Error {
  override readonly name = "ApiError";

  constructor(
    readonly kind: ApiErrorKind,
    readonly path: string,
    readonly status?: number,
  ) {
    super(
      status === undefined
        ? `${path}: ${kind}`
        : `${path}: ${kind} (HTTP ${String(status)})`,
    );
  }
}

/** Requested agenda range: `days` days starting at `from` (`YYYY-MM-DD`, config zone). */
export interface AgendaRange {
  from: string;
  /** 1 to `MAX_AGENDA_DAYS` (worker limit). */
  days: number;
}

/**
 * Answer of `POST /api/parent/unlock` for its three expected outcomes. Anything else
 * (401 access token, 404 editor off, network, timeout, …) is thrown as {@link ApiError}.
 */
export type ParentUnlockResult =
  /** Session token and its expiry (epoch ms, server clock). */
  | { kind: "unlocked"; token: string; expiresAt: number }
  /** 403 `wrong_pin`. */
  | { kind: "wrong-pin"; attemptsLeft: number }
  /** 429 `parent_lockout`; seconds from `Retry-After` (fallback: body, then 15 min). */
  | { kind: "lockout"; retryAfterSeconds: number };

/** `GET /api/parent/session`: the session's expiry (epoch ms, server clock). */
export interface ParentSessionInfo {
  expiresAt: number;
}

/**
 * A parent API answer with a known error body (`EditorErrorResponseSchema`): `code` is
 * the worker's `error` (`parent_locked`, `conflict`, `invalid_entry`, `limit_reached`,
 * `not_found`, `storage_unavailable`, …) with the body's details. The message names
 * path, status and code only, never user text.
 */
export class EditorApiError extends Error {
  override readonly name = "EditorApiError";
  readonly code: string;
  readonly issues: NonNullable<EditorErrorResponse["issues"]>;
  readonly revision: number | undefined;
  readonly limit: EditorErrorResponse["limit"];

  constructor(
    readonly path: string,
    readonly status: number,
    body: EditorErrorResponse,
  ) {
    super(`${path}: ${body.error} (HTTP ${String(status)})`);
    this.code = body.error;
    this.issues = body.issues ?? [];
    this.revision = body.revision;
    this.limit = body.limit;
  }
}

/** Which occurrences a change or delete of a series applies to (T-43). */
export type EditorScope =
  | { scope: "series" }
  /** Only the occurrence whose original date is `date` (`occurrenceDate`). */
  | { scope: "one"; date: string };

/** `GET /api/parent/export`: the backup as sent and the file name to save it under. */
export interface EditorExport {
  fileName: string;
  /** The JSON document, byte for byte as the worker sent it. */
  text: string;
}

/** File name used when the worker names none (or an unsafe one). */
export const DEFAULT_EXPORT_FILE_NAME = "kidboard-entries.json";

export interface ApiClient {
  getConfig(signal?: AbortSignal): Promise<PublicConfig>;
  getAgenda(range: AgendaRange, signal?: AbortSignal): Promise<AgendaResponse>;
  /**
   * `/api/weather` (T-49). Errors are thrown as {@link ApiError} like every query (a 404
   * `weather_off` or 503 is `http`); the board hides the weather on any of them.
   */
  getWeather(signal?: AbortSignal): Promise<WeatherResponse>;
  /**
   * Exchanges the parent PIN for a session token (ADR-0013). Not a TanStack query, so
   * no answer of it (not even a 401) runs the board's "forget the access token" path.
   */
  unlockParent(pin: string, signal?: AbortSignal): Promise<ParentUnlockResult>;
  /** Checks a session token; `null` when the worker answers 403 `parent_locked`. */
  getParentSession(
    token: string,
    signal?: AbortSignal,
  ): Promise<ParentSessionInfo | null>;
  /*
   * Editor API (T-43). Like the unlock these are no TanStack queries, so neither a 403
   * nor a 401 runs the board's "forget the access token" path. Known error bodies are
   * thrown as {@link EditorApiError}, everything else as {@link ApiError}.
   */
  /** `GET /api/parent/entries?from&days`: app and Google occurrences. */
  listEntries(
    token: string,
    range: AgendaRange,
    signal?: AbortSignal,
  ): Promise<EditorListResponse>;
  /** `GET /api/parent/templates`: suggestions for the "Again" row. */
  getTemplates(
    token: string,
    signal?: AbortSignal,
  ): Promise<EditorTemplatesResponse>;
  /** `POST /api/parent/entries`. */
  createEntry(
    token: string,
    entry: EditorEntryInputRaw,
    signal?: AbortSignal,
  ): Promise<EditorWriteResponse>;
  /** `PATCH /api/parent/entries/:id?scope=…` with the revision that was edited. */
  updateEntry(
    token: string,
    id: string,
    revision: number,
    entry: EditorEntryInputRaw,
    scope: EditorScope,
    signal?: AbortSignal,
  ): Promise<EditorWriteResponse>;
  /** `DELETE /api/parent/entries/:id?scope=…&revision=`. */
  deleteEntry(
    token: string,
    id: string,
    revision: number,
    scope: EditorScope,
    signal?: AbortSignal,
  ): Promise<EditorWriteResponse>;
  /** `GET /api/parent/export`: the backup document for a download. */
  exportEntries(token: string, signal?: AbortSignal): Promise<EditorExport>;
  /** `POST /api/parent/import?mode=…` with a backup document (sent as given). */
  importEntries(
    token: string,
    mode: ImportModeValue,
    document: string,
    signal?: AbortSignal,
  ): Promise<EditorImportResponse>;
  /**
   * `GET /api/parent/feed`: the relative phone-feed URL (`feedUrl` is absent when the
   * feed is off). The URL carries a secret token: show it to the parent only, never
   * log or cache it (no TanStack query, `cache: "no-store"`).
   */
  getParentFeed(
    token: string,
    signal?: AbortSignal,
  ): Promise<ParentFeedResponse>;
}

export interface ApiClientOptions {
  /** Optional access token, sent as `Authorization: Bearer`. */
  token?: string | undefined;
  /** Origin prefix for API paths; default `""` (same origin). */
  baseUrl?: string;
  /** Fetch implementation; defaults to the global `fetch` (looked up per call). */
  fetch?: typeof fetch;
  /** Request timeout override (tests). */
  timeoutMs?: number;
}

const InstantSchema = DateTimeStringSchema.transform((value) =>
  Date.parse(value),
);
const UnlockOkSchema = z.object({
  token: z.string().min(1),
  expiresAt: InstantSchema,
});
const WrongPinSchema = z.object({
  error: z.literal("wrong_pin"),
  attemptsLeft: z.number().int().min(0),
});
const SessionOkSchema = z.object({ expiresAt: InstantSchema });
const LockoutBodySchema = z.object({
  retryAfterSeconds: z.number().int().positive(),
});

function statusKind(status: number): ApiErrorKind {
  switch (status) {
    case 400:
      return "bad-request";
    case 401:
      return "unauthorized";
    case 500:
      return "server";
    case 502:
      return "upstream";
    default:
      return "http";
  }
}

function parseBody<T>(
  text: string,
  schema: z.ZodType<T>,
  path: string,
  status: number,
): T {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ApiError("invalid-response", path, status);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError("invalid-response", path, status);
  }
  return parsed.data;
}

interface RawResponse {
  status: number;
  text: string;
  headers: Headers;
}

/**
 * Seconds until a lockout ends: the `Retry-After` header (delta seconds, ADR-0013), else
 * the body's `retryAfterSeconds`, else {@link PARENT_LOCKOUT_SECONDS}.
 */
function lockoutSeconds(response: RawResponse): number {
  const header = response.headers.get("Retry-After")?.trim() ?? "";
  if (/^\d+$/.test(header) && Number(header) > 0) {
    return Number(header);
  }
  try {
    const body = LockoutBodySchema.safeParse(JSON.parse(response.text));
    if (body.success) return body.data.retryAfterSeconds;
  } catch {
    // Not JSON: fall back to the default.
  }
  return PARENT_LOCKOUT_SECONDS;
}

/**
 * The `filename` of a `Content-Disposition` header when it is a plain, safe file name
 * (letters, digits, `.`, `_`, `-`, ending in `.json`), else {@link DEFAULT_EXPORT_FILE_NAME}.
 */
export function exportFileName(header: string | null): string {
  const match = /filename="?([^";]+)"?/i.exec(header ?? "");
  const name = match?.[1]?.trim() ?? "";
  return /^[\w-][\w.-]{0,79}\.json$/.test(name)
    ? name
    : DEFAULT_EXPORT_FILE_NAME;
}

/** Shape check of a backup before it is offered as a download. */
const ExportDocumentSchema = z.object({
  format: z.literal("kidboard-entries"),
  entries: z.array(z.unknown()),
});

function scopeQuery(scope: EditorScope): Record<string, string> {
  return scope.scope === "one"
    ? { scope: "one", date: scope.date }
    : { scope: "series" };
}

interface SendInit {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: string;
  headers?: Record<string, string>;
}

/**
 * Creates the typed client for `/api/config`, `/api/agenda`, `/api/weather` and
 * `/api/parent/*`.
 */
export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = options.baseUrl ?? "";
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.token !== undefined && options.token !== "") {
    headers.Authorization = `Bearer ${options.token}`;
  }

  /**
   * One request with the access token and the client timeout. No response or no
   * complete response becomes an {@link ApiError}; every HTTP status is returned.
   */
  async function send(
    path: string,
    query: string,
    init: SendInit,
    signal: AbortSignal | undefined,
  ): Promise<RawResponse> {
    const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    // Own controller instead of `AbortSignal.any`/`AbortSignal.timeout` so older
    // kiosk WebViews work and a timeout can be told apart from a cancellation.
    const controller = new AbortController();
    const deadline = { hit: false };
    const timer = setTimeout(() => {
      deadline.hit = true;
      controller.abort();
    }, timeoutMs);
    const forwardAbort = (): void => {
      controller.abort(signal?.reason);
    };
    if (signal?.aborted === true) {
      forwardAbort();
    }
    signal?.addEventListener("abort", forwardAbort, { once: true });

    try {
      const response = await fetchImpl(`${baseUrl}${path}${query}`, {
        ...(init.method === undefined ? {} : { method: init.method }),
        headers: { ...headers, ...init.headers },
        ...(init.body === undefined ? {} : { body: init.body }),
        signal: controller.signal,
        cache: "no-store",
      });
      const text = await response.text();
      return { status: response.status, text, headers: response.headers };
    } catch (error) {
      if (deadline.hit) {
        throw new ApiError("timeout", path);
      }
      if (signal?.aborted === true) {
        // Cancellation by the caller (TanStack Query): let it see the original abort.
        throw error;
      }
      throw new ApiError("network", path);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forwardAbort);
    }
  }

  async function getJson<T>(
    path: string,
    query: string,
    schema: z.ZodType<T>,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    const { status, text } = await send(path, query, {}, signal);
    if (status < 200 || status > 299) {
      // A 502 body is a valid AgendaResponse with every source in `error` and no
      // events: it carries nothing to show, so it is an error like any other and the
      // previous (persisted) data stays in the cache.
      throw new ApiError(statusKind(status), path, status);
    }
    return parseBody(text, schema, path, status);
  }

  async function unlockParent(
    pin: string,
    signal?: AbortSignal,
  ): Promise<ParentUnlockResult> {
    const path = "/api/parent/unlock";
    const response = await send(
      path,
      "",
      {
        method: "POST",
        body: JSON.stringify({ pin }),
        headers: { "Content-Type": "application/json" },
      },
      signal,
    );
    switch (response.status) {
      case 200: {
        const body = parseBody(response.text, UnlockOkSchema, path, 200);
        return {
          kind: "unlocked",
          token: body.token,
          expiresAt: body.expiresAt,
        };
      }
      case 403: {
        const body = parseBody(response.text, WrongPinSchema, path, 403);
        return { kind: "wrong-pin", attemptsLeft: body.attemptsLeft };
      }
      case 429:
        return { kind: "lockout", retryAfterSeconds: lockoutSeconds(response) };
      default:
        throw new ApiError(statusKind(response.status), path, response.status);
    }
  }

  async function getParentSession(
    token: string,
    signal?: AbortSignal,
  ): Promise<ParentSessionInfo | null> {
    const path = "/api/parent/session";
    const response = await send(
      path,
      "",
      { headers: { [PARENT_SESSION_HEADER]: token } },
      signal,
    );
    if (response.status === 200) {
      return parseBody(response.text, SessionOkSchema, path, 200);
    }
    if (response.status === 403) {
      // `parent_locked`: expired, or signed for another PIN or database.
      return null;
    }
    throw new ApiError(statusKind(response.status), path, response.status);
  }

  /**
   * One editor request with the session header. 2xx → parsed with `schema`; 401 →
   * {@link ApiError} `unauthorized`; a known error body → {@link EditorApiError}; any
   * other answer → {@link ApiError} by status.
   */
  async function editorRequest<T>(
    token: string,
    path: string,
    params: Record<string, string>,
    init: SendInit,
    schema: z.ZodType<T>,
    signal: AbortSignal | undefined,
  ): Promise<{ body: T; headers: Headers; text: string }> {
    const query = new URLSearchParams(params).toString();
    const response = await send(
      path,
      query === "" ? "" : `?${query}`,
      {
        ...init,
        headers: { ...init.headers, [PARENT_SESSION_HEADER]: token },
      },
      signal,
    );
    const { status, text } = response;
    if (status >= 200 && status <= 299) {
      return {
        body: parseBody(text, schema, path, status),
        headers: response.headers,
        text,
      };
    }
    if (status === 401) {
      throw new ApiError("unauthorized", path, status);
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    const error = EditorErrorResponseSchema.safeParse(json);
    if (error.success) {
      throw new EditorApiError(path, status, error.data);
    }
    throw new ApiError(statusKind(status), path, status);
  }

  const jsonBody = (value: unknown): SendInit => ({
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" },
  });
  const entryPath = (id: string): string =>
    `/api/parent/entries/${encodeURIComponent(id)}`;

  const editor: Pick<
    ApiClient,
    | "listEntries"
    | "getTemplates"
    | "createEntry"
    | "updateEntry"
    | "deleteEntry"
    | "exportEntries"
    | "importEntries"
    | "getParentFeed"
  > = {
    listEntries: async (token, range, signal) =>
      (
        await editorRequest(
          token,
          "/api/parent/entries",
          { from: range.from, days: String(range.days) },
          {},
          EditorListResponseSchema,
          signal,
        )
      ).body,
    getTemplates: async (token, signal) =>
      (
        await editorRequest(
          token,
          "/api/parent/templates",
          {},
          {},
          EditorTemplatesResponseSchema,
          signal,
        )
      ).body,
    createEntry: async (token, entry, signal) =>
      (
        await editorRequest(
          token,
          "/api/parent/entries",
          {},
          { method: "POST", ...jsonBody(entry) },
          EditorWriteResponseSchema,
          signal,
        )
      ).body,
    updateEntry: async (token, id, revision, entry, scope, signal) =>
      (
        await editorRequest(
          token,
          entryPath(id),
          scopeQuery(scope),
          { method: "PATCH", ...jsonBody({ revision, entry }) },
          EditorWriteResponseSchema,
          signal,
        )
      ).body,
    deleteEntry: async (token, id, revision, scope, signal) =>
      (
        await editorRequest(
          token,
          entryPath(id),
          { ...scopeQuery(scope), revision: String(revision) },
          { method: "DELETE" },
          EditorWriteResponseSchema,
          signal,
        )
      ).body,
    exportEntries: async (token, signal) => {
      const { headers, text } = await editorRequest(
        token,
        "/api/parent/export",
        {},
        {},
        ExportDocumentSchema,
        signal,
      );
      return {
        fileName: exportFileName(headers.get("Content-Disposition")),
        text,
      };
    },
    getParentFeed: async (token, signal) =>
      (
        await editorRequest(
          token,
          "/api/parent/feed",
          {},
          {},
          ParentFeedResponseSchema,
          signal,
        )
      ).body,
    importEntries: async (token, mode, document, signal) =>
      (
        await editorRequest(
          token,
          "/api/parent/import",
          { mode },
          {
            method: "POST",
            body: document,
            headers: { "Content-Type": "application/json" },
          },
          EditorImportResponseSchema,
          signal,
        )
      ).body,
  };

  return {
    ...editor,
    getConfig: (signal) =>
      getJson("/api/config", "", PublicConfigSchema, signal),
    getAgenda: async (range, signal) => {
      const params = new URLSearchParams({
        from: range.from,
        days: String(range.days),
      });
      const agenda = await getJson(
        "/api/agenda",
        `?${params.toString()}`,
        AgendaResponseSchema,
        signal,
      );
      if (agenda.range.from !== range.from) {
        throw new ApiError("invalid-response", "/api/agenda");
      }
      return agenda;
    },
    getWeather: (signal) =>
      getJson("/api/weather", "", WeatherResponseSchema, signal),
    unlockParent,
    getParentSession,
  };
}
