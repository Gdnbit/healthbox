// Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';
import { isDevelopment } from '../config/env';
import logger from '../services/logger';
import { applyHouseholdLanguageMigration } from './householdLanguagePolicy';

// Bundle Chinese and English so a fresh household deployment starts in Chinese without
// waiting for an HTTP locale request, while English remains available as a safe fallback.
// @ts-expect-error - virtual module provided by Vite plugin
import bundledLocales from 'virtual:bundled-core-locales';

const resources = bundledLocales as Record<
  string,
  Record<string, Record<string, unknown>>
>;
const namespaces = Object.keys(resources.en);

if (typeof window !== 'undefined') {
  applyHouseholdLanguageMigration(window.localStorage);
}

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    // A fresh household install starts in Chinese. Other explicitly selected
    // languages fall back to English rather than unexpectedly showing Chinese.
    fallbackLng: code =>
      !code || code.startsWith('zh') ? ['zh', 'en'] : ['en'],
    debug: isDevelopment(),

    // Only load the primary language code (e.g., 'en' not 'en-US')
    // This ensures i18n.language always matches our supported language codes
    load: 'languageOnly',

    // Chinese and English are bundled inline; other languages load via HTTP backend.
    partialBundledLanguages: true,
    resources,

    ns: namespaces,
    defaultNS: 'common',

    // Report missing keys in development; runtime falls back through Chinese then English.
    saveMissing: false,
    missingKeyHandler: (lngs, ns, key) => {
      if (isDevelopment()) {
        logger.warn('i18n_missing_translation_key', {
          namespace: ns,
          key,
          language: lngs[0],
          component: 'i18n',
        });
      }
    },

    interpolation: {
      escapeValue: false,
    },

    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },

    detection: {
      order: ['localStorage'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },

    react: {
      useSuspense: true,
      // Re-render components when translations are added to the store.
      // The default ('') means components never update after late-arriving translations,
      // causing keys to persist in the UI until page reload.
      bindI18nStore: 'added removed',
      // Include 'languageChanging' so Suspense activates the moment a language switch starts.
      // This makes hasLoadedNamespace's precheck return false during an in-flight change,
      // guaranteeing the UI suspends until the new language's resources are loaded. Without
      // this, transitioning from a fully-loaded language (e.g. bundled English) to an
      // HTTP-loaded language could leave components silently rendering the old language.
      bindI18n: 'languageChanging languageChanged',
    },
  });

export default i18n;
