import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { getLocales } from "expo-localization";
import en from "./locales/en.json";

// getLocales() can return an empty array in some environments (web SSR-ish
// contexts, certain test runners), so this never indexes into an empty array
// — it always resolves to a supported language instead of throwing.
const deviceLanguage = getLocales()[0]?.languageCode;
const activeLanguage = deviceLanguage === "fr" ? "fr" : "en";

// Runtime language switching isn't wired up anywhere in the app (lng is fixed
// at init), so the inactive language's ~230-entry resource bundle sat fully
// parsed and registered in memory for the whole life of the process, on the
// startup critical path, for nothing. Only the active language loads here.
//
// fallbackLng below still needs an English bundle available to fall back to
// (a translation missing from a non-English build shouldn't render as a raw
// key) — for "en" itself that's the bundle already loaded above; for any
// other active language it's registered right after init.
// A literal path in each require() (rather than a template string built from
// activeLanguage) is required — Metro resolves and bundles require() targets
// statically, so a dynamic path wouldn't be resolvable at build time. Both
// modules are still bundled either way; a literal call here only controls
// when each one's module factory actually *runs* (i.e. when its JSON gets
// parsed into an object), which is the part worth avoiding for the unused
// language.
const activeResources = activeLanguage === "en" ? en : require("./locales/fr.json");

i18n.use(initReactI18next).init({
  resources: {
    [activeLanguage]: { translation: activeResources },
  },
  lng: activeLanguage,
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

if (activeLanguage !== "en") {
  i18n.addResourceBundle("en", "translation", en);
}

export default i18n;
