import { EmojiSchema, isEmojiGrapheme } from "@kidboard/shared";
import emojiData from "emojibase-data/en/data.json";
import { describe, expect, it } from "vitest";

import de from "../i18n/locales/de.json";
import en from "../i18n/locales/en.json";
import {
  ACTIVITIES,
  activitiesOf,
  ACTIVITY_GROUP_IDS,
  activityById,
  BRING_ITEMS,
  DISHES,
  QUICK_PICKS,
} from "./catalogue";

/** ADR-0011: built-in icons are Emoji 13.0 or older. */
const BASELINE = 13;
const VS16 = /️/gu;

interface EmojibaseEntry {
  emoji: string;
  version: number;
  skins?: EmojibaseEntry[];
}
const VERSIONS = new Map<string, number>();
function register(entry: EmojibaseEntry): void {
  VERSIONS.set(entry.emoji.replace(VS16, ""), entry.version);
  entry.skins?.forEach(register);
}
(emojiData as EmojibaseEntry[]).forEach(register);

const ALL = [...ACTIVITIES, ...BRING_ITEMS, ...DISHES];

describe("editor catalogue (T-45)", () => {
  it("has at least 40 activities in exactly the six groups, each group filled", () => {
    expect(ACTIVITIES.length).toBeGreaterThanOrEqual(40);
    expect(ACTIVITY_GROUP_IDS).toEqual([
      "sport",
      "school",
      "play",
      "appointments",
      "outings",
      "celebrations",
    ]);
    for (const group of ACTIVITY_GROUP_IDS) {
      expect(activitiesOf(group).length, group).toBeGreaterThanOrEqual(6);
    }
    expect(
      ACTIVITY_GROUP_IDS.flatMap((group) => activitiesOf(group)),
    ).toHaveLength(ACTIVITIES.length);
  });

  it("has about 16 bring items and about 24 dishes", () => {
    expect(BRING_ITEMS).toHaveLength(16);
    expect(DISHES).toHaveLength(24);
  });

  it("uses unique ids and unique icons per list", () => {
    for (const list of [ACTIVITIES, BRING_ITEMS, DISHES]) {
      expect(new Set(list.map((item) => item.id)).size).toBe(list.length);
      expect(
        new Set(list.map((item) => item.icon.replace(VS16, ""))).size,
      ).toBe(list.length);
    }
  });

  it("every icon is one emoji accepted by EmojiSchema", () => {
    for (const item of ALL) {
      expect(EmojiSchema.safeParse(item.icon).success, item.id).toBe(true);
      expect(isEmojiGrapheme(item.icon), item.id).toBe(true);
    }
  });

  it("every icon lies within the Emoji 13.0 baseline (ADR-0011)", () => {
    const tooNew = ALL.filter((item) => {
      const version = VERSIONS.get(item.icon.replace(VS16, ""));
      return version === undefined || version > BASELINE;
    }).map((item) => item.icon);
    expect(tooNew).toEqual([]);
    // The check is real: a newer emoji would be caught.
    expect(VERSIONS.get("🛝")).toBeGreaterThan(BASELINE);
  });

  it.each([
    ["de", de],
    ["en", en],
  ] as const)("has a %s label for every group and icon", (_name, locale) => {
    for (const group of ACTIVITY_GROUP_IDS) {
      expect(locale.editor.group[group].trim()).not.toBe("");
    }
    for (const activity of ACTIVITIES) {
      expect(locale.editor.activity[activity.id].trim()).not.toBe("");
    }
    for (const item of BRING_ITEMS) {
      expect(locale.editor.bring[item.id].trim()).not.toBe("");
    }
    for (const dish of DISHES) {
      expect(locale.editor.dish[dish.id].trim()).not.toBe("");
    }
    for (const pick of QUICK_PICKS) {
      expect(locale.editor.templates.quick[pick.id].trim()).not.toBe("");
    }
  });

  it("labels fit the 60-character title limit", () => {
    for (const locale of [de, en]) {
      for (const label of [
        ...Object.values(locale.editor.activity),
        ...Object.values(locale.editor.dish),
      ]) {
        expect(label.length).toBeLessThanOrEqual(60);
      }
    }
  });

  it("quick picks: swimming weekly, birthday with countdown, dentist", () => {
    expect(
      QUICK_PICKS.map((pick) => [
        activityById(pick.activity).icon,
        pick.weekly,
        pick.countdown,
      ]),
    ).toEqual([
      ["🏊", true, false],
      ["🎂", false, true],
      ["🦷", false, false],
    ]);
    expect(() => activityById("nope" as never)).toThrow();
  });
});
