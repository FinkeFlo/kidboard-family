import { describe, expect, it } from "vitest";

import globalCss from "./global.css?raw";
import tokensCss from "./tokens.css?raw";

type TokenMap = Map<string, string>;

/** Extract the declarations of the first block that follows `selector`. */
function parseBlock(css: string, selector: string): TokenMap {
  const start = css.indexOf(selector);
  if (start === -1) {
    throw new Error(`Selector not found: ${selector}`);
  }
  const open = css.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}") depth--;
    if (depth === 0) {
      end = i;
      break;
    }
  }
  const body = css.slice(open + 1, end).replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens: TokenMap = new Map();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) {
      tokens.set(name, value.trim());
    }
  }
  return tokens;
}

const light = parseBlock(tokensCss, "@theme static {");
// The selector with its brace: the header comment mentions the selector too.
const nightOverrides = parseBlock(tokensCss, '[data-theme="night"] {');
const night: TokenMap = new Map([...light, ...nightOverrides]);

function channel(hex: string, offset: number): number {
  const v = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return (
    0.2126 * channel(hex, 1) +
    0.7152 * channel(hex, 3) +
    0.0722 * channel(hex, 5)
  );
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

function color(theme: TokenMap, name: string): string {
  const value = theme.get(name);
  if (value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(
      `Token ${name} is not a 6-digit hex colour: ${String(value)}`,
    );
  }
  return value;
}

const TEXT_AA = 4.5;
const UI_AA = 3;
const CHILD_TOKENS = [1, 2, 3, 4, 5, 6].map(
  (n) => `--color-child-${String(n)}`,
);
const CHILD_TINTS = [1, 2, 3, 4, 5, 6].map(
  (n) => `--color-child-${String(n)}-tint`,
);
const BANDS = ["morning", "midday", "evening"] as const;

/** [foreground, background, minimum ratio] pairs the components actually use. */
const PAIRS: readonly (readonly [string, string, number])[] = [
  ["--color-text", "--color-surface", TEXT_AA],
  ["--color-text", "--color-surface-raised", TEXT_AA],
  ["--color-text", "--color-surface-sunken", TEXT_AA],
  ["--color-text-muted", "--color-surface", TEXT_AA],
  ["--color-text-muted", "--color-surface-raised", TEXT_AA],
  ["--color-on-accent", "--color-accent", TEXT_AA],
  ["--color-accent", "--color-surface", TEXT_AA],
  ["--color-on-danger", "--color-danger", TEXT_AA],
  ["--color-on-notice", "--color-notice", TEXT_AA],
  ["--color-border", "--color-surface", 1.2],
  // Weekend week columns (`bg-surface-weekend`, label `text-band-morning-accent`).
  ["--color-text", "--color-surface-weekend", TEXT_AA] as const,
  ["--color-text-muted", "--color-surface-weekend", TEXT_AA] as const,
  ["--color-band-morning-accent", "--color-surface-weekend", TEXT_AA] as const,
  ["--color-accent", "--color-surface-weekend", UI_AA] as const,
  ["--color-text-muted", "--color-surface-sunken", TEXT_AA] as const,
  ["--color-accent", "--color-surface-sunken", UI_AA] as const,
  // `ring-accent` (current tile) against today's column around it.
  ["--color-accent", "--color-surface-raised", UI_AA] as const,
  // Time-of-day accents (weekend label) against the page.
  ...BANDS.map(
    (band) =>
      [`--color-band-${band}-accent`, "--color-surface", UI_AA] as const,
  ),
  // The weekend surface must stand out from the page (edge between columns).
  ["--color-surface-weekend", "--color-surface", 1.05] as const,
  ["--color-on-notice", "--color-surface", TEXT_AA] as const,
  // Fullscreen glyph (`text-control-quiet`, no opacity) in the rail's bottom slot: on the
  // page and every column surface it may sit next to, WCAG 1.4.11.
  ...[
    "--color-surface",
    "--color-surface-raised",
    "--color-surface-sunken",
    "--color-surface-weekend",
  ].map((bg) => ["--color-control-quiet", bg, UI_AA] as const),
  // Overview (T-30b): the now line and its "now" label in today's column, the "next"
  // tile's ring on every child tint, the child edge on its own tint.
  ["--color-now", "--color-surface-raised", TEXT_AA] as const,
  // "now" pill and clock cue: surface-coloured text/glyph on the "now" ink (T-27a).
  ["--color-surface", "--color-now", TEXT_AA] as const,
  ["--color-now", "--color-surface", TEXT_AA] as const,
  // Dashed outline of the next tile (now ink) on its surface-raised offset, and its ▶
  // cue: now-ink glyph and ring on a surface disc (T-27a, distinct from the today ring).
  ["--color-now", "--color-surface-raised", UI_AA] as const,
  ["--color-now", "--color-surface", UI_AA] as const,
  // Today ring around the countdown pill's surface-raised fill on its "today" (0 nights).
  ["--color-today-ring", "--color-surface-raised", UI_AA] as const,
  // Countdown target day ring in the week view (`ring-band-evening-accent`, outside the
  // column): against the page (band accents above) and the column surfaces it can
  // border (T-27a).
  ...["--color-surface-sunken", "--color-surface-weekend"].map(
    (bg) => ["--color-band-evening-accent", bg, UI_AA] as const,
  ),
  // Check mark on the "vorbei" icons: surface glyph on a muted disc (T-27a).
  ["--color-surface", "--color-text-muted", UI_AA] as const,
  ...CHILD_TINTS.map((tint) => ["--color-now", tint, UI_AA] as const),
  ...CHILD_TINTS.map(
    (tint) => [tint.replace(/-tint$/, ""), tint, UI_AA] as const,
  ),
  ["--color-danger", "--color-surface", TEXT_AA] as const,
  ...CHILD_TOKENS.flatMap((child) => [
    ["--color-on-child", child, TEXT_AA] as const,
    [child, "--color-surface", UI_AA] as const,
    [child, "--color-surface-raised", UI_AA] as const,
  ]),
  // Design hand-off pairs (docs/design/README.md): child tints, time-of-day accents,
  // today ring, nav, soft error.
  ...CHILD_TINTS.flatMap((tint) => [
    ["--color-text", tint, TEXT_AA] as const,
    ["--color-text-muted", tint, TEXT_AA] as const,
    ...BANDS.map(
      (band) => [`--color-band-${band}-accent`, tint, UI_AA] as const,
    ),
  ]),
  ["--color-today-ring", "--color-surface", UI_AA] as const,
  ["--color-on-nav-active", "--color-nav-active", TEXT_AA] as const,
  ["--color-text", "--color-soft-error", TEXT_AA] as const,
  // Error card (T-32): parent line and error code in muted text, the "reload now" button
  // (nav-active fill) against the card and the code below the card on the page.
  ["--color-text-muted", "--color-soft-error", TEXT_AA] as const,
  ["--color-nav-active", "--color-soft-error", UI_AA] as const,
  // The active view button must stand out from the inactive one and from the page.
  ["--color-nav-active", "--color-surface-raised", UI_AA] as const,
  ["--color-nav-active", "--color-surface-sunken", UI_AA] as const,
  ["--color-nav-active", "--color-surface", UI_AA] as const,
  // The 🎒 area (T-36): a `surface-sunken` row with a `border` ring inside today's
  // `surface-raised` column; its "+N" is `text-muted` on that row (above), on a child tint
  // and on the neutral group's `surface-raised` pill (both above).
  ["--color-border", "--color-surface-raised", 1.2] as const,
  // Parent editor (T-45; pairs not listed above): the chip outline on its sunken fill,
  // field errors in danger text on raised cards, muted text in a calm notice, and the
  // edge of text, date and time fields on every surface (WCAG 1.4.11).
  ["--color-border", "--color-surface-sunken", 1.1] as const,
  ["--color-danger", "--color-surface-raised", TEXT_AA] as const,
  ["--color-text-muted", "--color-notice", TEXT_AA] as const,
  ...[
    "--color-surface",
    "--color-surface-raised",
    "--color-surface-sunken",
  ].map((bg) => ["--color-input-border", bg, UI_AA] as const),
];

it("checks every contrast pair once", () => {
  const pairs = PAIRS.map(
    ([fg, bg, min]) => `${fg} on ${bg} at ${String(min)}:1`,
  );
  const repeated = pairs.filter((pair, index) => pairs.indexOf(pair) !== index);
  expect(repeated).toEqual([]);
});

describe.each([
  ["light", light],
  ["night", night],
] as const)("%s theme contrast (WCAG AA)", (_name, theme) => {
  it.each(PAIRS)("%s on %s reaches %s:1", (fg, bg, min) => {
    expect(contrast(color(theme, fg), color(theme, bg))).toBeGreaterThanOrEqual(
      min,
    );
  });
});

/** A black glyph, and a white one after the night dimming of `<Emoji>` (brightness 0.75). */
const BLACK_GLYPH = "#000000";
const DIMMED_WHITE_GLYPH = "#bfbfbf";

describe("bring chip disc (--color-chip, T-35/T-36)", () => {
  it.each([
    ["light", light],
    ["night", night],
  ] as const)("%s: a black glyph stays visible on it (>= 3:1)", (_n, theme) => {
    expect(
      contrast(BLACK_GLYPH, color(theme, "--color-chip")),
    ).toBeGreaterThanOrEqual(UI_AA);
  });

  it("night: a dimmed white glyph stays visible on it too (>= 3:1)", () => {
    expect(
      contrast(DIMMED_WHITE_GLYPH, color(night, "--color-chip")),
    ).toBeGreaterThanOrEqual(UI_AA);
  });

  it("night: the disc is lighter than every surface and tint it sits on and stands out (>= 2:1)", () => {
    const chip = color(night, "--color-chip");
    for (const bg of [
      "--color-surface",
      "--color-surface-raised",
      "--color-surface-sunken",
      ...CHILD_TINTS,
    ]) {
      expect(luminance(chip), bg).toBeGreaterThan(luminance(color(night, bg)));
      expect(contrast(chip, color(night, bg)), bg).toBeGreaterThanOrEqual(2);
    }
  });

  it("the probes are real colours (negative case: the old dark disc failed)", () => {
    expect(contrast(BLACK_GLYPH, "#1b1611")).toBeLessThan(UI_AA);
  });
});

/** sRGB hex → OKLab (Björn Ottosson's reference matrices). */
function toOklab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((o) => channel(hex, o)) as [
    number,
    number,
    number,
  ];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab → sRGB hex (clamped). */
function fromOklab([L, A, B]: [number, number, number]): string {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${linear
    .map((v) => {
      const c = Math.min(1, Math.max(0, v));
      const srgb = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
      return Math.round(srgb * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

/** `color-mix(in oklab, a <weight>, b)`. */
function mixOklab(a: string, b: string, weight: number): string {
  const [x, y] = [toOklab(a), toOklab(b)];
  return fromOklab([
    x[0] * weight + y[0] * (1 - weight),
    x[1] * weight + y[1] * (1 - weight),
    x[2] * weight + y[2] * (1 - weight),
  ]);
}

describe("clothing pictogram colours (--color-wear-*, ADR-0015)", () => {
  const wear = [...light.keys()].filter((k) => k.startsWith("--color-wear-"));

  it("defines the hat and sweater parts", () => {
    expect(wear).toEqual(
      expect.arrayContaining([
        "--color-wear-hat",
        "--color-wear-hat-shade",
        "--color-wear-hat-band",
        "--color-wear-pompom",
        "--color-wear-sweater",
        "--color-wear-sweater-rib",
        "--color-wear-sweater-stripe",
      ]),
    );
  });

  it("keeps them unchanged at night (the emoji filter dims them, like every emoji)", () => {
    for (const name of wear) {
      expect(color(night, name).toLowerCase(), name).toBe(
        color(light, name).toLowerCase(),
      );
    }
  });

  /** `brightness(0.75)` of the night emoji filter: every sRGB channel times 0.75. */
  const dimmed = (hex: string): string =>
    `#${[1, 3, 5]
      .map((i) =>
        Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.75)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  const backgrounds = ["--color-surface-sunken", "--color-surface-raised"];

  it("light: the hat's cuff and the sweater's ribs stand out from the pill and the column", () => {
    for (const part of ["--color-wear-hat-band", "--color-wear-sweater-rib"]) {
      for (const bg of backgrounds) {
        expect(
          contrast(color(light, part), color(light, bg)),
          `${part} on ${bg}`,
        ).toBeGreaterThanOrEqual(UI_AA);
      }
    }
  });

  it("night: the dimmed hat and sweater bodies stand out from the dark pill and column", () => {
    expect(dimmed("#ffffff")).toBe(DIMMED_WHITE_GLYPH);
    for (const part of ["--color-wear-hat", "--color-wear-sweater"]) {
      for (const bg of backgrounds) {
        expect(
          contrast(dimmed(color(night, part)), color(night, bg)),
          `${part} on ${bg}`,
        ).toBeGreaterThanOrEqual(UI_AA);
      }
    }
  });
});

describe("night dimming of child colours (avatars, tile edges)", () => {
  it("round-trips OKLab (the mix helper itself is exact)", () => {
    for (const hex of ["#000000", "#ffffff", "#56b4e9", "#c2410c"]) {
      expect(mixOklab(hex, hex, 0.75)).toBe(hex);
    }
  });

  it("uses the 75 % strength in every night class", async () => {
    const { CHILD_EDGE, CHILD_EDGE_AFTER, CHILD_FILL, CHILD_NIGHT_STRENGTH } =
      await import("../components/childColor");
    const percent = `_${String(CHILD_NIGHT_STRENGTH * 100)}%,var(--color-surface)`;
    for (const cls of [CHILD_EDGE, CHILD_EDGE_AFTER, CHILD_FILL]) {
      expect(cls).toContain(`color-mix(in_oklab,var(--child-color)${percent})`);
    }
  });

  it.each(CHILD_TOKENS)(
    "%s, dimmed a quarter at night, keeps >= 3:1 on the page, raised surface and its tint",
    (child) => {
      const surface = color(night, "--color-surface");
      const dimmed = mixOklab(color(night, child), surface, 0.75);
      // Visibly dimmer than the full colour.
      expect(luminance(dimmed)).toBeLessThan(luminance(color(night, child)));
      for (const bg of [
        "--color-surface",
        "--color-surface-raised",
        "--color-surface-sunken",
        `${child}-tint`,
      ]) {
        expect(contrast(dimmed, color(night, bg)), bg).toBeGreaterThanOrEqual(
          UI_AA,
        );
      }
    },
  );
});

describe("token blocks", () => {
  it("reads the real night block, not the light one", () => {
    expect(nightOverrides.size).toBeGreaterThan(10);
    expect(color(night, "--color-surface")).not.toBe(
      color(light, "--color-surface"),
    );
    expect(nightOverrides.has("--font-sans")).toBe(false);
  });
});

describe("token structure", () => {
  it("defines at least 6 distinct child colors in both themes", () => {
    for (const theme of [light, night]) {
      const values = CHILD_TOKENS.map((t) => color(theme, t).toLowerCase());
      expect(new Set(values).size).toBe(CHILD_TOKENS.length);
    }
  });

  it("overrides only known tokens in night mode and every colour token", () => {
    for (const name of nightOverrides.keys()) {
      expect(light.has(name), `${name} missing in light set`).toBe(true);
    }
    const lightColors = [...light.keys()].filter((k) =>
      k.startsWith("--color-"),
    );
    for (const name of lightColors) {
      if (name === "--color-*") continue;
      expect(nightOverrides.has(name), `${name} not defined for night`).toBe(
        true,
      );
    }
  });

  it("defines the time-of-day accents, radii, shadows, sizes and durations", () => {
    for (const band of BANDS) {
      expect(light.has(`--color-band-${band}-accent`)).toBe(true);
    }
    for (const prefix of ["--radius-", "--shadow-", "--text-", "--duration-"]) {
      expect([...light.keys()].some((k) => k.startsWith(prefix))).toBe(true);
    }
  });

  it("defines spacing and a touch target of at least 64px", () => {
    expect(light.get("--spacing")).toBe("0.25rem");
    expect(light.has("--spacing-gutter")).toBe(true);
    expect(light.has("--spacing-page")).toBe(true);
    const touch = light.get("--spacing-touch");
    expect(touch).toMatch(/^max\(64px,\s*4rem\)$/);
  });

  it("defines a parent touch target of at least 48px (editor, M11)", () => {
    expect(light.get("--spacing-touch-parent")).toMatch(
      /^max\(48px,\s*3rem\)$/,
    );
  });

  it("keeps the burn-in amplitude well below the gutter (both rem based, so at every root size)", () => {
    const rem = (name: string): number => {
      const value = light.get(name) ?? "";
      expect(value, name).toMatch(/^\d+(\.\d+)?rem$/);
      return parseFloat(value);
    };
    const burnIn = rem("--spacing-burn-in");
    expect(burnIn).toBeGreaterThan(0);
    expect(burnIn).toBeLessThanOrEqual(rem("--spacing-gutter") / 2);
    // "A few px": 8 px at the 16 px root of 1280x800, 12 px at the 24 px root of 2000x1200.
    expect(burnIn * 16).toBeLessThanOrEqual(12);
  });

  it("disables transition and animation durations for reduced motion", () => {
    expect(tokensCss).toMatch(
      /prefers-reduced-motion:\s*reduce\)\s*\{\s*:root\s*\{[^}]*--duration-normal:\s*0ms/,
    );
    expect(globalCss).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(globalCss).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(globalCss).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
  });

  it("defines a matching child colour for every child tint, in both themes", () => {
    for (const theme of [light, night]) {
      const tints = [...theme.keys()].filter((k) =>
        /^--color-child-\d+-tint$/.test(k),
      );
      expect(tints).toHaveLength(CHILD_TOKENS.length);
      for (const tint of tints) {
        const base = tint.replace(/-tint$/, "");
        expect(theme.has(base), `${tint} has no ${base}`).toBe(true);
        expect(color(theme, base).toLowerCase()).not.toBe(
          color(theme, tint).toLowerCase(),
        );
      }
    }
  });

  it("removed the legacy band surfaces and the band tile size (T-30b)", () => {
    for (const name of [
      ...BANDS.map((band) => `--color-band-${band}`),
      "--spacing-band-tile",
    ]) {
      expect(light.has(name), name).toBe(false);
      expect(nightOverrides.has(name), name).toBe(false);
    }
  });

  it("keeps a weekend column surface with AA text, muted text and label in both themes", () => {
    for (const theme of [light, night]) {
      const bg = color(theme, "--color-surface-weekend");
      expect(
        contrast(bg, color(theme, "--color-surface")),
        "distinct from page",
      ).toBeGreaterThan(1.05);
      for (const fg of [
        "--color-text",
        "--color-text-muted",
        "--color-band-morning-accent",
      ]) {
        expect(contrast(color(theme, fg), bg), fg).toBeGreaterThanOrEqual(
          TEXT_AA,
        );
      }
    }
  });

  it("keeps the night active nav button clearly above the inactive one and the page (>= 3:1)", () => {
    const active = color(night, "--color-nav-active");
    for (const bg of [
      "--color-surface-raised",
      "--color-surface-sunken",
      "--color-surface",
    ]) {
      expect(contrast(active, color(night, bg)), bg).toBeGreaterThanOrEqual(
        UI_AA,
      );
    }
  });

  it("marks --opacity-past* as not for text: blended text fails AA and no component uses them", () => {
    // Blended contrast of text at the past opacity over the sunken column: documents why.
    const blend = (fg: string, bg: string, alpha: number): string => {
      const mix = (o: number): string =>
        Math.round(
          parseInt(fg.slice(o, o + 2), 16) * alpha +
            parseInt(bg.slice(o, o + 2), 16) * (1 - alpha),
        )
          .toString(16)
          .padStart(2, "0");
      return `#${mix(1)}${mix(3)}${mix(5)}`;
    };
    for (const [theme, token] of [
      [light, "--opacity-past"],
      [night, "--opacity-past-night"],
    ] as const) {
      const alpha = parseFloat(theme.get(token) ?? "");
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThan(1);
      const text = color(theme, "--color-text");
      const bg = color(theme, "--color-surface-sunken");
      expect(contrast(blend(text, bg, alpha), bg), token).toBeLessThan(TEXT_AA);
    }
    const sources = import.meta.glob<string>("../**/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    });
    for (const [file, source] of Object.entries(sources)) {
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
      expect(source, file).not.toMatch(/opacity-past/);
    }
  });

  it("keeps components free of raw hex colours", () => {
    const sources = import.meta.glob<string>("../**/*.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    });
    expect(Object.keys(sources).length).toBeGreaterThan(0);
    for (const [file, source] of Object.entries(sources)) {
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
