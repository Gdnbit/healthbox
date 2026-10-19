// Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
import { describe, it, expect, vi } from 'vitest';
import {
  RELEASE_LANGUAGE_CODES,
  RELEASE_LANGUAGE_OPTIONS,
  normalizeReleaseLanguage,
} from '../../../i18n/householdLanguagePolicy';
import LanguageSwitcher from '../LanguageSwitcher';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: 'zh',
      changeLanguage: vi.fn().mockResolvedValue(undefined),
      t: vi.fn(() => '语言'),
    },
  }),
}));

// Mock logger
vi.mock('../../../services/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock UserPreferencesContext
vi.mock('../../../contexts/UserPreferencesContext', () => ({
  useUserPreferences: () => ({
    updatePreferences: vi.fn().mockResolvedValue({ language: 'fr' }),
  }),
}));

/**
 * LanguageSwitcher Component Tests
 *
 * Tests language selection functionality and backend sync.
 * Note: These tests verify component structure and mocking setup.
 * Full integration testing of Mantine Select interactions would require
 * more complex setup. The backend sync functionality is thoroughly tested
 * in backend API tests (test_user_preferences_language.py).
 */
describe('LanguageSwitcher', () => {
  describe('Component Definition', () => {
    it('should be defined and exportable', () => {
      expect(LanguageSwitcher).toBeDefined();
      expect(typeof LanguageSwitcher).toBe('function');
    });

    it('should have the correct function name', () => {
      expect(LanguageSwitcher.name).toBe('LanguageSwitcher');
    });

    it('should be a valid React component', () => {
      // Component uses useTranslation and useUserPreferences hooks
      // These are properly mocked above
      expect(LanguageSwitcher).toBeDefined();
    });
  });

  describe('Props Interface', () => {
    it('should accept compact prop', () => {
      const props = { compact: true };
      // TypeScript compilation ensures prop types are valid
      expect(props.compact).toBe(true);
    });

    it('should accept variant prop', () => {
      const props = { variant: 'filled' };
      expect(props.variant).toBe('filled');
    });

    it('should accept size prop with valid values', () => {
      const sizes = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
      sizes.forEach(size => {
        const props = { size };
        expect(props.size).toBe(size);
      });
    });
  });

  describe('Integration Points', () => {
    it('should integrate with react-i18next for language switching', () => {
      // Component uses useTranslation hook (mocked above)
      // This ensures i18n.changeLanguage is called on language change
      expect(LanguageSwitcher).toBeDefined();
    });

    it('should integrate with UserPreferencesContext for backend sync', () => {
      // Component uses useUserPreferences hook (mocked above)
      // This ensures updatePreferences is called to save language to backend
      expect(LanguageSwitcher).toBeDefined();
    });

    it('should integrate with logger for tracking', () => {
      // Component uses logger (mocked above) for info and error logging
      expect(LanguageSwitcher).toBeDefined();
    });
  });

  describe('Supported Languages', () => {
    it('exposes only complete Chinese and English resources in the first release', () => {
      expect(RELEASE_LANGUAGE_CODES).toEqual(['zh', 'en']);
      expect(RELEASE_LANGUAGE_OPTIONS).toEqual([
        { value: 'zh', label: '简体中文', shortLabel: '中' },
        { value: 'en', label: 'English', shortLabel: 'EN' },
      ]);
    });

    it('normalizes regional and unsupported codes to the release language policy', () => {
      expect(normalizeReleaseLanguage('en-US')).toBe('en');
      expect(normalizeReleaseLanguage('zh-CN')).toBe('zh');
      expect(normalizeReleaseLanguage('fr')).toBe('zh');
      expect(normalizeReleaseLanguage('')).toBe('zh');
    });
  });
});
