import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import type { AuthContextType } from '../../contexts/AuthContext';
import { authService } from '../../services/auth/simpleAuthService';
import './PrivacyConsent.css';

type NoticeSection = {
  key: string;
  title: string;
  body: string;
};

type PrivacyNotice = {
  notice_version: string;
  locale: string;
  kicker: string;
  title: string;
  summary: string;
  required: boolean;
  accepted: boolean;
  latest_decision: 'accepted' | 'declined' | null;
  sections: NoticeSection[];
  external_processing_consent_included: boolean;
  external_processing_title: string;
  external_processing_body: string;
  confirmation_text: string;
  accept_label: string;
  decline_label: string;
  version_label: string;
};

const PrivacyConsent = () => {
  const { t } = useTranslation(['common']);
  const navigate = useNavigate();
  const { logout, clearPrivacyConsentRequired } = useAuth() as AuthContextType;
  const [notice, setNotice] = useState<PrivacyNotice | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const loadNotice = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const current = (await authService.getPrivacyConsent()) as PrivacyNotice;
      if (!current.required || current.accepted) {
        clearPrivacyConsentRequired();
        navigate('/family-health', { replace: true });
        return;
      }
      setNotice(current);
    } catch {
      setError(t('common:messages.displayError'));
    } finally {
      setIsLoading(false);
    }
  }, [clearPrivacyConsentRequired, navigate, t]);

  useEffect(() => {
    void loadNotice();
  }, [loadNotice]);

  const submitDecision = async (decision: 'accepted' | 'declined') => {
    if (!notice || (decision === 'accepted' && !confirmed)) return;
    setIsSubmitting(true);
    setError('');
    try {
      await authService.submitPrivacyConsent({
        noticeVersion: notice.notice_version,
        decision,
      });
      if (decision === 'accepted') {
        clearPrivacyConsentRequired();
        navigate('/family-health', { replace: true });
        return;
      }
      await logout();
      navigate('/login', { replace: true });
    } catch {
      setError(t('common:messages.displayError'));
      if (decision === 'accepted') {
        await loadNotice();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <main className="privacy-consent-page">
        <div className="privacy-consent-card privacy-consent-card--status">
          <p>{t('common:labels.loading')}</p>
        </div>
      </main>
    );
  }

  if (!notice) {
    return (
      <main className="privacy-consent-page">
        <div className="privacy-consent-card privacy-consent-card--status">
          <p role="alert">{error || t('common:messages.displayError')}</p>
          <button
            type="button"
            className="privacy-consent-button privacy-consent-button--primary"
            onClick={() => void loadNotice()}
          >
            {t('common:buttons.tryAgain')}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="privacy-consent-page">
      <article className="privacy-consent-card" aria-labelledby="privacy-title">
        <header className="privacy-consent-header">
          <img src="/healthbox-icon.svg" alt="" width={48} height={48} />
          <div>
            <p className="privacy-consent-kicker">{notice.kicker}</p>
            <h1 id="privacy-title">{notice.title}</h1>
            <p>{notice.summary}</p>
          </div>
        </header>

        {error && (
          <p className="privacy-consent-error" role="alert">
            {error}
          </p>
        )}

        <div className="privacy-consent-sections">
          {notice.sections.map((section, index) => (
            <section className="privacy-consent-section" key={section.key}>
              <span aria-hidden="true">{index + 1}</span>
              <div>
                <h2>{section.title}</h2>
                <p>{section.body}</p>
              </div>
            </section>
          ))}
        </div>

        <div className="privacy-consent-boundary" role="note">
          <strong>{notice.external_processing_title}</strong>
          <p>{notice.external_processing_body}</p>
        </div>

        <label className="privacy-consent-confirmation">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={event => setConfirmed(event.target.checked)}
            disabled={isSubmitting}
          />
          <span>{notice.confirmation_text}</span>
        </label>

        <footer className="privacy-consent-footer">
          <p>{`${notice.version_label}：${notice.notice_version}`}</p>
          <div className="privacy-consent-actions">
            <button
              type="button"
              className="privacy-consent-button privacy-consent-button--secondary"
              disabled={isSubmitting}
              onClick={() => void submitDecision('declined')}
            >
              {notice.decline_label}
            </button>
            <button
              type="button"
              className="privacy-consent-button privacy-consent-button--primary"
              disabled={!confirmed || isSubmitting}
              onClick={() => void submitDecision('accepted')}
            >
              {notice.accept_label}
            </button>
          </div>
        </footer>
      </article>
    </main>
  );
};

export default PrivacyConsent;
