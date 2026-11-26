import { describe, expect, it } from "vitest";

import type { CalendarKind, Child } from "../model";
import { findFallbackIcon } from "./fallbackIcons";
import { parseTitle } from "./parseTitle";

const children: Child[] = [
  { id: "mia", name: "Mia", color: "#cc0000", avatar: "🦊" },
  { id: "ben", name: "Ben", color: "#0000cc", avatar: "🐻" },
  { id: "juergen", name: "Jürgen", color: "#008800", avatar: "🐸" },
];
const countdownEmojis = ["🎂", "🎉", "🎁", "🎄", "🐣", "✈️", "🏖️"];

function parse(
  raw: string,
  kind: CalendarKind = "events",
  description?: string,
) {
  return parseTitle(raw, {
    kind,
    children,
    countdownEmojis,
    ...(description === undefined ? {} : { description }),
  });
}

describe("leading emoji (rule 4)", () => {
  it.each([
    ["⚽ Fußball", "⚽", "Fußball"],
    ["⚽Fußball", "⚽", "Fußball"],
    ["👨‍👩‍👧 Familie", "👨‍👩‍👧", "Familie"],
    ["👋🏽 Hallo", "👋🏽", "Hallo"],
    ["🇩🇪 Deutschland", "🇩🇪", "Deutschland"],
    ["1️⃣ Eins", "1️⃣", "Eins"],
    ["☀️ Sonne", "☀️", "Sonne"],
    ["  ⚽   Fußball \t Training ", "⚽", "Fußball Training"],
  ])("%s", (raw, icon, title) => {
    expect(parse(raw)).toMatchObject({
      icon,
      title,
      iconIsFallback: false,
      isEmpty: false,
    });
  });

  it.each([
    ["Fußball ⚽", "Fußball ⚽"],
    ["© 2024 Treffen", "© 2024 Treffen"],
    ["1 Treffen", "1 Treffen"],
    ["™ Test", "™ Test"],
    ["☀ ohne VS16", "☀ ohne VS16"],
  ])("does not treat %s as leading icon", (raw, title) => {
    const result = parse(raw);
    expect(result.title).toBe(title);
    expect(result.iconIsFallback).toBe(true);
  });

  it("only takes the first emoji", () => {
    expect(parse("⚽ ⚽ Doppelt")).toMatchObject({
      icon: "⚽",
      title: "⚽ Doppelt",
    });
  });

  it("emoji only: icon set, empty title, not empty", () => {
    expect(parse("🎈")).toMatchObject({
      icon: "🎈",
      title: "",
      isEmpty: false,
      iconIsFallback: false,
    });
  });
});

describe("child prefix (rule 2)", () => {
  it.each([
    ["Mia: Ballett", ["mia"], "Ballett"],
    ["mia:Ballett", ["mia"], "Ballett"],
    ["MIA : Ballett", ["mia"], "Ballett"],
    ["Jürgen: Angeln", ["juergen"], "Angeln"],
    ["JÜRGEN: Angeln", ["juergen"], "Angeln"],
    ["Mia, Ben: Baden", ["mia", "ben"], "Baden"],
    ["Mia + Ben: Baden", ["mia", "ben"], "Baden"],
    ["Mia und Ben: Baden", ["mia", "ben"], "Baden"],
    ["Mia & Ben: Baden", ["mia", "ben"], "Baden"],
    ["Mia and Ben: Baden", ["mia", "ben"], "Baden"],
    ["Mia, Mia: Baden", ["mia"], "Baden"],
  ])("%s", (raw, ids, title) => {
    expect(parse(raw)).toMatchObject({
      childIds: ids,
      childScope: "explicit",
      title,
    });
  });

  it.each(["Alle: Kita", "All: Kita", "everyone: Kita", "ALLE:Kita"])(
    "%s means everyone (explicit, empty list)",
    (raw) => {
      expect(parse(raw)).toMatchObject({
        childIds: [],
        childScope: "explicit",
        title: "Kita",
      });
    },
  );

  it.each([
    "Tipp: Jacke mitnehmen",
    "10:30 Termin",
    "Mia, Max: Baden",
    "Mia Ben: Baden",
    "Mia und: Baden",
    "Termin: Mia",
  ])("leaves %s untouched", (raw) => {
    expect(parse(raw)).toMatchObject({
      childIds: [],
      childScope: "none",
      title: raw,
    });
  });

  it("prefix before emoji", () => {
    expect(parse("Mia: 🩰 Ballett")).toMatchObject({
      icon: "🩰",
      title: "Ballett",
      childIds: ["mia"],
    });
  });

  it("emoji before prefix", () => {
    expect(parse("🩰 Mia: Ballett")).toMatchObject({
      icon: "🩰",
      title: "Ballett",
      childIds: ["mia"],
    });
  });
});

