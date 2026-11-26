/** Minimal synchronous key-value storage (the subset of `Storage` KidBoard uses). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PROBE_KEY = "kidboard.storageProbe";

/**
 * `window.localStorage` if it is usable, else `undefined`. Merely reading the property
 * throws in some browsers when storage is blocked (SecurityError), and some private
 * modes throw on every write (QuotaExceededError), so a write/remove probe decides.
 * Without storage the app still works, it just cannot keep data across reloads.
 */
export function getLocalStorage(
  getStorage: () => KeyValueStorage = () => window.localStorage,
): KeyValueStorage | undefined {
  try {
    const storage = getStorage();
    storage.setItem(PROBE_KEY, "1");
    storage.removeItem(PROBE_KEY);
    return storage;
  } catch {
    return undefined;
  }
}
