import type { ClothingItem, CustomClothingKey } from "@kidboard/shared";

import { Emoji, EMOJI_NIGHT_DIM } from "../components/Emoji";

/*
 * Own pictograms for the two items without an emoji up to the ADR-0011 baseline
 * (ADR-0015): a knitted hat (Mütze) and a sweater (Pulli). Flat, rounded, shaded on the
 * right like Noto Color Emoji, filling the em box as the emoji do, so `font-size` sizes
 * both alike. Colours come from the `--color-wear-*` design tokens (same in both themes:
 * the night dimming is the emoji's filter, applied here as well).
 */

function KnittedHat(): React.JSX.Element {
  return (
    <>
      <path
        d="M3.4 23.5C3.4 13.6 9 7.4 16 7.4S28.6 13.6 28.6 23.5Z"
        className="fill-wear-hat"
      />
      <path
        d="M16 7.4c7 0 12.6 6.2 12.6 16.1h-6.4c0-8.6-2.4-13.9-6.2-16.1Z"
        className="fill-wear-hat-shade"
      />
      <path
        d="M10 22.4c-.2-5.4 1.4-10 4.2-13.2M22 22.4c.2-5.4-1.4-10-4.2-13.2"
        fill="none"
        strokeWidth="1.4"
        strokeLinecap="round"
        className="stroke-wear-hat-band"
      />
      <rect
        x="1.6"
        y="20.6"
        width="28.8"
        height="9.6"
        rx="4.8"
        className="fill-wear-hat-band"
      />
      <path
        d="M6.6 23.2v4.4M11.1 23.2v4.4M15.6 23.2v4.4M20.1 23.2v4.4M24.6 23.2v4.4"
        strokeWidth="1.9"
        strokeLinecap="round"
        className="stroke-wear-hat"
      />
      <circle cx="16" cy="5.6" r="4.8" className="fill-wear-pompom" />
      <path
        d="M19.6 2.4a4.8 4.8 0 0 1-6.9 6.7 4.8 4.8 0 0 0 6.9-6.7Z"
        className="fill-wear-pompom-shade"
      />
    </>
  );
}

function Sweater(): React.JSX.Element {
  return (
    <>
      <path
        d="M11.6 3.2 5.4 5.3C3.4 6 2.5 7.4 2.3 9.4L.8 23.6l6.4 1.6 1.6-10.6V28.4c0 .9.7 1.6 1.6 1.6h11.2c.9 0 1.6-.7 1.6-1.6V14.6l1.6 10.6 6.4-1.6-1.5-14.2c-.2-2-1.1-3.4-3.1-4.1l-6.2-2.1c-.9 2.5-2.4 3.8-4.4 3.8s-3.5-1.3-4.4-3.8Z"
        className="fill-wear-sweater"
      />
      <path
        d="M23.2 14.6V28.4c0 .9-.7 1.6-1.6 1.6h-3c.9 0 1.6-.7 1.6-1.6V9.6ZM24.8 25.2l6.4-1.6-1.5-14.2c-.2-2-1.1-3.4-3.1-4.1l-1.6-.5c1.3 1 1.7 2.3 1.9 3.9l1.2 13.2-3.6.9Z"
        className="fill-wear-sweater-shade"
      />
      <path
        d="M1.1 21.1l6.5 1.6-.4 2.5-6.4-1.6ZM30.9 21.1l-6.5 1.6.4 2.5 6.4-1.6Z"
        strokeWidth="1"
        strokeLinejoin="round"
        className="fill-wear-sweater-rib stroke-wear-sweater-rib"
      />
      <rect
        x="8.8"
        y="25.6"
        width="14.4"
        height="4.4"
        rx="1.6"
        className="fill-wear-sweater-rib"
      />
      <path
        d="M11.6 3.2c.9 2.5 2.4 3.8 4.4 3.8s3.5-1.3 4.4-3.8"
        fill="none"
        strokeWidth="2.2"
        strokeLinecap="round"
        className="stroke-wear-sweater-rib"
      />
      <path
        d="M8.8 15.6h14.4M2 15.2l6.6 1M30 15.2l-6.6 1"
        strokeWidth="2.6"
        className="stroke-wear-sweater-stripe"
      />
    </>
  );
}

/**
 * An emoji's advance is about 1.25em (side bearings), its picture about 1em: a 1em box
 * with the glyph centred keeps the whole picture and fits more items on the line, with the
 * same footprint as the pictograms.
 */
export const EMOJI_BOX = "inline-flex w-[1em] justify-center";

const PICTOGRAMS: Record<CustomClothingKey, () => React.JSX.Element> = {
  hat: KnittedHat,
  sweater: Sweater,
};

/**
 * The one seam for clothing pictures: an emoji item through `<Emoji>`, the knitted hat and
 * the sweater as own pictograms. Always decorative (`aria-hidden`): the clothing list
 * names every item. `className` sets the size as a font size (`text-[2rem]`), for the
 * emoji and the pictogram alike; both take a 1em square ({@link EMOJI_BOX}).
 */
export function ClothingIcon({
  item,
  className = "",
}: {
  item: ClothingItem;
  className?: string;
}): React.JSX.Element {
  if (item.emoji !== undefined) {
    return <Emoji emoji={item.emoji} className={`${EMOJI_BOX} ${className}`} />;
  }
  const Pictogram = PICTOGRAMS[item.key];
  return (
    <span
      aria-hidden="true"
      data-testid="clothing-pictogram"
      data-key={item.key}
      className={`inline-flex leading-none ${EMOJI_NIGHT_DIM} ${className}`.trim()}
    >
      <svg viewBox="0 0 32 32" width="1em" height="1em" focusable="false">
        <Pictogram />
      </svg>
    </span>
  );
}
