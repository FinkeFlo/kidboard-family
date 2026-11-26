import { type AppConfig, parseConfig } from "@kidboard/shared";

import { logError } from "../log";

export type LoadedConfig =
  { ok: true; config: AppConfig; hash: Promise<string> } | { ok: false };

let memo: { raw: string | undefined; result: LoadedConfig } | undefined;

/** Hex SHA-256 of `text`. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseRaw(raw: string | undefined): LoadedConfig {
  if (raw === undefined || raw.trim() === "") {
    logError("KIDBOARD_CONFIG is not set");
    return { ok: false };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // The SyntaxError message quotes parts of the document; log a fixed text only.
    logError("KIDBOARD_CONFIG is not valid JSON");
    return { ok: false };
  }
  const result = parseConfig(json);
  if (!result.ok) {
    logError(`KIDBOARD_CONFIG is invalid: ${result.errors.join("; ")}`);
    return { ok: false };
  }
  return {
    ok: true,
    config: result.config,
    // Part of the cache keys: a config change invalidates cached normalized data.
    hash: sha256Hex(JSON.stringify(result.config)),
  };
}

/**
 * Parses and validates `KIDBOARD_CONFIG` once per isolate (memoized by the raw string;
 * a changed value is re-parsed). Validation errors are logged once per raw value. They
 * contain paths and messages from the shared schema, never secrets (the config holds
 * none; unknown keys are reported by name, not value).
 */
export function loadConfig(raw: string | undefined): LoadedConfig {
  if (memo === undefined || memo.raw !== raw) {
    memo = { raw, result: parseRaw(raw) };
  }
  return memo.result;
}
