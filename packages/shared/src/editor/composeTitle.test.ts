import { describe, expect, it } from "vitest";

import type { MealSlot } from "../model";
import { parseTitle } from "../title/parseTitle";
import {
  canExpressChildren,
  composeTitle,
  EditorCompositionError,
  mergeSourceChildIds,
  resolveWriteLocale,
  type TitleParts,
  type WriteLocale,
} from "./composeTitle";
import { editorTestConfig } from "./testConfig.test-utils";

const config = editorTestConfig();

function event(
  title: string,
  childIds: string[] = [],
  icon = "🏊",
): TitleParts {
  return { kind: "event", childIds, icon, title };
}

function meal(title: string, slot: MealSlot, icon = "🍝"): TitleParts {
  return { kind: "meal", childIds: [], icon, title, slot };
}

function compose(
  parts: TitleParts,
  sourceId?: string,
  locale?: WriteLocale,
): string {
  return composeTitle(parts, config, { sourceId, locale });
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof EditorCompositionError ? error.code : "other";
  }
  return undefined;
}

describe("composeTitle conventions (ADR-0005)", () => {
  it.each<[TitleParts, string | undefined, WriteLocale, string]>([
    [event("Schwimmen", ["mia"]), "kinder", "de", "Mia: 🏊 Schwimmen"],
    [
      event("Baden", ["ben", "mia"], "🛁"),
      "kinder",
      "de",
      "Mia, Ben: 🛁 Baden",
    ],
    [event("Kita", [], "🏫"), "kinder", "de", "🏫 Kita"],
    [event("Kita", [], "🏫"), undefined, "de", "🏫 Kita"],
    [event("Fußball", ["ben"], "⚽"), "ben-cal", "de", "⚽ Fußball"],
    [
      event("Baden", ["ben", "mia"], "🛁"),
      "ben-cal",
      "de",
      "Mia, Ben: 🛁 Baden",
    ],
    [event("Ausflug", [], "🚌"), "ben-cal", "de", "Alle: 🚌 Ausflug"],
    [event("Ausflug", [], "🚌"), "ben-cal", "en", "All: 🚌 Ausflug"],
    [meal("Spaghetti", "lunch"), "essen", "de", "Mittag: 🍝 Spaghetti"],
    [meal("Spaghetti", "lunch"), "essen", "en", "Lunch: 🍝 Spaghetti"],
    [meal("Müsli", "breakfast", "🥣"), "essen", "de", "Frühstück: 🥣 Müsli"],
    [meal("Pizza", "dinner", "🍕"), "essen", "en", "Dinner: 🍕 Pizza"],
    [meal("Pizza", "dinner", "🍕"), "essen", "de", "Abendessen: 🍕 Pizza"],
    [meal("Müsli", "unspecified", "🥣"), "essen", "de", "🥣 Müsli"],
  ])("%j in %s (%s) -> %s", (parts, sourceId, locale, expected) => {
    expect(compose(parts, sourceId, locale)).toBe(expected);
  });

  it("normalises whitespace like parseTitle", () => {
    expect(compose(event("  viel \t  Platz ", ["mia"]))).toBe(
      "Mia: 🏊 viel Platz",
    );
  });

  it("uses the config locale, auto falls back to German", () => {
    expect(resolveWriteLocale("en")).toBe("en");
    expect(resolveWriteLocale("de")).toBe("de");
    expect(resolveWriteLocale("auto")).toBe("de");
    expect(resolveWriteLocale("auto", "en")).toBe("en");
    const en = editorTestConfig({ locale: "en" });
    expect(composeTitle(meal("Soup", "lunch", "🍲"), en)).toBe(
      "Lunch: 🍲 Soup",
    );
  });
});

