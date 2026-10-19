import { describe, expect, it } from 'vitest';
import {
  HOUSEHOLD_LANGUAGE_POLICY_VERSION,
  applyHouseholdLanguageMigration,
} from './householdLanguagePolicy';

const createStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
};

describe('applyHouseholdLanguageMigration', () => {
  it('migrates a legacy English browser profile to Chinese once', () => {
    const storage = createStorage({ i18nextLng: 'en' });

    expect(applyHouseholdLanguageMigration(storage)).toBe('migrated');
    expect(storage.values.get('i18nextLng')).toBe('zh');
    expect(storage.values.get('familyHealthLanguagePolicy')).toBe(
      HOUSEHOLD_LANGUAGE_POLICY_VERSION
    );
  });

  it('initializes an absent browser language as Chinese', () => {
    const storage = createStorage();

    expect(applyHouseholdLanguageMigration(storage)).toBe('migrated');
    expect(storage.values.get('i18nextLng')).toBe('zh');
  });

  it('preserves an explicit selection after the policy marker is current', () => {
    const storage = createStorage({
      i18nextLng: 'en',
      familyHealthLanguagePolicy: HOUSEHOLD_LANGUAGE_POLICY_VERSION,
    });

    expect(applyHouseholdLanguageMigration(storage)).toBe('current');
    expect(storage.values.get('i18nextLng')).toBe('en');
  });

  it('fails safely when browser storage is unavailable', () => {
    const unavailableStorage = {
      getItem: () => {
        throw new Error('storage blocked');
      },
      setItem: () => {
        throw new Error('storage blocked');
      },
    };

    expect(applyHouseholdLanguageMigration(unavailableStorage)).toBe(
      'unavailable'
    );
  });
});
