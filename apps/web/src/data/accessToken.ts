import type { KeyValueStorage } from "./storage";

/** localStorage key of the access token (kept outside the persisted query cache). */
export const ACCESS_TOKEN_STORAGE_KEY = "kidboard.accessToken";
/** Query parameter the token is handed over with once (e.g. a kiosk bookmark). */
export const ACCESS_TOKEN_PARAM = "key";

export interface ConsumeAccessTokenOptions {
  /** Persistent storage, `undefined` when unavailable (token then lives in memory only). */
  storage: KeyValueStorage | undefined;
  /** Current location; defaults to `window.location`. */
  location?: Pick<Location, "href">;
  /** History used to drop `?key=` from the visible URL; defaults to `window.history`. */
  history?: Pick<History, "replaceState" | "state">;
}

/**
 * Reads the optional API access token once at startup (CONFIG.md,
 * `KIDBOARD_ACCESS_TOKEN`): a non-empty `?key=` wins and is stored, otherwise the
 * stored token is used. `?key=` is always removed from the visible URL
 * (`history.replaceState`) so it does not linger in the address bar, bookmarks or
 * screenshots; the API is then called with `Authorization: Bearer` only.
 * Storage failures are swallowed: the token from the URL still works for this session.
 */
export function consumeAccessToken(
  options: ConsumeAccessTokenOptions,
): string | undefined {
  const { storage } = options;
  const location = options.location ?? window.location;
  const history = options.history ?? window.history;

  const url = new URL(location.href);
  if (url.searchParams.has(ACCESS_TOKEN_PARAM)) {
    const fromUrl = (url.searchParams.get(ACCESS_TOKEN_PARAM) ?? "").trim();
    url.searchParams.delete(ACCESS_TOKEN_PARAM);
    history.replaceState(
      history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    if (fromUrl !== "") {
      try {
        storage?.setItem(ACCESS_TOKEN_STORAGE_KEY, fromUrl);
      } catch {
        // Quota or blocked storage: keep the token for this session only.
      }
      return fromUrl;
    }
  }

  try {
    const stored = storage?.getItem(ACCESS_TOKEN_STORAGE_KEY) ?? null;
    return stored === null || stored === "" ? undefined : stored;
  } catch {
    return undefined;
  }
}

/**
 * Forgets the stored token (after a 401: it was revoked or is wrong; the device needs
 * a new `?key=` link anyway). Storage failures are ignored.
 */
export function forgetAccessToken(storage: KeyValueStorage | undefined): void {
  try {
    storage?.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    // Blocked storage: nothing was stored either.
  }
}
