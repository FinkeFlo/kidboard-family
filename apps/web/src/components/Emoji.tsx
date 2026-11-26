/**
 * Single seam for emoji rendering (ADR-0009): native system emoji today, an asset set
 * later. With a `label` the emoji is an image for assistive tech (`role="img"`);
 * without one it is purely decorative and hidden from them.
 *
 * Night mode dims every emoji here, never in the callers (design hand-off:
 * `filter: brightness(0.75) saturate(0.8)` under `[data-theme="night"]`). The Tailwind
 * filter utilities compose, so a caller's `grayscale` (past events) still applies.
 */
export interface EmojiProps {
  emoji: string;
  /** Accessible name, e.g. the event title. Omit when text next to it says the same. */
  label?: string | undefined;
  className?: string;
}

/** The night dimming of every emoji (and of the own clothing pictograms, ADR-0015). */
export const EMOJI_NIGHT_DIM = "night:brightness-75 night:saturate-80";

/** Base classes of every emoji: emoji font, no extra line box, dimmed at night. */
export const EMOJI_CLASS = `font-emoji leading-none ${EMOJI_NIGHT_DIM}`;

export function Emoji({
  emoji,
  label,
  className = "",
}: EmojiProps): React.JSX.Element {
  const labelled = label !== undefined && label.trim() !== "";
  return (
    <span
      role={labelled ? "img" : undefined}
      aria-label={labelled ? label : undefined}
      aria-hidden={labelled ? undefined : true}
      className={`${EMOJI_CLASS} ${className}`.trim()}
    >
      {emoji}
    </span>
  );
}
