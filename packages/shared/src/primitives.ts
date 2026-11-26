import emojiRegex from "emoji-regex";
import { z } from "zod";

/** Calendar date `YYYY-MM-DD`. */
export const DateStringSchema = z.iso.date();

/** ISO 8601 date-time that carries an offset (`Z` or `+02:00`). */
export const DateTimeStringSchema = z.iso.datetime({ offset: true });

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Time of day `HH:mm` (24 h, zero padded). */
export const TimeOfDaySchema = z
  .string()
  .regex(HH_MM, 'Expected time as "HH:mm" (00:00-23:59)');

/** Minutes since midnight of an `HH:mm` string. Throws a `RangeError` if malformed. */
export function minutesOfTime(time: string): number {
  if (!HH_MM.test(time)) {
    throw new RangeError("time must be HH:mm");
  }
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** Slug used for child and calendar ids: lower case letters, digits, `_` and `-`. */
export const SlugSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9_-]{0,31}$/,
    "Expected 1-32 characters of a-z, 0-9, '_' or '-', starting with a letter or digit",
  );

/** Returns true if `timeZone` is an IANA zone known to the runtime (Node, browsers, workerd). */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.trim() === "") {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** IANA time zone name such as `Europe/Berlin`. */
export const TimeZoneSchema = z.string().refine(isValidTimeZone, {
  message: "Expected a valid IANA time zone, e.g. Europe/Berlin",
});

// emoji-regex v11 emits a non-`u` pattern (surrogate pairs); keep flags empty.
const EMOJI_EXACT = new RegExp(`^(?:${emojiRegex().source})$`);
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;

/**
 * True if `grapheme` (one grapheme cluster) is an emoji that should be rendered as a picture.
 * `emoji-regex` also matches text-style symbols such as `©`, `™` or a bare `☀`; those are
 * rejected here unless they are a multi-code-point sequence (VS16 `☀️`, keycap `1️⃣`, flag,
 * ZWJ, skin tone) or have emoji presentation by default (`⚽`).
 */
export function isEmojiGrapheme(grapheme: string): boolean {
  if (!EMOJI_EXACT.test(grapheme)) {
    return false;
  }
  const firstCodePoint = grapheme.codePointAt(0) ?? 0;
  const isSingleCodePoint =
    grapheme.length === (firstCodePoint > 0xffff ? 2 : 1);
  return !isSingleCodePoint || EMOJI_PRESENTATION.test(grapheme);
}

/** True if `value` is exactly one grapheme cluster that is an emoji (see {@link isEmojiGrapheme}). */
export function isSingleEmoji(value: string): boolean {
  const graphemes = [
    ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
      value,
    ),
  ];
  return graphemes.length === 1 && isEmojiGrapheme(value);
}

/** A single emoji (one grapheme cluster, ZWJ sequences and flags allowed). */
export const EmojiSchema = z
  .string()
  .refine(isSingleEmoji, { message: "Expected a single emoji" });
