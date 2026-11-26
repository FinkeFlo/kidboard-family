import { describe, expect, it } from "vitest";

import { formatInstant } from "../wallTime";
import {
  addWallMinutes,
  isoWeekday,
  wallTimeInZone,
  zonedWallTimeToEpochMs,
} from "./zonedTime";

const iso = (date: string, time: string, zone: string): string =>
  new Date(zonedWallTimeToEpochMs(date, time, zone)).toISOString();

describe("zonedTime", () => {
  it.each([
    ["2026-11-23", "17:00", "Europe/Berlin", "2026-11-23T16:00:00.000Z"],
    ["2026-07-01", "17:00", "Europe/Berlin", "2026-07-01T15:00:00.000Z"],
    // spring-forward gap: offset before the gap (RFC 5545)
    ["2026-03-29", "02:30", "Europe/Berlin", "2026-03-29T01:30:00.000Z"],
    // fall-back overlap: first occurrence
    ["2026-10-25", "02:30", "Europe/Berlin", "2026-10-25T00:30:00.000Z"],
    ["2026-03-08", "02:30", "America/Los_Angeles", "2026-03-08T10:30:00.000Z"],
    ["2026-11-01", "01:30", "America/Los_Angeles", "2026-11-01T08:30:00.000Z"],
  ])("%s %s %s -> %s", (date, time, zone, expected) => {
    expect(iso(date, time, zone)).toBe(expected);
  });

  it("formats with the zone's offset and reads wall time back", () => {
    const ms = Date.parse("2026-03-30T06:00:00Z");
    expect(formatInstant(ms, "Europe/Berlin")).toBe(
      "2026-03-30T08:00:00+02:00",
    );
    expect(formatInstant(ms, "America/Los_Angeles")).toBe(
      "2026-03-29T23:00:00-07:00",
    );
    expect(wallTimeInZone(ms, "Asia/Kolkata")).toEqual({
      date: "2026-03-30",
      time: "11:30",
      seconds: 0,
    });
  });

  it("adds wall minutes across midnight and weekdays are ISO", () => {
    expect(addWallMinutes("2026-12-31", "23:30", 60)).toEqual({
      date: "2027-01-01",
      time: "00:30",
    });
    expect(addWallMinutes("2026-11-23", "10:00", 60)).toEqual({
      date: "2026-11-23",
      time: "11:00",
    });
    expect(isoWeekday("2026-11-23")).toBe(1);
    expect(isoWeekday("2026-11-29")).toBe(7);
  });

  it("throws on malformed input", () => {
    expect(() =>
      zonedWallTimeToEpochMs("2026-02-30", "10:00", "Europe/Berlin"),
    ).toThrow(RangeError);
    expect(() =>
      zonedWallTimeToEpochMs("2026-02-03", "1000", "Europe/Berlin"),
    ).toThrow(RangeError);
    expect(() =>
      zonedWallTimeToEpochMs("2026-02-03", "10:00", "Not/AZone"),
    ).toThrow(RangeError);
  });
});
