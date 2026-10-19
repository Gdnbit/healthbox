// Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ThemeToggle from '../ui/ThemeToggle';
import LanguageSwitcher from '../shared/LanguageSwitcher';
import './Header.css';

/**
 * Common page header component with navigation
 */
const Header = ({
  title,
  showBackButton = false,
  backPath = '/family-health',
  actions = null,
  subtitle = null,
  showThemeToggle = true,
  showLanguageSwitcher = true,
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation(['navigation', 'shared']);

  const handleBack = () => {
    navigate(backPath);
  };

  return (
    <header className="page-header">
      <div className="header-left">
        {showBackButton && (
          <button className="back-button" onClick={handleBack} type="button">
            ← {t('menu.backToDashboard')}
          </button>
        )}
        <div className="header-title-section">
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
      </div>

      <div className="header-actions">
        {actions}
        {showLanguageSwitcher && <LanguageSwitcher compact />}
        <button
          className="settings-button"
          onClick={() => navigate('/settings')}
          type="button"
          title={t('shared:labels.settings')}
        >
          {/* eslint-disable-next-line i18next/no-literal-string -- decorative emoji */}
          {'\u2699\uFE0F'}
        </button>
        {showThemeToggle && <ThemeToggle />}
      </div>
    </header>
  );
};

export default Header;
