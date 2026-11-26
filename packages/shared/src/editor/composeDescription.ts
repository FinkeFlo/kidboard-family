import {
  DESCRIPTION_LINE_BOUNDARY,
  descriptionLineText,
  isBringLine,
  parseBringList,
  rawTextElementRanges,
} from "../title/parseBringList";
import { COUNTDOWN_TAG } from "../title/parseTitle";
import type { WriteLocale } from "./composeTitle";

export interface ComposeDescriptionOptions {
  /** Bring icons in order (each a single emoji, unique, at most `BRING_MAX`). */
  bring: readonly string[];
  /**
   * `true`: the description must carry the `#countdown` marker; `false`: it must not;
   * `undefined`: leave the marker as it is (used when the icon itself is a countdown
   * emoji, which already makes the entry a countdown).
   */
  countdown?: boolean | undefined;
  locale: WriteLocale;
}

/** The marker the editor writes (read case-insensitively by `parseTitle`). */
export const COUNTDOWN_MARKER = "#countdown";

/** Bring keyword written per locale (both are read by `parseBringList`). */
export const BRING_KEYWORD_WORDS: Record<WriteLocale, string> = {
  de: "Mitbringen",
  en: "Bring",
};

const COUNTDOWN_TAG_ALL = new RegExp(
  `(?:[ \\t]|&nbsp;)?${COUNTDOWN_TAG.source}`,
  "giu",
);
const HTML_TAG_ALL = /<[^<>\r\n]*>/gu;
const LEADING_TAGS = /^(?:<[^<>\r\n]*>)*/u;
const SOFT_BOUNDARY = /^(?:\r\n|[\n\r\u2028\u2029]|<br\s*(?:\/\s*)?>)$/iu;
const HARD_BOUNDARY = /^<\/(p|div|li)\s*>$/iu;
const OPENING_BLOCK_TAG = /^<(p|div|li)(?:\s[^<>]*)?>$/iu;
const HTML_HINT =
  /<(?:br|p|div|li|span|b|i|u|strong|em|a|ul|ol|style|script)\b[^<>]*>/iu;

interface Line {
  text: string;
  /** The boundary after `text` ("" for the last line). */
  boundary: string;
  /** Inside a `<script>`/`<style>` element: never a line of its own for the reader. */
  rawText: boolean;
}

function splitLines(description: string): Line[] {
  const ranges = rawTextElementRanges(description);
  const inRawText = (index: number): boolean =>
    ranges.some(([start, end]) => index >= start && index < end);
  const lines: Line[] = [];
  let pos = 0;
  for (const match of description.matchAll(DESCRIPTION_LINE_BOUNDARY)) {
    lines.push({
      text: description.slice(pos, match.index),
      boundary: match[0],
      rawText: inRawText(pos) || inRawText(match.index),
    });
    pos = match.index + match[0].length;
  }
  lines.push({
    text: description.slice(pos),
    boundary: "",
    rawText: inRawText(pos),
  });
  return lines;
}

const isBlank = (rawLine: string): boolean =>
  descriptionLineText(rawLine).trim() === "";

/**
 * Removes the visible text of `lines[i]` (keeping its tags so the HTML stays well
 * formed) and the line break that becomes redundant: its own soft break (`\n`, `<br>`),
 * else the previous line's soft break, else an element that is left empty (`<p></p>`).
 */
function removeLine(lines: Line[], i: number): void {
  const line = lines[i];
  if (line === undefined) {
    return;
  }
  const tags = (line.text.match(HTML_TAG_ALL) ?? []).join("");
  line.text = tags;
  const previous = lines[i - 1];
  if (SOFT_BOUNDARY.test(line.boundary)) {
    line.boundary = "";
    return;
  }
  if (
    tags === "" &&
    previous !== undefined &&
    SOFT_BOUNDARY.test(previous.boundary)
  ) {
    previous.boundary = "";
    return;
  }
  const open = OPENING_BLOCK_TAG.exec(tags);
  const close = HARD_BOUNDARY.exec(line.boundary);
  if (
    open !== null &&
    close !== null &&
    open[1]?.toLowerCase() === close[1]?.toLowerCase()
  ) {
    line.text = "";
    line.boundary = "";
  }
}

function join(lines: readonly Line[]): string {
  return lines.map((line) => line.text + line.boundary).join("");
}

function sameIcons(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((icon, i) => icon === b[i]);
}

