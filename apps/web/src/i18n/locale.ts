/** UI languages bundled with the app. */
export const APP_LOCALES = ["de", "en"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

/** Used when neither the config nor the browser names a supported language. */
export const FALLBACK_LOCALE: AppLocale = "de";

/** The `locale` option of the KidBoard config (`auto` = follow the browser). */
export type ConfigLocale = AppLocale | "auto";

function isAppLocale(value: string): value is AppLocale {
  return (APP_LOCALES as readonly string[]).includes(value);
}

/** Maps a BCP 47 tag such as `de-AT` or `EN_us` to a bundled locale, if any. */
export function matchLocale(tag: string): AppLocale | undefined {
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return isAppLocale(primary) ? primary : undefined;
}

export interface ResolveLocaleOptions {
  /** `locale` from the config; `undefined` while the config is not loaded yet. */
  configLocale?: ConfigLocale | undefined;
  /** Preferred browser languages, most preferred first (`navigator.languages`). */
  browserLanguages?: readonly string[] | undefined;
}

/**
 * Language precedence: explicit config locale, else the first supported browser
 * language, else `de`.
 */
export function resolveLocale(options: ResolveLocaleOptions = {}): AppLocale {
  const { configLocale, browserLanguages = [] } = options;
  if (configLocale !== undefined && configLocale !== "auto") {
    return configLocale;
  }
  for (const tag of browserLanguages) {
    const match = matchLocale(tag);
    if (match) {
      return match;
    }
  }
  return FALLBACK_LOCALE;
}