describe("meal prefix (rule 3)", () => {
  it.each([
    ["Frühstück: Müsli", "breakfast"],
    ["Breakfast: Müsli", "breakfast"],
    ["Mittag: Suppe", "lunch"],
    ["Mittagessen: Suppe", "lunch"],
    ["MITTAGESSEN: Suppe", "lunch"],
    ["Lunch: Suppe", "lunch"],
    ["Abend: Suppe", "dinner"],
    ["Abendessen: Suppe", "dinner"],
    ["Dinner: Suppe", "dinner"],
    ["dinner:Suppe", "dinner"],
    ["Suppe", "unspecified"],
  ] as const)("%s -> %s", (raw, slot) => {
    const result = parse(raw, "meals");
    expect(result.slot).toBe(slot);
    expect(result.title).toMatch(/^(Müsli|Suppe)$/u);
  });

  it("prefix then emoji", () => {
    expect(parse("Mittag: 🍝 Spaghetti", "meals")).toMatchObject({
      icon: "🍝",
      title: "Spaghetti",
      slot: "lunch",
      iconIsFallback: false,
    });
  });

  it("emoji then prefix", () => {
    expect(parse("🍝 Mittag: Spaghetti", "meals")).toMatchObject({
      icon: "🍝",
      title: "Spaghetti",
      slot: "lunch",
    });
  });

  it("is not applied to events", () => {
    const result = parse("Mittag: Treffen", "events");
    expect(result.title).toBe("Mittag: Treffen");
    expect(result.slot).toBeUndefined();
  });

  it("child and meal prefix combined", () => {
    expect(parse("Mia: Mittag: Pizza", "meals")).toMatchObject({
      childIds: ["mia"],
      childScope: "explicit",
      slot: "lunch",
      title: "Pizza",
      icon: "🍕",
    });
  });

  it("Mittagessen is not mistaken for Mittag", () => {
    expect(parse("Mittagessen: Reis", "meals").title).toBe("Reis");
  });
});

describe("fallback icons (rule 5)", () => {
  it.each([
    ["Kita", "🏫"],
    ["Geburtstag Oma", "🎂"],
    ["Birthday party", "🎂"],
    ["Arzt", "🩺"],
    ["Doctor visit", "🩺"],
    ["Zahnarzt", "🦷"],
    ["Dentist", "🦷"],
    ["Fussball Training", "⚽"],
    ["FUßBALL", "⚽"],
    ["Schwimmen", "🏊"],
    ["Ballett", "🩰"],
    ["Klavier", "🎹"],
    ["Kino", "🎬"],
    ["Urlaub", "🏖️"],
    ["Flug nach Rom", "✈️"],
    ["Weihnachten", "🎄"],
    ["Easter brunch", "🐣"],
    ["Spielplatz", "🎠"],
    ["Playground", "🎠"],
    ["Zoo", "🦁"],
    ["Hausaufgaben", "📚"],
    ["Pizza", "🍕"],
    ["Nudeln mit Soße", "🍝"],
    ["Gemüsesuppe und Suppe", "🍲"],
    ["Salad", "🥗"],
    ["Müsli", "🥣"],
    ["MÜSLI", "🥣"],
    ["Pancakes", "🥞"],
    ["Eis", "🍦"],
    ["Hähnchen mit Reis", "🍗"],
    ["Fish", "🐟"],
  ])("%s -> %s", (raw, icon) => {
    expect(parse(raw)).toMatchObject({ icon, iconIsFallback: true });
  });

  it("uses whole words only", () => {
    expect(findFallbackIcon("Arztbesuch")).toBeUndefined();
    expect(findFallbackIcon("Reiseapotheke")).toBeUndefined();
    expect(findFallbackIcon("Zeitung")).toBeUndefined();
  });

  it("earliest keyword wins", () => {
    expect(findFallbackIcon("Pizza beim Arzt")).toBe("🍕");
    expect(findFallbackIcon("Arzt, danach Pizza")).toBe("🩺");
  });

  it("defaults: events 📅, meals 🍽️", () => {
    expect(parse("Elternabend")).toMatchObject({
      icon: "📅",
      iconIsFallback: true,
    });
    expect(parse("Überraschung", "meals")).toMatchObject({
      icon: "🍽️",
      iconIsFallback: true,
    });
  });

  it("keyword in a table example: Dinner: Pizza", () => {
    expect(parse("Dinner: Pizza", "meals")).toMatchObject({
      icon: "🍕",
      slot: "dinner",
      title: "Pizza",
    });
  });
});

describe("countdown (rule 6)", () => {
  it("icon in countdown list", () => {
    expect(parse("🎂 Mia wird 6").countdown).toBe(true);
  });
  it("VS16 differences do not matter", () => {
    const opts = { kind: "events", children, countdownEmojis: ["✈"] } as const;
    expect(parseTitle("✈️ Reise", opts).countdown).toBe(true);
    expect(parse("✈️ Flug").countdown).toBe(true);
  });
  it("fallback icon counts", () => {
    expect(parse("Geburtstag").countdown).toBe(true);
  });
  it("#countdown in description, case-insensitive", () => {
    expect(parse("Ausflug", "events", "Bald! #countdown").countdown).toBe(true);
    expect(parse("Ausflug", "events", "#COUNTDOWN").countdown).toBe(true);
    expect(parse("Ausflug", "events", "#countdownx").countdown).toBe(false);
  });
  it("false otherwise", () => {
    expect(parse("⚽ Fußball", "events", "nothing").countdown).toBe(false);
    expect(parse("⚽ Fußball").countdown).toBe(false);
  });
});