describe("composeTitle escapes titles that would be misparsed", () => {
  it.each<[TitleParts, string | undefined, string]>([
    // text starting with a child name + colon, everyone -> explicit "Alle:"
    [event("Mia: Geheimnis"), "kinder", "Alle: 🏊 Mia: Geheimnis"],
    [event("alle: zusammen"), "kinder", "Alle: 🏊 alle: zusammen"],
    [
      event("Jürgen und Ben: Spiel"),
      "kinder",
      "Alle: 🏊 Jürgen und Ben: Spiel",
    ],
    // the calendar's own child -> its name instead of no prefix
    [event("Ben: Besuch", ["mia"]), "mia-cal", "Mia: 🏊 Ben: Besuch"],
    // explicit children already stop the search
    [event("Ben: Besuch", ["mia"]), "kinder", "Mia: 🏊 Ben: Besuch"],
    // meal word in an event title is just text
    [event("Mittag: Treffen"), "kinder", "🏊 Mittag: Treffen"],
    // emoji at the start of the text stays text (the icon comes first)
    [event("🎉 Party", ["mia"]), "kinder", "Mia: 🏊 🎉 Party"],
    // unknown names / colons elsewhere need nothing
    [event("Tipp: Uhrzeit 10:30"), "kinder", "🏊 Tipp: Uhrzeit 10:30"],
    // meals: child-like text -> "Alle:" in front; meal word after a slot prefix is text
    [
      meal("Mia: Lieblingsessen", "lunch"),
      "essen",
      "Alle: Mittag: 🍝 Mia: Lieblingsessen",
    ],
    [
      meal("Mia: Lieblingsessen", "unspecified"),
      "essen",
      "Alle: 🍝 Mia: Lieblingsessen",
    ],
    [
      meal("Frühstück: Reste", "dinner"),
      "essen",
      "Abendessen: 🍝 Frühstück: Reste",
    ],
  ])("%j in %s -> %s", (parts, sourceId, expected) => {
    expect(compose(parts, sourceId)).toBe(expected);
  });

  it("rejects what cannot read back the same", () => {
    // no prefix exists for an unspecified slot
    expect(
      codeOf(() => compose(meal("Mittag: Reste", "unspecified"), "essen")),
    ).toBe("title_not_expressible");
    // a child's calendar always implies its child
    expect(codeOf(() => compose(event("x", ["ben"]), "mia-cal"))).toBe(
      "children_not_expressible",
    );
    expect(codeOf(() => compose(event("x", ["nobody"]), "kinder"))).toBe(
      "unknown_child",
    );
    expect(codeOf(() => compose(event("x"), "nope"))).toBe("unknown_source");
    const odd = editorTestConfig({
      children: [{ id: "x", name: "Ann: B", color: "#cc0000", avatar: "🦊" }],
      calendars: [{ id: "kinder", kind: "events" }],
    });
    expect(
      codeOf(() =>
        composeTitle(event("x", ["x"]), odd, { sourceId: "kinder" }),
      ),
    ).toBe("title_not_expressible");
  });
});

