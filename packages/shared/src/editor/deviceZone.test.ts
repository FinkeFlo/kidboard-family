import { describe, expect, it } from "vitest";

import { formatInstant } from "../wallTime";
import { wallTimeInZone, zonedWallTimeToEpochMs } from "./zonedTime";

describe("device time zone is never used", () => {
  it("runs under a device zone different from the configured ones", () => {
    // Set in packages/shared/vitest.config.ts; if this fails the guard is not active.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
      "Pacific/Kiritimati",
    );
    expect(new Date("2026-11-23T12:00:00Z").getTimezoneOffset()).toBe(-14 * 60);
    expect(new Date("2026-11-23T12:00:00Z").getDate()).toBe(24);
  });

  it("converts wall-clock times in the configured zone", () => {
    const epochMs = zonedWallTimeToEpochMs(
      "2026-11-23",
      "17:00",
      "Europe/Berlin",
    );
    expect(new Date(epochMs).toISOString()).toBe("2026-11-23T16:00:00.000Z");
    expect(wallTimeInZone(epochMs, "Europe/Berlin")).toMatchObject({
      date: "2026-11-23",
      time: "17:00",
    });
    expect(formatInstant(epochMs, "Europe/Berlin")).toBe(
      "2026-11-23T17:00:00+01:00",
    );
    expect(wallTimeInZone(epochMs, "America/Los_Angeles")).toMatchObject({
      date: "2026-11-23",
      time: "08:00",
    });
  });
});
