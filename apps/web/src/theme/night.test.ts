import { describe, expect, it } from "vitest";

import { isNight, type NightMode, parseNightOverride } from "./night";

const BERLIN = "Europe/Berlin";
const at = (iso: string): number => Date.parse(iso);
const NIGHT: NightMode = { enabled: true, start: "19:30", end: "06:30" };

describe("isNight – window spanning midnight (19:30-06:30)", () => {
  it.each([
    ["2026-11-22T18:29:00Z", false], // 19:29 Berlin
    ["2026-11-22T18:30:00Z", true], // 19:30: start belongs to the night
    ["2026-11-22T22:59:00Z", true], // 23:59
    ["2026-11-22T23:00:00Z", true], // 00:00
    ["2026-11-23T05:29:00Z", true], // 06:29
    ["2026-11-23T05:30:00Z", false], // 06:30: end belongs to the day
    ["2026-11-23T11:00:00Z", false], // midday
  ])("%s -> %s", (iso, expected) => {
    expect(isNight(at(iso), NIGHT, BERLIN)).toBe(expected);
  });
});

describe("isNight – window within one day", () => {
  const nap: NightMode = { enabled: true, start: "13:00", end: "15:00" };
  it("is true in [start, end) only", () => {
    expect(isNight(at("2026-11-22T11:59:00Z"), nap, BERLIN)).toBe(false);
    expect(isNight(at("2026-11-22T12:00:00Z"), nap, BERLIN)).toBe(true);
    expect(isNight(at("2026-11-22T13:59:00Z"), nap, BERLIN)).toBe(true);
    expect(isNight(at("2026-11-22T14:00:00Z"), nap, BERLIN)).toBe(false);
  });
});

describe("isNight – enabled and zone", () => {
  it("is never night when disabled", () => {
    expect(
      isNight(at("2026-11-22T23:00:00Z"), { ...NIGHT, enabled: false }, BERLIN),
    ).toBe(false);
  });

  it("uses the configured zone, not the device zone", () => {
    const instant = at("2026-11-22T18:30:00Z");
    expect(isNight(instant, NIGHT, BERLIN)).toBe(true); // 19:30
    expect(isNight(instant, NIGHT, "America/New_York")).toBe(false); // 13:30
    expect(isNight(instant, NIGHT, "Asia/Tokyo")).toBe(true); // 03:30
  });
});

describe("isNight – DST nights in Europe/Berlin", () => {
  it("keeps a midnight-spanning night through spring forward (2026-03-29)", () => {
    // 01:59 CET, 03:00 CEST (02:xx does not exist), 06:29 and 06:30 CEST.
    expect(isNight(at("2026-03-29T00:59:00Z"), NIGHT, BERLIN)).toBe(true);
    expect(isNight(at("2026-03-29T01:00:00Z"), NIGHT, BERLIN)).toBe(true);
    expect(isNight(at("2026-03-29T04:29:00Z"), NIGHT, BERLIN)).toBe(true);
    expect(isNight(at("2026-03-29T04:30:00Z"), NIGHT, BERLIN)).toBe(false);
  });

  it("keeps a midnight-spanning night through fall back (2026-10-25)", () => {
    // 02:30 CEST (00:30Z), 02:30 CET again (01:30Z), 06:29 CET, 06:30 CET.
    expect(isNight(at("2026-10-25T00:30:00Z"), NIGHT, BERLIN)).toBe(true);
    expect(isNight(at("2026-10-25T01:30:00Z"), NIGHT, BERLIN)).toBe(true);
    expect(isNight(at("2026-10-25T05:29:00Z"), NIGHT, BERLIN)).toBe(true);
    expect(isNight(at("2026-10-25T05:30:00Z"), NIGHT, BERLIN)).toBe(false);
  });

  it("follows the clock face for a window inside the DST hour", () => {
    const window: NightMode = { enabled: true, start: "02:30", end: "03:30" };
    // Spring forward: 02:30 never occurs; 03:00 CEST (01:00Z) is the first inside.
    expect(isNight(at("2026-03-29T00:59:00Z"), window, BERLIN)).toBe(false); // 01:59
    expect(isNight(at("2026-03-29T01:00:00Z"), window, BERLIN)).toBe(true); // 03:00
    expect(isNight(at("2026-03-29T01:29:00Z"), window, BERLIN)).toBe(true); // 03:29
    expect(isNight(at("2026-03-29T01:30:00Z"), window, BERLIN)).toBe(false); // 03:30
    // Fall back: 02:30 occurs twice, both instants are inside; 03:30 CET is out.
    expect(isNight(at("2026-10-25T00:30:00Z"), window, BERLIN)).toBe(true);
    expect(isNight(at("2026-10-25T01:30:00Z"), window, BERLIN)).toBe(true);
    expect(isNight(at("2026-10-25T02:29:00Z"), window, BERLIN)).toBe(true);
    expect(isNight(at("2026-10-25T02:30:00Z"), window, BERLIN)).toBe(false);
  });
});

describe("parseNightOverride", () => {
  it.each([
    ["?night=1", true],
    ["?night=0", false],
    ["?a=b&night=1", true],
    ["?night=2", undefined],
    ["?night=", undefined],
    ["?night=true", undefined],
    ["?other=1", undefined],
    ["", undefined],
  ])("%j -> %s", (search, expected) => {
    expect(parseNightOverride(search)).toBe(expected);
  });
});
