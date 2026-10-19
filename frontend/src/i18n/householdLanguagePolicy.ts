export const HOUSEHOLD_LANGUAGE_POLICY_VERSION = 'zh-cn-household-v2';

export const RELEASE_LANGUAGE_OPTIONS = [
  { value: 'zh', label: '简体中文', shortLabel: '中' },
  { value: 'en', label: 'English', shortLabel: 'EN' },
] as const;

export type ReleaseLanguageCode =
  (typeof RELEASE_LANGUAGE_OPTIONS)[number]['value'];

export const RELEASE_LANGUAGE_CODES = RELEASE_LANGUAGE_OPTIONS.map(
  language => language.value
);

export const normalizeReleaseLanguage = (
  language: string
): ReleaseLanguageCode => {
  const primaryLanguage = language?.split('-')[0].toLowerCase();
  return (
    RELEASE_LANGUAGE_CODES.find(candidate => candidate === primaryLanguage) ??
    'zh'
  );
};

const LANGUAGE_KEY = 'i18nextLng';
const POLICY_KEY = 'familyHealthLanguagePolicy';

type LanguageStorage = Pick<Storage, 'getItem' | 'setItem'>;
type MigrationResult = 'migrated' | 'current' | 'unavailable';

/**
 * Migrates browser language state created before the household Chinese policy.
 *
 * The marker makes this a one-time migration. Once current, a language selected
 * deliberately through the application remains untouched on later reloads.
 */
export const applyHouseholdLanguageMigration = (
  storage: LanguageStorage
): MigrationResult => {
  try {
    if (storage.getItem(POLICY_KEY) === HOUSEHOLD_LANGUAGE_POLICY_VERSION) {
      return 'current';
    }

    storage.setItem(LANGUAGE_KEY, 'zh');
    storage.setItem(POLICY_KEY, HOUSEHOLD_LANGUAGE_POLICY_VERSION);
    return 'migrated';
  } catch {
    return 'unavailable';
  }
};
