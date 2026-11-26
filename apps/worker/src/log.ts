/**
 * Minimal logger. Callers pass fixed strings plus ids, codes and counts only: never a
 * feed URL, feed content, token or a caught error's message (runtime fetch errors may
 * quote the URL).
 */
const PREFIX = "[kidboard]";

export function logWarn(message: string): void {
  console.warn(`${PREFIX} ${message}`);
}

export function logError(message: string): void {
  console.error(`${PREFIX} ${message}`);
}
