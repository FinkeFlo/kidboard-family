import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import {
  type AppLocale,
  type ConfigLocale,
  FALLBACK_LOCALE,
  resolveLocale,
} from "./locale";
import de from "./locales/de.json";
import en from "./locales/en.json";

export {
  APP_LOCALES,
  type AppLocale,
  type ConfigLocale,
  FALLBACK_LOCALE,
  matchLocale,
  resolveLocale,
} from "./locale";

export const resources = {
  de: { translation: de },
  en: { translation: en },
} as const;

export interface InitI18nOptions {
  /** `locale` from the config once it is known (T-13); omit before that. */
  configLocale?: ConfigLocale | undefined;
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") {
    return [];
  }
  // Older WebViews only expose `navigator.language`.
  return navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language];
}

function syncHtmlLang(locale: string): void {
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
}

/**
 * Initializes the shared i18next instance synchronously (resources are bundled, so
 * there is no network and no loading state). Call once at startup, before the first
 * render. Without `configLocale` the browser language decides; once the config has
 * been fetched call {@link applyLocale} with its `locale` to switch.
 */
export function initI18n(options: InitI18nOptions = {}): AppLocale {
  const lng = resolveLocale({
    configLocale: options.configLocale,
    browserLanguages: browserLanguages(),
  });
  if (i18next.isInitialized) {
    void i18next.changeLanguage(lng);
  } else {
    i18next.on("languageChanged", syncHtmlLang);
    void i18next.use(initReactI18next).init({
      resources,
      lng,
      fallbackLng: FALLBACK_LOCALE,
      supportedLngs: ["de", "en"],
      initAsync: false,
      // React escapes rendered text itself.
      interpolation: { escapeValue: false },
    });
  }
  syncHtmlLang(lng);
  return lng;
}

/**
 * Re-resolves the language (config locale, else browser language, else `de`) and
 * updates i18next and `<html lang>`. Pass the config's `locale` as soon as it is
 * available; `"auto"` and `undefined` both fall back to the browser language.
 */
export function applyLocale(configLocale?: ConfigLocale): AppLocale {
  const lng = resolveLocale({
    configLocale,
    browserLanguages: browserLanguages(),
  });
  void i18next.changeLanguage(lng);
  syncHtmlLang(lng);
  return lng;
}

export { default as i18n } from "i18next";