/**
 * Writes the editor's bring list and countdown marker into an event description
 * (ADR-0010, ADR-0012) and keeps everything else byte for byte:
 *
 * - Nothing to change (same bring icons, marker state as wanted) -> `existing` as is.
 * - Bring lines (`Mitbringen:`/`Bring:` lines as `parseBringList` sees them, outside
 *   `<script>`/`<style>`) are replaced: the first one in place (its HTML tags kept),
 *   the others removed with their line break. Without an old bring line, the new one
 *   (`Mitbringen: 👟 🩱` / `Bring: …` by locale) is appended as its own line (`<br>`
 *   in HTML descriptions, `\n` otherwise) or, if that would fall outside the reader's
 *   scan window, prepended. Empty `bring` -> no bring line.
 * - Free text on a replaced or removed bring line (words, a `#countdown` on it) is
 *   dropped with the old icons; only the new icons are written.
 * - `countdown: false` removes every `#countdown` marker, also inside `<script>`/
 *   `<style>` (a line left empty is removed); `true` appends a `#countdown` line if the
 *   rewritten text has none; `undefined` keeps the previous marker state (re-appended
 *   as its own line if it sat on a rewritten bring line).
 *
 * Guarantees `parseBringList(result)` equals `bring` and the marker state matches
 * `countdown`. An empty description with nothing to add stays `""`. Pure, never throws.
 */
export function composeDescription(
  existing: string | undefined,
  options: ComposeDescriptionOptions,
): string {
  const description = existing ?? "";
  const bring = [...options.bring];
  const bringChanged = !sameIcons(parseBringList(description), bring);
  const hasMarker = COUNTDOWN_TAG.test(description);
  // `undefined` keeps the previous marker state, even if its line is rewritten.
  const wantMarker = options.countdown ?? hasMarker;
  const removeMarker = !wantMarker && hasMarker;
  if (!bringChanged && wantMarker === hasMarker) {
    return description;
  }

  const lines = splitLines(description);
  const bringLine = `${BRING_KEYWORD_WORDS[options.locale]}: ${bring.join(" ")}`;
  let bringWritten = !bringChanged || bring.length === 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) {
      continue;
    }
    if (bringChanged && !line.rawText && isBringLine(line.text)) {
      if (bringWritten) {
        removeLine(lines, i);
      } else {
        // Replace the first bring line in place, keeping its markup around it.
        const leading = LEADING_TAGS.exec(line.text)?.[0] ?? "";
        const rest = (
          line.text.slice(leading.length).match(HTML_TAG_ALL) ?? []
        ).join("");
        line.text = `${leading}${bringLine}${rest}`;
        bringWritten = true;
      }
      continue;
    }
    if (removeMarker && COUNTDOWN_TAG.test(line.text)) {
      const wasBlank = isBlank(line.text);
      // Removing one marker can expose another (`#countdown#countdown`); bounded.
      for (let pass = 0; pass < 8 && COUNTDOWN_TAG.test(line.text); pass += 1) {
        line.text = line.text.replace(COUNTDOWN_TAG_ALL, "");
      }
      if (!wasBlank && isBlank(line.text) && !line.rawText) {
        removeLine(lines, i);
      }
    }
  }

  let result = join(lines);
  const separator = HTML_HINT.test(description) ? "<br>" : "\n";
  const append = (text: string, line: string): string => {
    if (text === "") {
      return line;
    }
    const last = splitLines(text).at(-1);
    const endsWithBreak = last !== undefined && last.text === "" && text !== "";
    return endsWithBreak ? `${text}${line}` : `${text}${separator}${line}`;
  };
  if (
    bringChanged &&
    bringWritten &&
    bring.length > 0 &&
    !sameIcons(parseBringList(result), bring)
  ) {
    // The replaced line lies outside the reader's scan window: also put it first.
    result = `${bringLine}${separator}${result}`;
  }
  if (!bringWritten) {
    const appended = append(result, bringLine);
    // Prepend only when the appended line would land outside the reader's scan window
    // (very long descriptions): the first line is always read.
    result = sameIcons(parseBringList(appended), bring)
      ? appended
      : `${bringLine}${separator}${result}`;
  }
  // Decided on the rewritten text: a marker on a replaced or removed bring line is gone.
  if (wantMarker && !COUNTDOWN_TAG.test(result)) {
    result = append(result, COUNTDOWN_MARKER);
  }
  return result;
}
