// Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@mantine/core';
import logger from '../../services/logger';
import { useUserPreferences } from '../../contexts/UserPreferencesContext';
import {
  RELEASE_LANGUAGE_OPTIONS,
  normalizeReleaseLanguage,
} from '../../i18n/householdLanguagePolicy';

interface LanguageSwitcherProps {
  compact?: boolean;
  variant?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

/**
 * LanguageSwitcher - Component for switching application language
 *
 * Displays the release-ready languages and persists the selected language.
 * Uses local state for immediate UI feedback and syncs with i18next
 */
const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({
  compact = false,
  variant = 'default',
  size = 'sm',
}) => {
  const { i18n } = useTranslation();
  const { updatePreferences } = useUserPreferences();

  // Track if a change is in progress to prevent race conditions
  const isChangingRef = useRef(false);

  // Local state for immediate UI feedback
  // This ensures the Select always shows the correct value even during async operations
  const [selectedLanguage, setSelectedLanguage] = useState(() =>
    normalizeReleaseLanguage(i18n.language)
  );

  // Sync local state with i18n.language when it changes externally
  useEffect(() => {
    if (!isChangingRef.current) {
      const normalizedLang = normalizeReleaseLanguage(i18n.language);
      setSelectedLanguage(normalizedLang);
    }
  }, [i18n.language]);

  const handleLanguageChange = useCallback(
    async (value: string | null) => {
      if (!value || value === selectedLanguage || isChangingRef.current) {
        return;
      }

      const normalizedValue = normalizeReleaseLanguage(value);
      if (normalizedValue === selectedLanguage) {
        return;
      }

      isChangingRef.current = true;
      const previousLanguage = selectedLanguage;

      // Update local state immediately for responsive UI
      setSelectedLanguage(normalizedValue);

      try {
        await i18n.changeLanguage(normalizedValue);

        logger.info('User changed language', {
          event: 'language_changed',
          component: 'LanguageSwitcher',
          newLanguage: normalizedValue,
          previousLanguage: previousLanguage,
        });

        // Save to backend via UserPreferencesContext
        try {
          await updatePreferences({ language: normalizedValue });
          logger.info('Language preference saved to backend', {
            event: 'language_saved_to_backend',
            component: 'LanguageSwitcher',
            language: normalizedValue,
          });
        } catch (backendError) {
          // Log but don't fail - language is already changed locally
          logger.error('Failed to save language to backend', {
            event: 'language_backend_save_failed',
            component: 'LanguageSwitcher',
            language: normalizedValue,
            error:
              backendError instanceof Error
                ? backendError.message
                : 'Unknown error',
          });
        }
      } catch (error) {
        // Revert local state on failure
        setSelectedLanguage(previousLanguage);

        logger.error('Failed to change language', {
          event: 'language_change_failed',
          component: 'LanguageSwitcher',
          targetLanguage: normalizedValue,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      } finally {
        isChangingRef.current = false;
      }
    },
    [selectedLanguage, i18n, updatePreferences]
  );

  const selectData = RELEASE_LANGUAGE_OPTIONS.map(lang => ({
    value: lang.value,
    label: compact ? lang.shortLabel : lang.label,
  }));

  return (
    <Select
      value={selectedLanguage}
      onChange={handleLanguageChange}
      data={selectData}
      variant={variant}
      size={size}
      styles={{
        input: {
          minWidth: compact ? '60px' : '140px',
          cursor: 'pointer',
        },
      }}
      comboboxProps={{ withinPortal: true }}
      allowDeselect={false}
      aria-label={i18n.t('navigation:sidebarNav.items.language')}
    />
  );
};

export default LanguageSwitcher;