describe("empty and hostile input", () => {
  it.each(["", "   ", "\t\n ", " "])("empty %j", (raw) => {
    expect(parse(raw)).toEqual({
      title: "",
      icon: "📅",
      iconIsFallback: true,
      childIds: [],
      childScope: "none",
      countdown: false,
      isEmpty: true,
    });
  });

  it("empty meal has slot and meal icon", () => {
    expect(parse(" ", "meals")).toMatchObject({
      icon: "🍽️",
      slot: "unspecified",
      isEmpty: true,
    });
  });

  it("prefix only does not crash", () => {
    expect(parse("Mia:")).toMatchObject({
      title: "",
      childIds: ["mia"],
      isEmpty: true,
    });
    expect(parse("Mittag:", "meals")).toMatchObject({
      title: "",
      slot: "lunch",
      isEmpty: true,
    });
  });

  it.each([
    "<img src=x onerror=alert(1)>",
    "<script>alert('x')</script>",
    '&lt;b&gt; &amp; "quotes"',
  ])("returns %s verbatim", (raw) => {
    expect(parse(raw).title).toBe(raw);
  });

  it("HTML after emoji and prefix stays verbatim", () => {
    expect(parse("Mia: 🎉 <b onclick=x>Party</b>")).toMatchObject({
      title: "<b onclick=x>Party</b>",
      icon: "🎉",
    });
  });
});

describe("school subject fallback icons (T-34)", () => {
  // `Art` is also a German word ("Art der Feier"); it maps to 🎨 in both languages.
  it.each([
    ["Kunst", "🎨"],
    ["kunst", "🎨"],
    ["Art", "🎨"],
    ["Sport", "👟"],
    ["Sportunterricht", "👟"],
    ["PE", "👟"],
    ["pe", "👟"],
    ["Musik", "🎵"],
    ["Music", "🎵"],
    ["Mathe", "🔢"],
    ["Mathematik", "🔢"],
    ["Math", "🔢"],
    ["Maths", "🔢"],
    ["Deutsch", "📖"],
    ["German", "📖"],
    ["Englisch", "📖"],
    ["English", "📖"],
    ["Sachkunde", "🔬"],
    ["Sachunterricht", "🔬"],
    ["Science", "🔬"],
    ["Werken", "🔨"],
    ["Crafts", "🔨"],
    ["Schwimmunterricht", "🏊"],
    ["Schwimmen", "🏊"],
    ["Turnen", "🤸"],
    ["Schule", "🏫"],
  ])("%s -> %s", (raw, icon) => {
    expect(findFallbackIcon(raw)).toBe(icon);
    expect(parse(raw)).toMatchObject({ icon, iconIsFallback: true });
  });

  it("works in compound titles and with a child prefix", () => {
    expect(parse("Mia: Kunst AG")).toMatchObject({
      icon: "🎨",
      childIds: ["mia"],
      iconIsFallback: true,
    });
    expect(findFallbackIcon("Ben: Mathe-Nachhilfe")).toBe("🔢");
    expect(findFallbackIcon("Sport (Halle 2)")).toBe("👟");
    expect(findFallbackIcon("Englisch, 3. Stunde")).toBe("📖");
  });

  it("earliest keyword wins with several subjects", () => {
    expect(findFallbackIcon("Kunst und Sport")).toBe("🎨");
    expect(findFallbackIcon("Sport und Kunst")).toBe("👟");
    expect(findFallbackIcon("Mathe, Deutsch, Englisch")).toBe("🔢");
    expect(findFallbackIcon("Schule: Werken")).toBe("🏫");
  });

  it.each([
    "Sportplatzfest",
    "Kunststoff",
    "Kunstwerk",
    "Mathematiker",
    "Artikel",
    "Party",
    "Sportler",
    "Werkstatt",
    "Englischunterricht",
    "Peter",
  ])("no false hit inside the word %s", (raw) => {
    expect(findFallbackIcon(raw)).not.toBe("🎨");
    expect(findFallbackIcon(raw)).not.toBe("👟");
    expect(findFallbackIcon(raw)).not.toBe("🔢");
    expect(findFallbackIcon(raw)).not.toBe("📖");
    expect(findFallbackIcon(raw)).not.toBe("🔨");
  });

  it("an explicit leading emoji beats the subject keyword", () => {
    expect(parse("🧸 Kunst")).toMatchObject({
      icon: "🧸",
      iconIsFallback: false,
    });
  });

  it("no keyword maps to the bring bag 🎒", () => {
    expect(findFallbackIcon("Rucksack Schule Sport Kunst")).not.toBe("🎒");
  });
});
