import {
  defineConfig,
  minimal2023Preset,
} from "@vite-pwa/assets-generator/config";

import { readPwaColors } from "./pwa/tokenColors";

/**
 * PWA icon generation (vite-plugin-pwa `pwaAssets`, run on every `vite build`).
 * Source: the original artwork in public/kidboard-icon.svg. Maskable and Apple icons are
 * padded with the token accent colour, the icon's own background, so the safe-zone
 * padding blends into the artwork.
 */
const { theme } = readPwaColors();

export default defineConfig({
  headLinkOptions: { preset: "2023" },
  preset: {
    ...minimal2023Preset,
    maskable: {
      ...minimal2023Preset.maskable,
      resizeOptions: { background: theme },
    },
    apple: {
      ...minimal2023Preset.apple,
      resizeOptions: { background: theme },
    },
  },
  images: ["public/kidboard-icon.svg"],
});
