import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import i18next from "eslint-plugin-i18next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    "**/dist/**",
    "**/.wrangler/**",
    "**/coverage/**",
    "**/test-results/**",
    "**/playwright-report/**",
    "**/blob-report/**",
    "**/playwright/.cache/**",
    "**/worker-configuration.d.ts",
  ]),
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "simple-import-sort": simpleImportSort },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
    },
  },
  {
    // Plain JS config files are not part of any tsconfig project.
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    extends: [
      react.configs.flat.recommended,
      react.configs.flat["jsx-runtime"],
      reactHooks.configs.flat.recommended,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: { globals: globals.browser },
    settings: { react: { version: "detect" } },
    rules: {
      // Calendar titles are untrusted text (CLAUDE.md): never inject HTML.
      "react/no-danger": "error",
    },
  },
  {
    // Guard against hard-coded UI strings: JSX text and JSX attribute values must go
    // through i18n. Only emoji-only strings are allowed. Tests render fixtures, not UI.
    files: ["apps/web/src/**/*.tsx"],
    ignores: ["**/*.test.tsx"],
    extends: [i18next.configs["flat/recommended"]],
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-only",
          words: {
            // Emoji-only strings (surrogate pairs, ZWJ, variation selector, BMP symbols).
            exclude: [
              "^[\\uD800-\\uDBFF\\uDC00-\\uDFFF\\u200D\\uFE0F\\u2600-\\u27BF\\s]+$",
            ],
          },
        },
      ],
    },
  },
  {
    files: [
      "apps/web/vite.config.ts",
      "apps/web/vitest.config.ts",
      "apps/web/playwright.config.ts",
      "apps/web/playwright.screenshots.config.ts",
      "apps/web/pwa-assets.config.ts",
      "apps/web/pwa/**/*.ts",
      "apps/web/demo/**/*.ts",
      "apps/web/screenshots/**/*.ts",
      "apps/web/e2e/**/*.ts",
      "apps/worker/**/*.ts",
    ],
    languageOptions: { globals: globals.node },
  },
);
