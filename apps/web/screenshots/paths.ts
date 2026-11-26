import { resolve } from "node:path";

/** Where the screenshot spec writes the PNGs (committed copies are used in the READMEs). */
export const SCREENSHOT_DIR = resolve(
  import.meta.dirname,
  "../../../docs/screenshots",
);
