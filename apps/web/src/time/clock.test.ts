import { AppConfigSchema } from "@kidboard/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bandOf,
  type Bands,
  minuteOfDay,
  minutesOfTime,
  msUntilNextMinute,
  startOfMinute,
} from "./clock";

const at = (iso: string): number => Date.parse(iso);

/** Defaults of the shared config schema: 06:00 / 11:00 / 17:00. */
const DEFAULT_BANDS: Bands = AppConfigSchema.parse({
  calendars: [{ id: "family", kind: "events" }],
}).bands;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("startOfMinute / msUntilNextMinute", () => {
  it("floors to the minute and measures the rest of it", () => {
    const t = at("2026-11-22T10:15:42.500Z");
    expect(startOfMinute(t)).toBe(at("2026-11-22T10:15:00Z"));
    expect(msUntilNextMinute(t)).toBe(17_500);
  });

  it("waits a full minute exactly on a boundary, never 0", () => {
    const t = at("2026-11-22T23:00:00Z");
    expect(startOfMinute(t)).toBe(t);
    expect(msUntilNextMinute(t)).toBe(60_000);
    expect(msUntilNextMinute(t - 1)).toBe(1);
  });

  it("works for instants before the epoch", () => {
    expect(startOfMinute(-1)).toBe(-60_000);
    expect(msUntilNextMinute(-1)).toBe(1);
  });
});

describe("minuteOfDay", () => {
  it("reads the wall clock of the given zone, not the device zone", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    // 08:30Z = 09:30 Berlin = 00:30 Los Angeles.
    expect(minuteOfDay(at("2026-11-22T08:30:00Z"), "Europe/Berlin")).toBe(
      9 * 60 + 30,
    );
    expect(minuteOfDay(at("2026-11-22T08:30:00Z"), "Asia/Kathmandu")).toBe(
      14 * 60 + 15,
    );
  });

  it("follows the DST nights in Europe/Berlin", () => {
    // Spring forward: 01:59 +01:00 is followed by 03:00 +02:00.
    expect(minuteOfDay(at("2026-03-29T00:59:00Z"), "Europe/Berlin")).toBe(
      1 * 60 + 59,
    );
    expect(minuteOfDay(at("2026-03-29T01:00:00Z"), "Europe/Berlin")).toBe(
      3 * 60,
    );
    // Fall back: 02:30 occurs twice.
    expect(minuteOfDay(at("2026-10-25T00:30:00Z"), "Europe/Berlin")).toBe(150);
    expect(minuteOfDay(at("2026-10-25T01:30:00Z"), "Europe/Berlin")).toBe(150);
  });

  it("throws for an unknown zone", () => {
    expect(() => minuteOfDay(0, "Mars/Olympus")).toThrow(RangeError);
  });
});

describe("minutesOfTime", () => {
  it("parses HH:mm", () => {
    expect(minutesOfTime("00:00")).toBe(0);
    expect(minutesOfTime("06:30")).toBe(390);
    expect(minutesOfTime("23:59")).toBe(1439);
  });
});

describe("bandOf", () => {
  const berlin = (time: string): number => at(`2026-11-22T${time}+01:00`);

  it.each([
    ["00:00:00", "night"],
    ["05:59:59.999", "night"],
    ["06:00:00", "morning"],
    ["10:59:59.999", "morning"],
    ["11:00:00", "midday"],
    ["16:59:59.999", "midday"],
    ["17:00:00", "evening"],
    ["23:59:59.999", "evening"],
  ] as const)("%s Berlin with default bands → %s", (time, band) => {
    expect(bandOf(berlin(time), DEFAULT_BANDS, "Europe/Berlin")).toBe(band);
  });

  it("uses the configured boundaries", () => {
    const bands: Bands = {
      morningStart: "07:30",
      middayStart: "12:15",
      eveningStart: "18:45",
    };
    const zone = "Europe/Berlin";
    expect(bandOf(berlin("07:29:59"), bands, zone)).toBe("night");
    expect(bandOf(berlin("07:30:00"), bands, zone)).toBe("morning");
    expect(bandOf(berlin("12:14:59"), bands, zone)).toBe("morning");
    expect(bandOf(berlin("12:15:00"), bands, zone)).toBe("midday");
    expect(bandOf(berlin("18:44:59"), bands, zone)).toBe("midday");
    expect(bandOf(berlin("18:45:00"), bands, zone)).toBe("evening");
  });

  it("supports a morning that starts at midnight (no night band)", () => {
    const bands: Bands = {
      morningStart: "00:00",
      middayStart: "11:00",
      eveningStart: "17:00",
    };
    expect(bandOf(berlin("00:00:00"), bands, "Europe/Berlin")).toBe("morning");
  });

  it("evaluates in the config zone when the device zone differs", () => {
    vi.stubEnv("TZ", "Pacific/Auckland");
    // 16:00Z = 17:00 Berlin (evening) = 11:00 New York (midday) = 05:00 Auckland.
    const instant = at("2026-11-22T16:00:00Z");
    expect(bandOf(instant, DEFAULT_BANDS, "Europe/Berlin")).toBe("evening");
    expect(bandOf(instant, DEFAULT_BANDS, "America/New_York")).toBe("midday");
    expect(bandOf(instant - 1, DEFAULT_BANDS, "Europe/Berlin")).toBe("midday");
  });

  it("uses the shifted wall clock on DST days", () => {
    // Spring forward day: 06:00 +02:00 = 04:00Z; one hour earlier is 05:00 local.
    expect(
      bandOf(at("2026-03-29T04:00:00Z"), DEFAULT_BANDS, "Europe/Berlin"),
    ).toBe("morning");
    expect(
      bandOf(at("2026-03-29T03:59:59Z"), DEFAULT_BANDS, "Europe/Berlin"),
    ).toBe("night");
    // Fall back day: 06:00 +01:00 = 05:00Z.
    expect(
      bandOf(at("2026-10-25T04:59:59Z"), DEFAULT_BANDS, "Europe/Berlin"),
    ).toBe("night");
    expect(
      bandOf(at("2026-10-25T05:00:00Z"), DEFAULT_BANDS, "Europe/Berlin"),
    ).toBe("morning");
  });
});
