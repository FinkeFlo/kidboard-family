import type { CalendarKind, Child, MealSlot } from "../model";
import { isEmojiGrapheme } from "../primitives";
import {
  DEFAULT_EVENT_ICON,
  DEFAULT_MEAL_ICON,
  findFallbackIcon,
} from "./fallbackIcons";

export interface ParseTitleOptions {
  kind: CalendarKind;
  children: readonly Child[];
  /** Icons that mark a countdown event (`config.countdown.emojis`). */
  countdownEmojis: readonly string[];
  /** Event description; `#countdown` (case-insensitive) sets the countdown flag. */
  description?: string;
}

export interface ParsedTitle {
  /** Plain text (never HTML), whitespace collapsed. */
  title: string;
  icon: string;
  iconIsFallback: boolean;
  /**
   * Children named by the title prefix. Empty for `childScope: 'none'` and for `All:`.
   *
   * Merging with the source `childId` (T-09): `childScope: 'none'` -> use the source
   * `childId` (none configured = everyone). `'explicit'` with ids -> union of source
   * `childId` and these ids. `'explicit'` with no ids (`All:`) -> everyone; this overrides
   * the source `childId`.
   */
  childIds: string[];
  childScope: "explicit" | "none";
  /** Meals only. */
  slot?: MealSlot;
  countdown: boolean;
  /** True if nothing is left (no title text and no emoji) - the icon is then a placeholder. */
  isEmpty: boolean;
}

const ALL_WORDS = new Set(["alle", "all", "everyone"]);
const NAME_SEPARATOR = /\s*,\s*|\s*[+&]\s*|\s+(?:und|and)\s+/iu;
const MEAL_PREFIX =
  /^(frühstück|breakfast|mittagessen|mittag|lunch|abendessen|abend|dinner)\s*:\s*/iu;
/** The `#countdown` description marker (whole word, case-insensitive; no `g` flag, safe for `.test`). */
export const COUNTDOWN_TAG = /(?<![\p{L}\p{N}_])#countdown(?![\p{L}\p{N}_])/iu;
const VS16 = /️/gu;

const MEAL_SLOTS: Record<string, MealSlot> = {
  frühstück: "breakfast",
  breakfast: "breakfast",
  mittagessen: "lunch",
  mittag: "lunch",
  lunch: "lunch",
  abendessen: "dinner",
  abend: "dinner",
  dinner: "dinner",
};

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function key(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

function firstGrapheme(value: string): string {
  const first = segmenter.segment(value)[Symbol.iterator]().next();
  return first.done === true ? "" : first.value.segment;
}

type ChildPrefix = { ids: string[]; rest: string };

/** `Mia, Ben: rest` / `Alle: rest`; undefined if the part before the first colon is not purely known names. */
function matchChildPrefix(
  text: string,
  children: readonly Child[],
): ChildPrefix | undefined {
  const colon = text.indexOf(":");
  if (colon <= 0) {
    return undefined;
  }
  const names = text
    .slice(0, colon)
    .split(NAME_SEPARATOR)
    .map((name) => key(name.trim()));
  const ids: string[] = [];
  let everyone = false;
  for (const name of names) {
    const child = children.find((c) => key(c.name) === name);
    if (child !== undefined) {
      if (!ids.includes(child.id)) {
        ids.push(child.id);
      }
    } else if (ALL_WORDS.has(name)) {
      everyone = true;
    } else {
      return undefined;
    }
  }
  return {
    ids: everyone ? [] : ids,
    rest: text.slice(colon + 1).trim(),
  };
}

/**
 * True if `text` starts with a child prefix that {@link parseTitle} would consume
 * (`Mia: …`, `Mia, Ben: …`, `Alle: …`). Used by the editor to escape such titles.
 */
export function startsWithChildPrefix(
  text: string,
  children: readonly Child[],
): boolean {
  return matchChildPrefix(text, children) !== undefined;
}

function normalizeEmoji(value: string): string {
  return value.replace(VS16, "");
}

/**
 * Parses a raw calendar `SUMMARY` following ARCHITECTURE.md "Title conventions".
 * Prefixes (child, meal) and one leading emoji may appear in any order, e.g.
 * `Mia: 🩰 Ballett` or `🍝 Mittag: Spaghetti`. Pure, never throws.
 */
export function parseTitle(raw: string, opts: ParseTitleOptions): ParsedTitle {
  let rest = raw.replace(/\s+/gu, " ").trim();
  let childIds: string[] = [];
  let childScope: ParsedTitle["childScope"] = "none";
  let slot: MealSlot | undefined =
    opts.kind === "meals" ? "unspecified" : undefined;
  let mealDone = false;
  let emoji: string | undefined;

  for (let progress = true; progress;) {
    progress = false;
    if (childScope === "none") {
      const prefix = matchChildPrefix(rest, opts.children);
      if (prefix !== undefined) {
        childScope = "explicit";
        childIds = prefix.ids;
        rest = prefix.rest;
        progress = true;
      }
    }
    if (opts.kind === "meals" && !mealDone) {
      const match = MEAL_PREFIX.exec(rest);
      const word = match?.[1];
      if (match !== null && word !== undefined) {
        slot = MEAL_SLOTS[key(word)] ?? "unspecified";
        mealDone = true;
        rest = rest.slice(match[0].length).trim();
        progress = true;
      }
    }
    if (emoji === undefined) {
      const grapheme = firstGrapheme(rest);
      if (grapheme !== "" && isEmojiGrapheme(grapheme)) {
        emoji = grapheme;
        rest = rest.slice(grapheme.length).trim();
        progress = true;
      }
    }
  }

  const title = rest;
  const isEmpty = title === "" && emoji === undefined;
  const defaultIcon =
    opts.kind === "meals" ? DEFAULT_MEAL_ICON : DEFAULT_EVENT_ICON;
  const icon = emoji ?? findFallbackIcon(title) ?? defaultIcon;

  const countdownIcons = new Set(opts.countdownEmojis.map(normalizeEmoji));
  const countdown =
    countdownIcons.has(normalizeEmoji(icon)) ||
    COUNTDOWN_TAG.test(opts.description ?? "");

  const parsed: ParsedTitle = {
    title,
    icon,
    iconIsFallback: emoji === undefined,
    childIds,
    childScope,
    countdown,
    isEmpty,
  };
  if (slot !== undefined) {
    parsed.slot = slot;
  }
  return parsed;
}
