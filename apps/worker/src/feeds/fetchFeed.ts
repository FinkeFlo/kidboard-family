import { FEED_TIMEOUT_MS } from "@kidboard/shared";

/** Why a feed could not be downloaded. */
export type FeedFetchErrorReason =
  "http-status" | "timeout" | "too-large" | "network";

const MESSAGES: Record<FeedFetchErrorReason, string> = {
  "http-status": "Calendar feed responded with an error status",
  timeout: "Calendar feed did not respond in time",
  "too-large": "Calendar feed exceeds the size limit",
  network: "Calendar feed could not be fetched",
};

/**
 * Thrown by {@link fetchFeed}. The message is one of a fixed set of strings: it never
 * contains the URL, response headers or body, and the runtime error is not attached as
 * `cause` (fetch errors may quote the secret URL).
 */
export class FeedFetchError extends Error {
  override readonly name = "FeedFetchError";
  readonly reason: FeedFetchErrorReason;
  /** HTTP status for `http-status`. */
  readonly status: number | undefined;

  constructor(reason: FeedFetchErrorReason, status?: number) {
    super(MESSAGES[reason]);
    this.reason = reason;
    this.status = status;
  }
}

/** ADR-0006 / PLAN T-10: maximum feed size in bytes. */
export const FEED_MAX_BYTES = 5 * 1024 * 1024;

export interface FetchFeedOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** `Accept` header; defaults to iCalendar (other upstreams, e.g. weather, ask for JSON). */
  accept?: string;
}

const DEFAULT_ACCEPT = "text/calendar, text/plain;q=0.9, */*;q=0.1";

/**
 * Downloads a feed as text with a timeout (covering headers and body) and a byte cap
 * (checked against `Content-Length` and while streaming, so an oversized body is never
 * buffered completely).
 *
 * @throws FeedFetchError on non-2xx, timeout, oversize or network failure.
 */
export async function fetchFeed(
  url: string,
  options: FetchFeedOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? FEED_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? FEED_MAX_BYTES;
  const signal = AbortSignal.timeout(timeoutMs);

  let response: Response;
  try {
    // `globalThis.fetch` is looked up per call so tests can mock it.
    response = await globalThis.fetch(url, {
      signal,
      headers: { Accept: options.accept ?? DEFAULT_ACCEPT },
    });
  } catch {
    throw new FeedFetchError(signal.aborted ? "timeout" : "network");
  }

  if (!response.ok) {
    await cancelQuietly(response.body);
    throw new FeedFetchError("http-status", response.status);
  }
  const declared = Number(response.headers.get("Content-Length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await cancelQuietly(response.body);
    throw new FeedFetchError("too-large");
  }
  return readTextCapped(response.body, maxBytes, signal);
}

async function cancelQuietly(body: ReadableStream | null): Promise<void> {
  try {
    await body?.cancel();
  } catch {
    // Nothing to do: the body is discarded either way.
  }
}

async function readTextCapped(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  if (body === null) {
    return "";
  }
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");

  // A stalled body must not outlive the timeout: race every read against the signal.
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      reject(new FeedFetchError("timeout"));
    };
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
  aborted.catch(() => undefined); // Handled via Promise.race below.

  let total = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        throw new FeedFetchError("too-large");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error instanceof FeedFetchError
      ? error
      : new FeedFetchError(signal.aborted ? "timeout" : "network");
  } finally {
    if (onAbort !== undefined) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}
