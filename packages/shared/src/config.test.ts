import { describe, expect, it } from "vitest";

import exampleConfig from "../../../config.example.json";
import {
  AppConfigSchema,
  calendarSecretName,
  parseConfig,
  PublicConfigSchema,
  toPublicConfig,
} from "./config";

const minimal = { calendars: [{ id: "kinder", kind: "events" }] };

function errorsOf(input: unknown): string[] {
  const result = parseConfig(input);
  if (result.ok) {
    throw new Error("expected config to be invalid");
  }
  return result.errors;
}

describe("parseConfig valid", () => {
  it("accepts config.example.json", () => {
    const result = parseConfig(exampleConfig);
    expect(result.ok).toBe(true);
  });

  it("applies defaults to a minimal config", () => {
    const result = parseConfig(minimal);
    expect(result).toEqual({
      ok: true,
      config: {
        locale: "auto",
        timeZone: "Europe/Berlin",
        children: [],
        calendars: [{ id: "kinder", kind: "events" }],
        bands: {
          morningStart: "06:00",
          middayStart: "11:00",
          eveningStart: "17:00",
        },
        nightMode: { enabled: true, start: "19:30", end: "06:30" },
        countdown: { emojis: ["🎂", "🎉", "🎁", "🎄", "🐣", "✈️", "🏖️"] },
        refreshMinutes: 60,
        autoReturnSeconds: 120,
      },
    });
  });

  it("accepts no calendars (app entries only) and defaults them to []", () => {
    const children = [
      { id: "mia", name: "Mia", color: "#E4572E", avatar: "🦊" },
    ];
    const missing = parseConfig({ children });
    const empty = parseConfig({ children, calendars: [] });
    expect(missing.ok && missing.config.calendars).toEqual([]);
    expect(empty.ok && empty.config.calendars).toEqual([]);
    expect(missing).toEqual(empty);
    const bare = parseConfig({});
    expect(bare.ok && bare.config.children).toEqual([]);
    expect(bare.ok && bare.config.calendars).toEqual([]);
  });

  it("keeps the cross-field rules for children without calendars", () => {
    expect(
      errorsOf({
        children: [
          { id: "mia", name: "Mia", color: "#E4572E", avatar: "🦊" },
          { id: "mia", name: "Ben", color: "#2E86AB", avatar: "🐻" },
        ],
      }),
    ).toEqual(["children[1].id: Duplicate child id"]);
  });

  it("allows partial bands/nightMode with per-field defaults", () => {
    const result = parseConfig({
      ...minimal,
      bands: { morningStart: "06:30" },
      nightMode: { enabled: false },
    });
    expect(result.ok && result.config.bands).toEqual({
      morningStart: "06:30",
      middayStart: "11:00",
      eveningStart: "17:00",
    });
    expect(result.ok && result.config.nightMode).toEqual({
      enabled: false,
      start: "19:30",
      end: "06:30",
    });
  });

  it("accepts a night mode that spans midnight and one that does not", () => {
    expect(
      parseConfig({ ...minimal, nightMode: { start: "22:00", end: "06:00" } })
        .ok,
    ).toBe(true);
    expect(
      parseConfig({ ...minimal, nightMode: { start: "01:00", end: "05:00" } })
        .ok,
    ).toBe(true);
  });

  it("accepts a calendar referencing an existing child and other zones", () => {
    const result = parseConfig({
      ...minimal,
      timeZone: "America/New_York",
      children: [{ id: "mia", name: "Mia", color: "child-1", avatar: "👨‍👩‍👧" }],
      calendars: [{ id: "mia", kind: "events", childId: "mia" }],
    });
    expect(result.ok).toBe(true);
  });
});

