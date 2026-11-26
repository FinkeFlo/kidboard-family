import type de from "./locales/de.json";

// Typed translation keys: `de` is the reference shape (a test asserts that `en`
// has exactly the same keys).
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof de };
  }
}
