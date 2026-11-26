import { z } from "zod";

import { CalendarSourceSchema, ChildSchema } from "./model";
import {
  EmojiSchema,
  minutesOfTime,
  TimeOfDaySchema,
  TimeZoneSchema,
} from "./primitives";
import { TemperatureUnitSchema } from "./weather/schema";

export const LocaleSchema = z.enum(["de", "en", "auto"]);
export type Locale = z.infer<typeof LocaleSchema>;

/** Shape of a calendar secret name, see {@link calendarSecretName}. */
export type CalendarSecretName = `CAL_${string}_URL`;

/**
 * Name of the secret that holds the iCal URL of calendar `id`.
 * Mapping: upper-case the id and replace `-` by `_`, e.g. `kinder` -> `CAL_KINDER_URL`,
 * `school-a` -> `CAL_SCHOOL_A_URL`. (Ids are restricted to `[a-z0-9_-]`.)
 */
export function calendarSecretName(id: string): CalendarSecretName {
  return `CAL_${id.toUpperCase().replaceAll("-", "_")}_URL`;
}

/** Source id of the app's own events (parent editor, ADR-0014); reserved. */
export const APP_EVENTS_SOURCE_ID = "app-events";
/** Source id of the app's own meals (parent editor, ADR-0014); reserved. */
export const APP_MEALS_SOURCE_ID = "app-meals";
/**
 * Calendar ids the worker uses for the virtual sources of app entries
 * (`AgendaResponse.sources`, `sourceId` of events and meals); configured calendars must
 * not use them.
 */
export const RESERVED_CALENDAR_IDS: readonly string[] = [
  APP_EVENTS_SOURCE_ID,
  APP_MEALS_SOURCE_ID,
];

const DEFAULT_BANDS = {
  morningStart: "06:00",
  middayStart: "11:00",
  eveningStart: "17:00",
};

const BandsSchema = z
  .strictObject({
    morningStart: TimeOfDaySchema.default(DEFAULT_BANDS.morningStart),
    middayStart: TimeOfDaySchema.default(DEFAULT_BANDS.middayStart),
    eveningStart: TimeOfDaySchema.default(DEFAULT_BANDS.eveningStart),
  })
  .refine(
    (b) =>
      // A malformed time already has its own issue; refinements still run on it.
      !Object.values(b).every(
        (time) => TimeOfDaySchema.safeParse(time).success,
      ) ||
      (minutesOfTime(b.morningStart) < minutesOfTime(b.middayStart) &&
        minutesOfTime(b.middayStart) < minutesOfTime(b.eveningStart)),
    {
      message:
        "Bands must be strictly ascending: morningStart < middayStart < eveningStart",
    },
  );

const DEFAULT_NIGHT_MODE = { enabled: true, start: "19:30", end: "06:30" };

/** Night mode window; `end` earlier than `start` means it spans midnight. */
const NightModeSchema = z
  .strictObject({
    enabled: z.boolean().default(DEFAULT_NIGHT_MODE.enabled),
    start: TimeOfDaySchema.default(DEFAULT_NIGHT_MODE.start),
    end: TimeOfDaySchema.default(DEFAULT_NIGHT_MODE.end),
  })
  .refine((n) => n.start !== n.end, { message: "start and end must differ" });

export const DEFAULT_COUNTDOWN_EMOJIS = [
  "🎂",
  "🎉",
  "🎁",
  "🎄",
  "🐣",
  "✈️",
  "🏖️",
];

const CountdownSchema = z.strictObject({
  emojis: z.array(EmojiSchema).default(DEFAULT_COUNTDOWN_EMOJIS),
});

/**
 * Optional weather block: a `place` (name, optionally narrowed by an ISO 3166-1 alpha-2
 * `country`) or `latitude` + `longitude`, never both. Server-side only, never public.
 */
