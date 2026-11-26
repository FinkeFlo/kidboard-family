import { FEED_TIMEOUT_MS } from "@kidboard/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FEED_MAX_BYTES, FeedFetchError, fetchFeed } from "./fetchFeed";

const FEED_URL = "https://feeds.kidboard.invalid/private-TESTONLY/basic.ics";

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

async function failure(promise: Promise<unknown>): Promise<FeedFetchError> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof FeedFetchError)) {
    throw new Error("expected a FeedFetchError");
  }
  return error;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchFeed", () => {
  it("uses the documented limits", () => {
    expect(FEED_TIMEOUT_MS).toBe(10_000);
    expect(FEED_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it("decodes UTF-8 split across chunks", async () => {
    const bytes = new TextEncoder().encode("SUMMARY:🍝 Spaghetti");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        streamOf([
          bytes.subarray(0, 9),
          bytes.subarray(9, 10),
          bytes.subarray(10),
        ]),
      ),
    );
    expect(await fetchFeed(FEED_URL)).toBe("SUMMARY:🍝 Spaghetti");
  });

  it("accepts a body of exactly maxBytes and rejects one byte more", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(
      new Response(streamOf([new Uint8Array(10).fill(65)])),
    );
    expect(await fetchFeed(FEED_URL, { maxBytes: 10 })).toBe("A".repeat(10));
    fetchSpy.mockResolvedValueOnce(
      new Response(
        streamOf([new Uint8Array(6).fill(65), new Uint8Array(5).fill(65)]),
      ),
    );
    expect((await failure(fetchFeed(FEED_URL, { maxBytes: 10 }))).reason).toBe(
      "too-large",
    );
  });

  it("reports non-2xx statuses with fixed, FEED_URL-free messages", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(FEED_URL, { status: 401 }),
    );
    const error = await failure(fetchFeed(FEED_URL));
    expect(error.reason).toBe("http-status");
    expect(error.status).toBe(401);
    expect(error.message).not.toContain("kidboard.invalid");
    expect(error.cause).toBeUndefined();
  });

  it("maps fetch rejections to network errors without keeping the cause", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError(`bad ${FEED_URL}`),
    );
    const error = await failure(fetchFeed(FEED_URL));
    expect(error.reason).toBe("network");
    expect(error.message).not.toContain("kidboard.invalid");
    expect(error.cause).toBeUndefined();
  });

  it("returns an empty string for a body-less 2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    expect(await fetchFeed(FEED_URL)).toBe("");
  });
});
