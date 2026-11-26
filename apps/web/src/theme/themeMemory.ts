import { getLocalStorage, type KeyValueStorage } from "../data/storage";

/**
 * localStorage key of the last applied theme (`night` | `light`). Read before first
 * paint by the inline boot script in `index.html` (keep the key in sync; a unit test
 * checks it), written by {@link rememberTheme}.
 */
export const THEME_STORAGE_KEY = "kidboard.theme";

/**
 * Remembers the theme the board just applied, so the next cold start paints in it
 * before the config is known (a night-time reload must not flash a bright skeleton or
 * error screen). Callers must not pass a `?night` override: only the clock's theme is
 * remembered. Without usable storage this is a no-op.
 */
export function rememberTheme(
  night: boolean,
  storage: KeyValueStorage | undefined = getLocalStorage(),
): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, night ? "night" : "light");
  } catch {
    // Quota or blocked storage: the next start shows light tokens until the config.
  }
}
