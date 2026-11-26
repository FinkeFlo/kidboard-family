/**
 * Path of the phone feed (ADR-0014 "Getting data out"). Kept free of imports so the
 * access token middleware can use it without import cycles.
 */

/** The feed route: `GET /api/feed.ics?token=<KIDBOARD_FEED_TOKEN>`. */
export const FEED_PATH = "/api/feed.ics";

/**
 * Query parameter of the feed token. In the query string (not the path) so that
 * Workers Logs drop it (`observability.redact_query_string` in `wrangler.jsonc`), and
 * distinct from the board's `key` so the access token and the feed token never mix.
 */
export const FEED_TOKEN_PARAM = "token";

/**
 * Whether a request may skip the access token: only `GET`/`HEAD` of exactly
 * {@link FEED_PATH}. Calendar apps cannot send `Authorization` headers; the feed route
 * checks its own token. Nothing else is exempt.
 */
export function isFeedRequest(method: string, path: string): boolean {
  return (method === "GET" || method === "HEAD") && path === FEED_PATH;
}

/** The relative subscribe URL for a (valid) feed token. */
export function feedPath(token: string): string {
  return `${FEED_PATH}?${FEED_TOKEN_PARAM}=${token}`;
}
