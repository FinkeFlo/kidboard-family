import type { CoreConfig, Locale } from "../config";
import type { CalendarSource, MealSlot } from "../model";
import {
  type ParsedTitle,
  parseTitle,
  startsWithChildPrefix,
} from "../title/parseTitle";
import type { EditorKind } from "./entry";

/** Language of the words KidBoard writes into titles (`Alle:`/`All:`, `Mittag:`/`Lunch:`, `Mitbringen:`/`Bring:`). */
export type WriteLocale = "de" | "en";

/**
 * The locale for written conventions: an explicit `override` (e.g. the editor's UI
 * language), else the configured `locale`; `auto` falls back to German, the app's
 * fallback language. Both languages are always *read* (ADR-0005).
 */
export function resolveWriteLocale(
  configLocale: Locale,
  override?: WriteLocale,
): WriteLocale {
  return override ?? (configLocale === "en" ? "en" : "de");
}

const EVERYONE_WORD: Record<WriteLocale, string> = { de: "Alle", en: "All" };

/** Meal prefix words written per slot (all of them are read back by `parseTitle`). */
export const MEAL_PREFIX_WORDS: Record<
  WriteLocale,
  Record<Exclude<MealSlot, "unspecified">, string>
> = {
  de: { breakfast: "Frühstück", lunch: "Mittag", dinner: "Abendessen" },
  en: { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" },
};

/** The parts of an entry that make up its title. */
export interface TitleParts {
  kind: EditorKind;
  childIds: readonly string[];
  icon: string;
  title: string;
  slot?: MealSlot | undefined;
}

export interface ComposeTitleOptions {
  /** Configured calendar the event lives in (per-child calendars imply their child). */
  sourceId?: string | undefined;
  locale?: WriteLocale | undefined;
}

export type EditorCompositionErrorCode =
  | "unknown_source"
  | "unknown_child"
  | "children_not_expressible"
  | "title_not_expressible";

/** Thrown when an entry cannot be written so that `parseTitle` reads it back unchanged. */
export class EditorCompositionError extends Error {
  readonly code: EditorCompositionErrorCode;

  constructor(code: EditorCompositionErrorCode) {
    super(`Entry cannot be written as a calendar title (${code})`);
    this.name = "EditorCompositionError";
    this.code = code;
  }
}

/**
 * Children of a parsed title merged with the calendar's own child (T-09 rule, same as
 * the worker): no prefix -> the calendar's child (none = everyone); `All:` -> everyone;
 * names -> calendar child plus the named children.
 */
export function mergeSourceChildIds(
  parsed: Pick<ParsedTitle, "childIds" | "childScope">,
  source: Pick<CalendarSource, "childId">,
): string[] {
  const own = source.childId === undefined ? [] : [source.childId];
  if (parsed.childScope === "none") {
    return own;
  }
  if (parsed.childIds.length === 0) {
    return [];
  }
  return [...new Set([...own, ...parsed.childIds])];
}

/**
 * True if a calendar can hold an entry for `childIds`: shared calendars can express any
 * set; a child's calendar always includes its child (names only add children), so it
 * can express "everyone" (`Alle:`) or sets that contain its child, nothing else.
 */
export function canExpressChildren(
  childIds: readonly string[],
  source: Pick<CalendarSource, "childId">,
): boolean {
  return (
    source.childId === undefined ||
    childIds.length === 0 ||
    childIds.includes(source.childId)
  );
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const setA = new Set(a);
  return setA.size === new Set(b).size && b.every((id) => setA.has(id));
}

function findSource(
  config: CoreConfig,
  sourceId: string | undefined,
): CalendarSource | undefined {
  if (sourceId === undefined) {
    return undefined;
  }
  const source = config.calendars.find((c) => c.id === sourceId);
  if (source === undefined) {
    throw new EditorCompositionError("unknown_source");
  }
  return source;
}

/**
 * Writes the ADR-0005 title of an entry: `[children: ][meal slot: ]icon text`.
 *
 * - Events: everyone -> no prefix; children -> `Mia, Ben:` (config order). In a child's
 *   calendar its child alone -> no prefix, everyone -> `Alle:`/`All:`, several -> all
 *   names. Children a calendar cannot express ({@link canExpressChildren}) throw
 *   `children_not_expressible`.
 * - Meals: `Mittag: 🍝 Spaghetti` / `Lunch: …` (by locale), no prefix for `unspecified`.
 * - The icon always comes right before the text, so a text starting with an emoji keeps
 *   it as text. `parseTitle` consumes prefixes in any order until nothing changes; a
 *   text that itself starts with a child prefix (`Mia: …`, `Alle: …`) would be read as
 *   one, so the child part is then written explicitly (`Alle:` for everyone, the child's
 *   name in its own calendar), which stops `parseTitle` from looking for another one.
 *   A meal text starting with a meal word + colon cannot be protected when the slot is
 *   `unspecified` (there is no prefix for it).
 *
 * Every result is verified with `parseTitle`; anything that would not read back as the
 * same children, icon, title and slot throws {@link EditorCompositionError}
 * (`title_not_expressible`, e.g. that meal case or child names containing `:` or `,`).
 */
export function composeTitle(
  entry: TitleParts & { sourceId?: string | undefined },
  config: CoreConfig,
  options: ComposeTitleOptions = {},
): string {
  const locale = resolveWriteLocale(config.locale, options.locale);
  const source = findSource(config, options.sourceId ?? entry.sourceId);
  const text = entry.title.replace(/\s+/gu, " ").trim();
  const kind = entry.kind === "meal" ? "meals" : "events";

  const ordered: string[] = [];
  for (const child of config.children) {
    if (entry.childIds.includes(child.id)) {
      ordered.push(child.name);
    }
  }
  if (ordered.length !== new Set(entry.childIds).size) {
    throw new EditorCompositionError("unknown_child");
  }
  const sourceChild = entry.kind === "event" ? source?.childId : undefined;
  if (
    entry.kind === "event" &&
    !canExpressChildren(entry.childIds, { childId: sourceChild })
  ) {
    throw new EditorCompositionError("children_not_expressible");
  }

  const everyone = EVERYONE_WORD[locale];
  const escape = startsWithChildPrefix(text, config.children);
  let childPrefix: string | undefined;
  if (entry.kind === "meal") {
    childPrefix = escape ? everyone : undefined;
  } else if (entry.childIds.length === 0) {
    childPrefix = sourceChild !== undefined || escape ? everyone : undefined;
  } else if (
    sourceChild !== undefined &&
    entry.childIds.length === 1 &&
    entry.childIds[0] === sourceChild
  ) {
    childPrefix = escape ? ordered.join(", ") : undefined;
  } else {
    childPrefix = ordered.join(", ");
  }

  const slot =
    entry.kind === "meal" ? (entry.slot ?? "unspecified") : undefined;
  const mealPrefix =
    slot === undefined || slot === "unspecified"
      ? undefined
      : MEAL_PREFIX_WORDS[locale][slot];

  const parts = [
    childPrefix === undefined ? "" : `${childPrefix}: `,
    mealPrefix === undefined ? "" : `${mealPrefix}: `,
    entry.icon,
    text === "" ? "" : ` ${text}`,
  ];
  const composed = parts.join("");

  const parsed = parseTitle(composed, {
    kind,
    children: config.children,
    countdownEmojis: config.countdown.emojis,
  });
  const expectedChildren = entry.kind === "meal" ? [] : [...entry.childIds];
  const readChildren =
    entry.kind === "meal"
      ? parsed.childIds
      : mergeSourceChildIds(parsed, { childId: sourceChild });
  if (
    parsed.icon !== entry.icon ||
    parsed.iconIsFallback ||
    parsed.title !== text ||
    parsed.slot !== slot ||
    !sameSet(readChildren, expectedChildren)
  ) {
    throw new EditorCompositionError("title_not_expressible");
  }
  return composed;
}
