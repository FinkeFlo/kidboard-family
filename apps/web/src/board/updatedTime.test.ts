import { describe, expect, it } from "vitest";

import { formatUpdatedTime } from "./updatedTime";

const NOON = Date.parse("2026-11-22T12:00:00+01:00");

describe("formatUpdatedTime", () => {
  it("formats in the config zone, 24 h in German", () => {
    expect(
      formatUpdatedTime(NOON, { locale: "de", timeZone: "Europe/Berlin" }),
    ).toBe("12:00");
  });

  it("keeps the English time on one line (non-breaking space before AM/PM)", () => {
    const time = formatUpdatedTime(NOON, {
      locale: "en",
      timeZone: "Europe/Berlin",
    });
    expect(time).toBe("12:00 PM");
    expect(time).not.toMatch(/ /u);
  });

  it.each([0, -1, Number.NaN])("is unknown for %s", (value) => {
    expect(
      formatUpdatedTime(value, { locale: "en", timeZone: "Europe/Berlin" }),
    ).toBeUndefined();
  });
});