const WeatherConfigSchema = z
  .strictObject({
    place: z.string().trim().min(1).max(80).optional(),
    country: z
      .string()
      .regex(
        /^[A-Z]{2}$/,
        "country must be an ISO 3166-1 alpha-2 code, e.g. DE",
      )
      .optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    unit: TemperatureUnitSchema.default("celsius"),
  })
  .superRefine((w, ctx) => {
    const hasPlace = w.place !== undefined;
    const hasLat = w.latitude !== undefined;
    const hasLon = w.longitude !== undefined;
    if (hasPlace && (hasLat || hasLon)) {
      ctx.addIssue({
        code: "custom",
        message: "Use either place or latitude/longitude, not both",
      });
    } else if (!hasPlace && !hasLat && !hasLon) {
      ctx.addIssue({
        code: "custom",
        message: "Set either place or latitude and longitude",
      });
    } else if (!hasPlace && hasLat !== hasLon) {
      ctx.addIssue({
        code: "custom",
        message: "latitude and longitude must be set together",
      });
    }
    if (!hasPlace && w.country !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["country"],
        message: "country only applies together with place",
      });
    }
  });
export type WeatherConfig = z.infer<typeof WeatherConfigSchema>;

const appConfigShape = {
  locale: LocaleSchema.default("auto"),
  timeZone: TimeZoneSchema.default("Europe/Berlin"),
  children: z.array(ChildSchema).default([]),
  /**
   * Google Calendar feeds (optional, ADR-0014): app entries of the parent editor are the
   * default source; without calendars the board shows only those.
   */
  calendars: z.array(CalendarSourceSchema).default([]),
  bands: BandsSchema.default(DEFAULT_BANDS),
  nightMode: NightModeSchema.default(DEFAULT_NIGHT_MODE),
  countdown: CountdownSchema.default({ emojis: DEFAULT_COUNTDOWN_EMOJIS }),
  refreshMinutes: z.number().int().min(1).max(1440).default(60),
  autoReturnSeconds: z.number().int().min(10).max(3600).default(120),
};

const AppConfigObjectSchema = z.strictObject({
  ...appConfigShape,
  weather: WeatherConfigSchema.optional(),
});
type AppConfigFields = Pick<
  z.output<typeof AppConfigObjectSchema>,
  "children" | "calendars"
>;

/**
 * Cross-field rules (unique ids/names, secret names, known child ids). Messages name the
 * path and index only, never the value: they reach the logs, and names are children's
 * personal data.
 */
function refineConfig(config: AppConfigFields, ctx: z.RefinementCtx): void {
  const childIds = new Set<string>();
  const childNames = new Set<string>();
  config.children.forEach((child, i) => {
    if (childIds.has(child.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["children", i, "id"],
        message: "Duplicate child id",
      });
    }
    childIds.add(child.id);
    const name = child.name.toLowerCase();
    if (childNames.has(name)) {
      ctx.addIssue({
        code: "custom",
        path: ["children", i, "name"],
        message: "Duplicate child name (names are compared case-insensitively)",
      });
    }
    childNames.add(name);
  });

  const calendarIds = new Set<string>();
  const secretNames = new Map<string, number>();
  config.calendars.forEach((calendar, i) => {
    if (RESERVED_CALENDAR_IDS.includes(calendar.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["calendars", i, "id"],
        message: "Calendar id is reserved for entries made in the app",
      });
    } else if (calendarIds.has(calendar.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["calendars", i, "id"],
        message: "Duplicate calendar id",
      });
    } else {
      const secret = calendarSecretName(calendar.id);
      const other = secretNames.get(secret);
      if (other !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["calendars", i, "id"],
          message: `Calendar id maps to the same secret as calendars[${String(other)}]`,
        });
      }
      secretNames.set(secret, i);
    }
    calendarIds.add(calendar.id);
    if (calendar.childId !== undefined && !childIds.has(calendar.childId)) {
      ctx.addIssue({
        code: "custom",
        path: ["calendars", i, "childId"],
        message: "Unknown child id",
      });
    }
  });
}

