import { isEmojiGrapheme } from "../primitives";

/** At most this many icons per event (ADR-0010); the rest is dropped server-side. */
export const BRING_MAX = 8;

/**
 * Only the first 8 192 UTF-16 code units of a description are scanned (ADR-0010); this
 * bounds the work for any input size.
 */
export const BRING_SCAN_LIMIT = 8 * 1024;

/** Only graphemes that start within the first 500 code units of a bring line are read. */
export const BRING_LINE_LIMIT = 500;

/** Start tag of an element whose content is code or styling, never visible text. */
const RAW_TEXT_OPEN = /<(script|style)\b/giu;
const RAW_TEXT_CLOSE: Record<string, RegExp> = {
  script: /<\/script\s*>/giu,
  style: /<\/style\s*>/giu,
};
/** HTML line boundaries of formatted descriptions; each counts as a line break. */
const HTML_LINE_BREAK = /<br\s*(?:\/\s*)?>|<\/(?:p|div|li)\s*>/giu;
/**
 * Any other tag (within one line) is removed. `[^<>\r\n]*` stops at the next `<`, so a run
 * of unclosed `<` stays linear; a plain-text `<` on one line cannot swallow later lines.
 */
const HTML_TAG = /<[^<>\r\n]*>/gu;
/** The few entities that matter for finding line starts and keywords (one pass, no double decoding). */
const HTML_ENTITY = /&(?:nbsp|#160|#x0*a0|amp);/giu;
const LINE_BREAK = /\r\n|[\n\r\u2028\u2029]/u;
/**
 * Every line boundary of a raw description as one pattern (text breaks and the HTML
 * breaks above, same lines as the matching here); used by the editor to replace lines
 * in place. Global: reset `lastIndex` or use `split`/`matchAll`.
 */
export const DESCRIPTION_LINE_BOUNDARY =
  /\r\n|[\n\r\u2028\u2029]|<br\s*(?:\/\s*)?>|<\/(?:p|div|li)\s*>/giu;
/**
 * Line start: optional whitespace and bullets, keyword, optional whitespace, colon. No
 * nested quantifiers; the keyword must be directly followed by `\s*:` (whole word).
 */
const BRING_KEYWORD = /^[\s*•-]*(?:mitbringen|bring)\s*:/iu;
const VS16 = /\uFE0F/gu;

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function decodeEntity(entity: string): string {
  return entity.toLowerCase() === "&amp;" ? "&" : " ";
}

/**
 * `[start, end)` ranges of the closed `<script>`/`<style>` elements of `text` (with their
 * content; emoji in code are not part of any line). One forward pass: every search
 * starts after the previous match; once no closing tag of a kind is found, that kind is
 * not searched again (none can follow), so the work stays linear. An unclosed start tag
 * yields no range (it is removed later with the other tags).
 */
export function rawTextElementRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const unclosed = new Set<string>();
  let searchFrom = 0;
  for (;;) {
    RAW_TEXT_OPEN.lastIndex = searchFrom;
    const open = RAW_TEXT_OPEN.exec(text);
    if (open === null) {
      break;
    }
    searchFrom = open.index + open[0].length;
    const kind = (open[1] ?? "").toLowerCase();
    const close = RAW_TEXT_CLOSE[kind];
    if (close === undefined || unclosed.has(kind)) {
      continue;
    }
    close.lastIndex = searchFrom;
    const end = close.exec(text);
    if (end === null) {
      unclosed.add(kind);
      continue;
    }
    ranges.push([open.index, end.index + end[0].length]);
    searchFrom = end.index + end[0].length;
  }
  return ranges;
}

/** Removes `<script>`/`<style>` elements with their content (see {@link rawTextElementRanges}). */
function dropRawTextElements(text: string): string {
  let out = "";
  let pos = 0;
  for (const [start, end] of rawTextElementRanges(text)) {
    out += text.slice(pos, start);
    pos = end;
  }
  return out + text.slice(pos);
}

/**
 * Plain text of one line of a raw description (a piece between two line boundaries):
 * tags removed, `&nbsp;`/`&amp;` decoded. For matching only, never rendered.
 */
export function descriptionLineText(rawLine: string): string {
  return rawLine.replace(HTML_TAG, "").replace(HTML_ENTITY, decodeEntity);
}

/** True if one raw description line (see {@link descriptionLineText}) is a bring line. */
export function isBringLine(rawLine: string): boolean {
  return BRING_KEYWORD.test(
    descriptionLineText(rawLine).slice(0, BRING_LINE_LIMIT),
  );
}

/** Plain-text lines of a (possibly HTML-formatted) description; only used for matching. */
function toLines(description: string): string[] {
  return dropRawTextElements(description.slice(0, BRING_SCAN_LIMIT))
    .replace(HTML_LINE_BREAK, "\n")
    .replace(HTML_TAG, "")
    .replace(HTML_ENTITY, decodeEntity)
    .split(LINE_BREAK);
}

/**
 * Icons of the `Mitbringen:` / `Bring:` lines of an event description (ADR-0010,
 * ARCHITECTURE.md "Title conventions" rule 7).
 *
 * A bring line starts (after optional whitespace and `-`, `*`, `•` bullets) with
 * `Mitbringen` or `Bring` (case-insensitive) followed by `:`. Of every bring line only
 * emoji graphemes are kept (words, digits, punctuation and text-style symbols such as
 * `©` are dropped), in order, deduplicated (compared without VS16, first occurrence
 * wins) and capped at {@link BRING_MAX}. Simple HTML (`<br>`, `</p>`, `</div>`, `</li>`
 * as line breaks, other tags removed, `&nbsp;`/`&amp;`) is understood for matching only;
 * nothing is ever rendered. Work is bounded ({@link BRING_SCAN_LIMIT},
 * {@link BRING_LINE_LIMIT}). Pure, never throws; returns `[]` if nothing matches.
 */
export function parseBringList(description: string | undefined): string[] {
  if (typeof description !== "string" || description === "") {
    return [];
  }
  const icons: string[] = [];
  const seen = new Set<string>();
  for (const line of toLines(description)) {
    const match = BRING_KEYWORD.exec(line.slice(0, BRING_LINE_LIMIT));
    if (match === null) {
      continue;
    }
    const offset = match[0].length;
    for (const { segment, index } of segmenter.segment(line.slice(offset))) {
      if (offset + index >= BRING_LINE_LIMIT) {
        break;
      }
      const key = segment.replace(VS16, "");
      // A redundant VS16 after an emoji-presentation character (`👟\uFE0F`) is not
      // matched as one emoji; such a grapheme is kept without it. Text-style symbols
      // that need VS16 (`☀️`) are kept as typed.
      const icon = isEmojiGrapheme(segment)
        ? segment
        : key !== segment && isEmojiGrapheme(key)
          ? key
          : undefined;
      if (icon === undefined || seen.has(key)) {
        continue;
      }
      seen.add(key);
      icons.push(icon);
      if (icons.length === BRING_MAX) {
        return icons;
      }
    }
  }
  return icons;
}
