import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { getLocales } from "expo-localization";
import en from "./locales/en.json";

export const APP_LANGUAGES = ["en", "fr", "de", "es", "it"] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];

// "system" follows the device locale (and keeps following it if the user
// changes their phone's language later); anything else pins the app.
export type LanguagePreference = AppLanguage | "system";

// Endonyms: each language names itself, in every UI language — a French
// speaker picking German looks for "Deutsch", not "Allemand". These are
// deliberately not translation keys.
export const LANGUAGE_LABELS: Record<AppLanguage, string> = {
  en: "English",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  it: "Italiano",
};

export function isAppLanguage(value: unknown): value is AppLanguage {
  return APP_LANGUAGES.includes(value as AppLanguage);
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "system" || isAppLanguage(value);
}

// getLocales() can return an empty array in some environments (web SSR-ish
// contexts, certain test runners), so this never indexes into an empty array
// — it always resolves to a supported language instead of throwing.
export function resolveDeviceLanguage(): AppLanguage {
  const deviceLanguage = getLocales()[0]?.languageCode;
  return isAppLanguage(deviceLanguage) ? deviceLanguage : "en";
}

export function resolveLanguage(preference: LanguagePreference): AppLanguage {
  return preference === "system" ? resolveDeviceLanguage() : preference;
}

// A literal path in each require() (rather than a template string built from
// the language code) is required — Metro resolves and bundles require()
// targets statically, so a dynamic path wouldn't be resolvable at build time.
// Every module is bundled either way; a literal call here only controls when
// each one's module factory actually *runs* (i.e. when its JSON gets parsed
// into an object), which is the part worth avoiding for languages the user
// never selects.
function loadBundle(language: AppLanguage): object {
  switch (language) {
    case "fr":
      return require("./locales/fr.json");
    case "de":
      return require("./locales/de.json");
    case "es":
      return require("./locales/es.json");
    case "it":
      return require("./locales/it.json");
    case "en":
      return en;
  }
}

// Registers a language's ~236-entry bundle the first time it's actually
// needed, so a launch only ever parses the active language plus the English
// fallback. Repeat switches back to an already-visited language are free.
function ensureBundle(language: AppLanguage): void {
  if (!i18n.hasResourceBundle(language, "translation")) {
    i18n.addResourceBundle(language, "translation", loadBundle(language));
  }
}

// The persisted preference lives in SQLite and can only be read once the
// database is open, so startup renders in the device language first and the
// store's init() applies the stored choice a moment later. react-i18next
// re-renders every useTranslation consumer on the languageChanged event, so
// that correction — and every later switch from the settings screen — needs
// no restart and no manual invalidation.
export async function applyLanguage(preference: LanguagePreference): Promise<void> {
  const language = resolveLanguage(preference);
  if (i18n.language === language) return;
  ensureBundle(language);
  await i18n.changeLanguage(language);
}

const initialLanguage = resolveDeviceLanguage();

i18n.use(initReactI18next).init({
  resources: {
    [initialLanguage]: { translation: loadBundle(initialLanguage) },
  },
  lng: initialLanguage,
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

// fallbackLng needs an English bundle available to fall back to (a translation
// missing from a non-English build shouldn't render as a raw key) — for "en"
// itself that's the bundle already registered above.
ensureBundle("en");

export default i18n;
