/**
 * Worker bindings: plain-text variables, secrets, the optional KV namespace and the
 * optional D1 database.
 *
 * Typed by hand instead of `wrangler types`: the calendar secrets have dynamic names
 * (`CAL_<ID>_URL`, one per configured calendar) and the variables are not declared in
 * `wrangler.jsonc`, so the generator would only see the KV and D1 bindings.
 */
export interface Env {
  /** Non-secret settings as one JSON document (docs/CONFIG.md). Required. */
  KIDBOARD_CONFIG?: string;
  /**
   * Token that `/api/*` (except `/api/health` and the phone feed) requires: 32 to 256
   * characters of `A-Z a-z 0-9 _ -`. Missing or unusable → the API answers 500
   * `server_misconfigured` (fail closed), unless `KIDBOARD_PUBLIC` is `"1"`.
   */
  KIDBOARD_ACCESS_TOKEN?: string;
  /**
   * `"1"` = deliberately public, read-only board without an access token. Only honoured
   * while `KIDBOARD_ACCESS_TOKEN` is unset or empty; the editor still needs the token.
   */
  KIDBOARD_PUBLIC?: string;
  /** Comma-separated list of allowed CORS origins; default none. */
  KIDBOARD_ALLOWED_ORIGINS?: string;
  /** Seconds a fetched feed counts as fresh; default 3600. */
  KIDBOARD_CACHE_TTL?: string;
  /**
   * Optional KV namespace for the source cache (declared without an id in
   * `wrangler.jsonc`, auto-provisioned on deploy). Without it the Cache API is used.
   */
  KIDBOARD_CACHE?: KVNamespace;
  /**
   * Optional D1 database for app entries of the parent editor (ADR-0014; declared
   * without an id in `wrangler.jsonc`, auto-provisioned on deploy). Without it the
   * editor is off.
   */
  KIDBOARD_DATA?: D1Database;
  /**
   * Parent PIN for the editor (ADR-0013): 6 to 12 digits. Unset, invalid or the
   * template value → the editor is off.
   */
  KIDBOARD_PARENT_PIN?: string;
  /**
   * Optional secret token of the phone feed `/api/feed.ics?token=<token>` (ADR-0014): 32 to
   * 256 characters of `A-Z a-z 0-9 _ -`. Unset, invalid or the template value → no feed.
   */
  KIDBOARD_FEED_TOKEN?: string;
  /** Secret iCal URL per calendar, see `calendarSecretName` in `@kidboard/shared`. */
  [secret: `CAL_${string}_URL`]: string | undefined;
}

/** Hono environment of the app. */
export interface AppEnv {
  Bindings: Env;
}