export const AppConfigSchema = AppConfigObjectSchema.superRefine(refineConfig);

/** Validated config with all defaults applied. */
export type AppConfig = z.infer<typeof AppConfigSchema>;
/** Config as written by the user (defaults optional). */
export type AppConfigInput = z.input<typeof AppConfigSchema>;

export type ParseConfigResult =
  { ok: true; config: AppConfig } | { ok: false; errors: string[] };

function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const segment of path) {
    out +=
      typeof segment === "number"
        ? `[${String(segment)}]`
        : `${out === "" ? "" : "."}${String(segment)}`;
  }
  return out === "" ? "(config)" : out;
}

/** Validates an unknown value (e.g. parsed `KIDBOARD_CONFIG`) and applies defaults. */
export function parseConfig(input: unknown): ParseConfigResult {
  const result = AppConfigSchema.safeParse(input);
  if (result.success) {
    return { ok: true, config: result.data };
  }
  return {
    ok: false,
    errors: result.error.issues.map(
      (issue) => `${formatPath(issue.path)}: ${issue.message}`,
    ),
  };
}

/**
 * DTO served at `/api/config`: the config (it holds no secrets) plus server-derived
 * flags. Unknown top-level keys are stripped instead of rejected, so a client keeps
 * working when a newer worker adds a field.
 */
export const PublicConfigSchema = z
  .object({
    ...appConfigShape,
    /**
     * The parent editor is available (ADR-0013/ADR-0014: `KIDBOARD_DATA` bound and a
     * valid `KIDBOARD_PARENT_PIN`). Absent (older worker) → `false`.
     */
    editor: z.boolean().default(false),
    /** Weather is configured (the place and coordinates are never sent to the client). */
    weather: z.boolean().default(false),
  })
  .superRefine(refineConfig);
export type PublicConfig = z.infer<typeof PublicConfigSchema>;
/**
 * The `/api/config` body as sent: `editor` only when true, because web bundles built
 * before the flag existed parse the config strictly and would reject the key.
 */
export type PublicConfigDto = Omit<PublicConfig, "editor" | "weather"> & {
  editor?: true;
  weather?: true;
};

/**
 * The config parts the editor rules need (everything but the server-only weather block),
 * so both an {@link AppConfig} and a {@link PublicConfig} fit.
 */
export type CoreConfig = Omit<AppConfig, "weather">;

/**
 * Input of {@link toPublicConfig}: a validated {@link AppConfig}, or an already public
 * config (where `weather` is the boolean flag).
 */
export type PublicConfigSource = CoreConfig & {
  weather?: WeatherConfig | boolean | undefined;
};

export interface PublicConfigOptions {
  /** See {@link PublicConfig.editor}; default `false`. */
  editor?: boolean;
}

/**
 * Builds the public config DTO. Fields are copied explicitly so that any future
 * internal-only field must be opted in deliberately. `editor` and `weather` are omitted when false
 * (see {@link PublicConfigDto}); {@link PublicConfigSchema} reads that as `false`.
 */
export function toPublicConfig(
  config: PublicConfigSource,
  options: PublicConfigOptions = {},
): PublicConfigDto {
  return {
    locale: config.locale,
    timeZone: config.timeZone,
    children: config.children.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      avatar: c.avatar,
    })),
    calendars: config.calendars.map((c) => ({
      id: c.id,
      kind: c.kind,
      ...(c.childId === undefined ? {} : { childId: c.childId }),
      ...(c.label === undefined ? {} : { label: c.label }),
    })),
    bands: { ...config.bands },
    nightMode: { ...config.nightMode },
    countdown: { emojis: [...config.countdown.emojis] },
    refreshMinutes: config.refreshMinutes,
    autoReturnSeconds: config.autoReturnSeconds,
    ...(options.editor === true ? { editor: true as const } : {}),
    ...(config.weather === undefined || config.weather === false
      ? {}
      : { weather: true as const }),
  };
}
