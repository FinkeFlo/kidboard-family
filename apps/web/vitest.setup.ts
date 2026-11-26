import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { initI18n } from "./src/i18n";

// Deterministic UI language for all tests, independent of the jsdom navigator.
initI18n({ configLocale: "en" });

afterEach(() => {
  cleanup();
});
