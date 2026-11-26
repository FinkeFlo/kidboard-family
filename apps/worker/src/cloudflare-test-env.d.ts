// Bindings from `wrangler.jsonc` as seen by `env` from `cloudflare:test`.
declare namespace Cloudflare {
  interface Env {
    KIDBOARD_CACHE: KVNamespace;
    KIDBOARD_DATA: D1Database;
  }
}