describe("composeTitle round trip", () => {
  const titles = [
    "Schwimmen",
    "Mia: Geheimnis",
    "mia,ben: zusammen",
    "Alle: zusammen",
    "Everyone: hi",
    "Jürgen und Ben: Spiel",
    "Émile: Bonjour",
    "Anna-Lena: Geburtstag",
    "Mittag: Treffen",
    "lunch: later",
    "Frühstück: Brötchen",
    "Uhrzeit 10:30 Uhr",
    "a:b:c",
    ":Doppelpunkt",
    "🎉 Party",
    "👨‍👩‍👧 Familie",
    "  viel   Platz  ",
    "#countdown",
    "Größe Übung ÄÖÜ ß",
    "x",
  ];
  const icons = ["🏊", "👨‍👩‍👧", "👋🏽", "☀️", "🇩🇪", "1️⃣", "🏳️‍🌈", "🎂"];
  const childSets = [
    [],
    ["mia"],
    ["juergen"],
    ["mia", "ben"],
    ["emile", "anna", "juergen"],
    ["ben"],
  ];
  const eventSources = ["kinder", "mia-cal", "juergen-cal"];
  const slots: MealSlot[] = ["breakfast", "lunch", "dinner", "unspecified"];
  const locales: WriteLocale[] = ["de", "en"];
  const MEAL_WORD =
    /^(frühstück|breakfast|mittagessen|mittag|lunch|abendessen|abend|dinner)\s*:/iu;

  type Case = { parts: TitleParts; sourceId: string; locale: WriteLocale };
  const cases: Case[] = [];
  for (const title of titles) {
    for (const icon of icons) {
      for (const locale of locales) {
        for (const sourceId of eventSources) {
          for (const childIds of childSets) {
            cases.push({
              parts: event(title, childIds, icon),
              sourceId,
              locale,
            });
          }
        }
        for (const slot of slots) {
          cases.push({
            parts: meal(title, slot, icon),
            sourceId: "essen",
            locale,
          });
        }
      }
    }
  }

  it(`reads back children, icon, title and slot for ${String(cases.length)} generated inputs`, () => {
    let written = 0;
    for (const { parts, sourceId, locale } of cases) {
      const source = config.calendars.find((c) => c.id === sourceId);
      if (source === undefined) {
        throw new Error("fixture");
      }
      const normalized = parts.title.replace(/\s+/gu, " ").trim();
      const expressible =
        parts.kind === "meal"
          ? !(parts.slot === "unspecified" && MEAL_WORD.test(normalized))
          : canExpressChildren(parts.childIds, source);
      const label = JSON.stringify({ parts, sourceId, locale });
      if (!expressible) {
        expect(
          codeOf(() => compose(parts, sourceId, locale)),
          label,
        ).toBeDefined();
        continue;
      }
      const raw = compose(parts, sourceId, locale);
      const parsed = parseTitle(raw, {
        kind: source.kind,
        children: config.children,
        countdownEmojis: config.countdown.emojis,
      });
      const children =
        parts.kind === "meal"
          ? parsed.childIds
          : mergeSourceChildIds(parsed, source);
      expect(
        {
          icon: parsed.icon,
          iconIsFallback: parsed.iconIsFallback,
          title: parsed.title,
          slot: parsed.slot,
          children: [...children].sort(),
        },
        `${label} -> ${raw}`,
      ).toEqual({
        icon: parts.icon,
        iconIsFallback: false,
        title: normalized,
        slot: parts.kind === "meal" ? parts.slot : undefined,
        children: [...parts.childIds].sort(),
      });
      written += 1;
    }
    // Guard against a generator that silently skips everything.
    expect(written).toBeGreaterThan(cases.length * 0.7);
  });
});

describe("mergeSourceChildIds / canExpressChildren", () => {
  it("merges like the worker (T-09)", () => {
    expect(
      mergeSourceChildIds({ childScope: "none", childIds: [] }, {}),
    ).toEqual([]);
    expect(
      mergeSourceChildIds(
        { childScope: "none", childIds: [] },
        { childId: "mia" },
      ),
    ).toEqual(["mia"]);
    expect(
      mergeSourceChildIds(
        { childScope: "explicit", childIds: [] },
        { childId: "mia" },
      ),
    ).toEqual([]);
    expect(
      mergeSourceChildIds(
        { childScope: "explicit", childIds: ["ben", "mia"] },
        { childId: "mia" },
      ),
    ).toEqual(["mia", "ben"]);
  });

  it.each<[string[], string | undefined, boolean]>([
    [[], undefined, true],
    [["ben"], undefined, true],
    [[], "mia", true],
    [["mia"], "mia", true],
    [["mia", "ben"], "mia", true],
    [["ben"], "mia", false],
    [["ben", "juergen"], "mia", false],
  ])("%j in calendar of %s -> %s", (childIds, childId, expected) => {
    expect(
      canExpressChildren(childIds, childId === undefined ? {} : { childId }),
    ).toBe(expected);
  });
});

describe("composeTitle without configured calendars (app entries)", () => {
  const appOnly = editorTestConfig({ calendars: [] });

  it("writes the same titles as with calendars", () => {
    expect(composeTitle(event("Schwimmen", ["mia"]), appOnly)).toBe(
      compose(event("Schwimmen", ["mia"])),
    );
    expect(
      composeTitle(meal("Suppe", "lunch", "🍲"), appOnly, { locale: "de" }),
    ).toBe("Mittag: 🍲 Suppe");
  });

  it("rejects a calendar id the config does not list", () => {
    expect(
      codeOf(() => composeTitle(event("x"), appOnly, { sourceId: "kinder" })),
    ).toBe("unknown_source");
  });
});