describe("parseConfig invalid", () => {
  it("rejects non-objects", () => {
    expect(errorsOf(null)[0]).toMatch(/^\(config\): /);
    expect(errorsOf("x")[0]).toMatch(/^\(config\): /);
  });

  it("rejects calendars that are not a list", () => {
    expect(errorsOf({ calendars: null })[0]).toMatch(/^calendars: /);
    expect(errorsOf({ calendars: { id: "kinder" } })[0]).toMatch(
      /^calendars: /,
    );
  });

  it("rejects duplicate calendar ids with a path", () => {
    const errors = errorsOf({
      calendars: [
        { id: "a", kind: "events" },
        { id: "a", kind: "meals" },
      ],
    });
    expect(errors).toEqual(["calendars[1].id: Duplicate calendar id"]);
  });

  it.each(["app-events", "app-meals"])(
    "rejects the reserved calendar id %s",
    (id) => {
      const errors = errorsOf({
        calendars: [
          { id: "kinder", kind: "events" },
          { id, kind: "events" },
        ],
      });
      expect(errors).toEqual([
        "calendars[1].id: Calendar id is reserved for entries made in the app",
      ]);
    },
  );

  it("accepts ids that only resemble the reserved ones", () => {
    const result = parseConfig({
      calendars: [
        { id: "app-event", kind: "events" },
        { id: "app_meals", kind: "meals" },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects calendar ids that collide on the secret name", () => {
    const errors = errorsOf({
      calendars: [
        { id: "a-b", kind: "events" },
        { id: "a_b", kind: "events" },
      ],
    });
    expect(errors[0]).toBe(
      "calendars[1].id: Calendar id maps to the same secret as calendars[0]",
    );
  });

  it("rejects ids unusable in env var names", () => {
    expect(
      errorsOf({ calendars: [{ id: "Kinder", kind: "events" }] })[0],
    ).toMatch(/^calendars\[0\]\.id: /);
    expect(errorsOf({ calendars: [{ id: "a b", kind: "events" }] })[0]).toMatch(
      /^calendars\[0\]\.id: /,
    );
    expect(errorsOf({ calendars: [{ id: "ä", kind: "events" }] })[0]).toMatch(
      /^calendars\[0\]\.id: /,
    );
  });

  it("rejects an unknown childId", () => {
    const errors = errorsOf({
      calendars: [{ id: "x", kind: "events", childId: "nobody" }],
    });
    expect(errors).toEqual(["calendars[0].childId: Unknown child id"]);
  });

  it("rejects duplicate child ids and names", () => {
    const child = { id: "mia", name: "Mia", color: "#fff", avatar: "🦊" };
    const errors = errorsOf({
      ...minimal,
      children: [child, { ...child, id: "mia" }],
    });
    expect(errors).toContain("children[1].id: Duplicate child id");
    expect(
      errors.some((e) =>
        e.startsWith("children[1].name: Duplicate child name"),
      ),
    ).toBe(true);
  });

  it("rejects an invalid avatar", () => {
    const base = { id: "mia", name: "Mia", color: "#fff" };
    expect(
      errorsOf({ ...minimal, children: [{ ...base, avatar: "Mia" }] })[0],
    ).toBe("children[0].avatar: Expected a single emoji");
    expect(
      errorsOf({ ...minimal, children: [{ ...base, avatar: "🦊🐻" }] })[0],
    ).toMatch(/^children\[0\]\.avatar/);
  });

  it("rejects bad time zones", () => {
    expect(errorsOf({ ...minimal, timeZone: "Mars/Olympus" })[0]).toMatch(
      /^timeZone: Expected a valid IANA/,
    );
    expect(errorsOf({ ...minimal, timeZone: "" })[0]).toMatch(/^timeZone: /);
  });

  it("rejects bad HH:mm values", () => {
    for (const bad of ["6:00", "24:00", "12:60", "noon", "06:00:00"]) {
      expect(errorsOf({ ...minimal, bands: { morningStart: bad } })[0]).toMatch(
        /^bands\.morningStart: /,
      );
    }
    expect(errorsOf({ ...minimal, nightMode: { start: "25:00" } })[0]).toMatch(
      /^nightMode\.start: /,
    );
  });

  it("rejects non-ascending bands", () => {
    const msg = /strictly ascending/;
    expect(
      errorsOf({ ...minimal, bands: { morningStart: "12:00" } })[0],
    ).toMatch(msg);
    expect(
      errorsOf({ ...minimal, bands: { middayStart: "17:00" } })[0],
    ).toMatch(msg);
    expect(
      errorsOf({
        ...minimal,
        bands: {
          morningStart: "08:00",
          middayStart: "08:00",
          eveningStart: "17:00",
        },
      })[0],
    ).toMatch(msg);
  });

  it("rejects night mode with equal start and end", () => {
    expect(
      errorsOf({ ...minimal, nightMode: { start: "20:00", end: "20:00" } })[0],
    ).toMatch(/^nightMode: /);
  });

  it("rejects wrong types", () => {
    expect(errorsOf({ ...minimal, refreshMinutes: "60" })[0]).toMatch(
      /^refreshMinutes: /,
    );
    expect(errorsOf({ ...minimal, refreshMinutes: 1.5 })[0]).toMatch(
      /^refreshMinutes: /,
    );
    expect(errorsOf({ ...minimal, refreshMinutes: 0 })[0]).toMatch(
      /^refreshMinutes: /,
    );
    expect(errorsOf({ ...minimal, autoReturnSeconds: -1 })[0]).toMatch(
      /^autoReturnSeconds: /,
    );
    expect(errorsOf({ ...minimal, locale: "fr" })[0]).toMatch(/^locale: /);
    expect(errorsOf({ ...minimal, children: "mia" })[0]).toMatch(/^children: /);
    expect(errorsOf({ calendars: [{ id: "x", kind: "todos" }] })[0]).toMatch(
      /^calendars\[0\]\.kind: /,
    );
    expect(errorsOf({ ...minimal, nightMode: { enabled: "yes" } })[0]).toMatch(
      /^nightMode\.enabled: /,
    );
    expect(errorsOf({ ...minimal, countdown: { emojis: ["abc"] } })[0]).toMatch(
      /^countdown\.emojis\[0\]: /,
    );
  });

  it("rejects unknown keys (typos) and reports every problem", () => {
    const errors = errorsOf({ calendars: 3, localee: "de" });
    expect(errors).toHaveLength(2);
    expect(errors.some((e) => e.includes("localee"))).toBe(true);
  });

  it("rejects a url smuggled into a calendar", () => {
    const errors = errorsOf({
      calendars: [
        { id: "x", kind: "events", url: "https://example.com/a.ics" },
      ],
    });
    expect(errors[0]).toMatch(/^calendars\[0\]: /);
  });
});

describe("calendarSecretName", () => {
  it("upper-cases and maps - to _", () => {
    expect(calendarSecretName("kinder")).toBe("CAL_KINDER_URL");
    expect(calendarSecretName("school-a_2")).toBe("CAL_SCHOOL_A_2_URL");
  });
});

describe("toPublicConfig", () => {
  it("returns the config without secret-looking properties", () => {
    const parsed = parseConfig(exampleConfig);
    if (!parsed.ok) {
      throw new Error(parsed.errors.join("\n"));
    }
    const dto = toPublicConfig(parsed.config);
    expect(dto).toEqual(parsed.config);
    expect(dto).not.toHaveProperty("editor");

    const keys: string[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(walk);
      } else if (typeof value === "object" && value !== null) {
        for (const [key, child] of Object.entries(value)) {
          keys.push(key);
          walk(child);
        }
      }
    };
    walk(dto);
    expect(keys.length).toBeGreaterThan(10);
    for (const key of keys) {
      expect(key.toLowerCase()).not.toContain("url");
      expect(key.toLowerCase()).not.toContain("token");
    }
  });

  it("returns a copy, not the same references", () => {
    const parsed = parseConfig(minimal);
    if (!parsed.ok) {
      throw new Error("invalid");
    }
    const dto = toPublicConfig(parsed.config);
    expect(dto.bands).not.toBe(parsed.config.bands);
    expect(dto.calendars).not.toBe(parsed.config.calendars);
  });

  it("sends the editor flag only when it is true (old strict clients)", () => {
    const parsed = parseConfig(minimal);
    if (!parsed.ok) {
      throw new Error("invalid");
    }
    expect(toPublicConfig(parsed.config)).not.toHaveProperty("editor");
    expect(toPublicConfig(parsed.config, { editor: false })).not.toHaveProperty(
      "editor",
    );
    expect(toPublicConfig(parsed.config, { editor: true }).editor).toBe(true);
    // The DTO without the flag is still exactly what the strict config schema accepts.
    expect(
      AppConfigSchema.safeParse(toPublicConfig(parsed.config)).success,
    ).toBe(true);
  });
});

describe("PublicConfigSchema", () => {
  const parsedMinimal = (): ReturnType<typeof toPublicConfig> => {
    const parsed = parseConfig(minimal);
    if (!parsed.ok) {
      throw new Error("invalid");
    }
    return toPublicConfig(parsed.config, { editor: true });
  };

  it("round-trips the DTO of toPublicConfig", () => {
    const dto = parsedMinimal();
    expect(PublicConfigSchema.parse(JSON.parse(JSON.stringify(dto)))).toEqual({
      ...dto,
      weather: false,
    });
  });

  it("defaults editor to false when an older worker omits it", () => {
    const withoutEditor: Record<string, unknown> = { ...parsedMinimal() };
    delete withoutEditor.editor;
    expect(PublicConfigSchema.parse(withoutEditor).editor).toBe(false);
  });

  it("ignores unknown top-level keys of a newer worker", () => {
    const parsed = PublicConfigSchema.parse({
      ...parsedMinimal(),
      futureFlag: { anything: 1 },
    });
    expect(parsed).not.toHaveProperty("futureFlag");
    expect(parsed.editor).toBe(true);
  });

  it("round-trips a config without calendars", () => {
    const parsed = parseConfig({ timeZone: "Europe/Vienna" });
    if (!parsed.ok) {
      throw new Error(parsed.errors.join("\n"));
    }
    const dto = toPublicConfig(parsed.config, { editor: true });
    expect(dto.calendars).toEqual([]);
    const pub = PublicConfigSchema.parse(dto);
    expect(pub.calendars).toEqual([]);
    expect(pub.editor).toBe(true);
    // A body without the key (cannot come from this worker) still parses.
    const withoutCalendars: Partial<typeof dto> = { ...dto };
    delete withoutCalendars.calendars;
    expect(PublicConfigSchema.parse(withoutCalendars).calendars).toEqual([]);
  });

  it("rejects a non-boolean editor flag and keeps the config rules", () => {
    expect(
      PublicConfigSchema.safeParse({ ...parsedMinimal(), editor: "yes" })
        .success,
    ).toBe(false);
    expect(
      PublicConfigSchema.safeParse({
        ...parsedMinimal(),
        calendars: [
          { id: "kinder", kind: "events" },
          { id: "kinder", kind: "meals" },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("weather config", () => {
  const withWeather = (weather: unknown): unknown => ({ ...minimal, weather });

  it("is off without a block and defaults the unit to celsius", () => {
    const off = parseConfig(minimal);
    expect(off.ok && off.config.weather).toBeUndefined();
    const on = parseConfig(withWeather({ place: "Berlin" }));
    expect(on.ok && on.config.weather).toEqual({
      place: "Berlin",
      unit: "celsius",
    });
  });

  it("accepts place with country, and coordinates incl. bounds", () => {
    expect(
      parseConfig(withWeather({ place: "Springfield", country: "US" })).ok,
    ).toBe(true);
    expect(
      parseConfig(
        withWeather({ latitude: -90, longitude: 180, unit: "fahrenheit" }),
      ).ok,
    ).toBe(true);
    expect(parseConfig(withWeather({ latitude: 90, longitude: -180 })).ok).toBe(
      true,
    );
    expect(parseConfig(withWeather({ place: "x".repeat(80) })).ok).toBe(true);
  });

  it.each([
    ["empty block", {}],
    ["place and coordinates", { place: "Berlin", latitude: 1, longitude: 2 }],
    ["place and latitude only", { place: "Berlin", latitude: 1 }],
    ["only latitude", { latitude: 1 }],
    ["only longitude", { longitude: 1 }],
    ["empty place", { place: "" }],
    ["blank place", { place: "   " }],
    ["place too long", { place: "x".repeat(81) }],
    ["lowercase country", { place: "Berlin", country: "de" }],
    ["three-letter country", { place: "Berlin", country: "DEU" }],
    ["country with coordinates", { latitude: 1, longitude: 2, country: "DE" }],
    ["latitude too high", { latitude: 90.1, longitude: 0 }],
    ["latitude too low", { latitude: -90.1, longitude: 0 }],
    ["longitude too high", { latitude: 0, longitude: 180.1 }],
    ["longitude too low", { latitude: 0, longitude: -180.1 }],
    ["unknown unit", { place: "Berlin", unit: "kelvin" }],
    ["unknown key", { place: "Berlin", extra: true }],
    ["non-numeric latitude", { latitude: "1", longitude: 2 }],
  ])("rejects %s", (_name, weather) => {
    const errors = errorsOf(withWeather(weather));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/^weather/);
  });

  it("gives a clear message for place plus coordinates", () => {
    expect(
      errorsOf(withWeather({ place: "Berlin", latitude: 1, longitude: 2 })),
    ).toEqual(["weather: Use either place or latitude/longitude, not both"]);
  });

  it("exposes only a flag in the public config, never place or coordinates", () => {
    const parsed = parseConfig(
      withWeather({ place: "TESTONLY-Weatherplace", country: "DE" }),
    );
    if (!parsed.ok) {
      throw new Error("invalid");
    }
    const dto = toPublicConfig(parsed.config);
    expect(dto.weather).toBe(true);
    expect(JSON.stringify(dto)).not.toContain("TESTONLY-Weatherplace");
    expect(JSON.stringify(dto)).not.toContain("celsius");

    const coords = parseConfig(
      withWeather({ latitude: 12.34, longitude: 56.78 }),
    );
    if (!coords.ok) {
      throw new Error("invalid");
    }
    const coordsJson = JSON.stringify(toPublicConfig(coords.config));
    expect(coordsJson).not.toContain("12.34");
    expect(coordsJson).not.toContain("56.78");

    const off = parseConfig(minimal);
    if (!off.ok) {
      throw new Error("invalid");
    }
    expect(toPublicConfig(off.config)).not.toHaveProperty("weather");
  });

  it("PublicConfigSchema defaults weather to false and round-trips true", () => {
    const off = parseConfig(minimal);
    const on = parseConfig(withWeather({ place: "Berlin" }));
    if (!off.ok || !on.ok) {
      throw new Error("invalid");
    }
    expect(PublicConfigSchema.parse(toPublicConfig(off.config)).weather).toBe(
      false,
    );
    const dto = toPublicConfig(on.config);
    expect(PublicConfigSchema.parse(JSON.parse(JSON.stringify(dto)))).toEqual({
      ...dto,
      editor: false,
    });
    expect(
      PublicConfigSchema.safeParse({ ...dto, weather: "yes" }).success,
    ).toBe(false);
  });
});
