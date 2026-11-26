import { isEmojiGrapheme } from "@kidboard/shared";
import emojiData from "emojibase-data/en/data.json";
import { describe, expect, it } from "vitest";

/** Emoji version baseline of every built-in icon (ADR-0011: Emoji 13.0, Android 11). */
const BASELINE = 13;

interface EmojibaseEntry {
  emoji: string;
  version: number;
  skins?: EmojibaseEntry[];
}

const VS16 = /️/gu;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const VERSIONS = new Map<string, number>();
function register(entry: EmojibaseEntry): void {
  VERSIONS.set(entry.emoji.replace(VS16, ""), entry.version);
  entry.skins?.forEach(register);
}
(emojiData as EmojibaseEntry[]).forEach(register);

function tooNew(text: string): string[] {
  const bad: string[] = [];
  for (const { segment } of segmenter.segment(text)) {
    if (!isEmojiGrapheme(segment)) {
      continue;
    }
    const version = VERSIONS.get(segment.replace(VS16, ""));
    if (version === undefined || version > BASELINE) {
      bad.push(segment);
    }
  }
  return bad;
}

// All non-test sources of the UI (rail, states, time-of-day icons, countdown, error card)
// and the demo data; any emoji literal there is a built-in icon.
const sources = import.meta.glob<string>(
  [
    "./**/*.{ts,tsx}",
    "../demo/**/*.ts",
    "!./**/*.test.{ts,tsx}",
    "!../demo/**/*.test.ts",
  ],
  { query: "?raw", import: "default", eager: true },
);

describe("UI emoji baseline (ADR-0011)", () => {
  it("scans real sources", () => {
    const names = Object.keys(sources);
    expect(names.some((n) => n.endsWith("TimeOfDayIcon.tsx"))).toBe(true);
    expect(names.some((n) => n.endsWith("DayStates.tsx"))).toBe(true);
    expect(names.some((n) => n.endsWith("demoData.ts"))).toBe(true);
    expect(names.some((n) => n.endsWith(".test.ts"))).toBe(false);
  });

  it("every emoji in UI and demo sources is Emoji 13.0 or older", () => {
    const offenders: Record<string, string[]> = {};
    for (const [name, text] of Object.entries(sources)) {
      const bad = tooNew(text);
      if (bad.length > 0) {
        offenders[name] = bad;
      }
    }
    expect(offenders).toEqual({});
  });

  it("detects emoji newer than the baseline (negative case)", () => {
    expect(tooNew('<Emoji emoji="🪈" />')).toEqual(["🪈"]);
    expect(tooNew("🛝")).toEqual(["🛝"]);
    expect(tooNew("🌅 🌞 🌆 🌙 ☀️ 🧸 🪁 🎒")).toEqual([]);
  });
});
