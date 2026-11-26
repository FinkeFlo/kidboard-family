import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FEED_PATH, feedPath, isFeedRequest } from "./path";
import { configuredFeedToken, resetFeedTokenWarning } from "./token";

const VALID = "TESTONLY-feed-token-not-a-secret-0123456789";

describe("configuredFeedToken", () => {
  let warnings: string[];

  beforeEach(() => {
    resetFeedTokenWarning();
    warnings = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a valid token and logs nothing", () => {
    expect(configuredFeedToken({ KIDBOARD_FEED_TOKEN: VALID })).toBe(VALID);
    expect(configuredFeedToken({})).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it("refuses an unusable token with one warning per isolate, never the value", () => {
    const short = "TESTONLY-short-feed";
    expect(configuredFeedToken({ KIDBOARD_FEED_TOKEN: short })).toBeUndefined();
    expect(configuredFeedToken({ KIDBOARD_FEED_TOKEN: short })).toBeUndefined();
    expect(
      configuredFeedToken({ KIDBOARD_FEED_TOKEN: "REPLACE_ME" }),
    ).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("KIDBOARD_FEED_TOKEN");
    expect(warnings[0]).not.toContain(short);
    expect(warnings[0]).not.toContain("TESTONLY");
  });
});

describe("feed paths", () => {
  it("builds the subscribe URL with the token in the query string", () => {
    expect(feedPath(VALID)).toBe(`/api/feed.ics?token=${VALID}`);
  });

  it("exempts only GET/HEAD of exactly /api/feed.ics", () => {
    expect(isFeedRequest("GET", FEED_PATH)).toBe(true);
    expect(isFeedRequest("HEAD", FEED_PATH)).toBe(true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect(isFeedRequest(method, FEED_PATH), method).toBe(false);
    }
    for (const other of [
      "/api/feed",
      "/api/feed/",
      "/api/feed.ics/",
      "/api/feed.icsx",
      "/api/feed.ics/x",
      "/api/feed/x.ics",
      "/api/feeds.ics",
      "/API/feed.ics",
      "/api/FEED.ICS",
      "/x/api/feed.ics",
      "/api/agenda",
      "/api/parent/session",
      "/api/parent/feed",
    ]) {
      expect(isFeedRequest("GET", other), other).toBe(false);
    }
  });
});
