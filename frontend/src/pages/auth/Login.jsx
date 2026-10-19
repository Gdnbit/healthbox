// Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { notifyError } from '../../utils/notifyTranslated';
import { authService } from '../../services/auth/simpleAuthService';
import frontendLogger from '../../services/frontendLogger';
import {
  resolveProductReturnPath,
  toLocationReturnTarget,
} from '../../config/productRoutes';
import { isUserAdmin } from '../../utils/authUtils';
import {
  IconUser,
  IconLock,
  IconEye,
  IconEyeOff,
  IconShieldLock,
  IconCopy,
  IconCheck,
} from '@tabler/icons-react';
import { QRCodeSVG } from 'qrcode.react';
import styles from '../../styles/pages/Login.module.css';

const Login = () => {
  const [formData, setFormData] = useState({
    username: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [ssoConfig, setSSOConfig] = useState({ enabled: false });
  const [ssoLoading, setSSOLoading] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configError, setConfigError] = useState(false);
  const [mfaFlow, setMfaFlow] = useState(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaMethod, setMfaMethod] = useState('totp');
  const [codesCopied, setCodesCopied] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const {
    login,
    error,
    clearError,
    isAuthenticated,
    user,
    setupAdminTotp,
    completeAdminMfa,
    acceptAdminMfaSession,
  } = useAuth();
  const { t } = useTranslation(['auth', 'common', 'shared', 'errors']);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      const from = resolveProductReturnPath(
        toLocationReturnTarget(location.state?.from),
        { isAdmin: isUserAdmin(user) }
      );
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, navigate, location, user]);

  // One-shot environment snapshot. If a later auth fetch fails, pairing this
  // log with the failure tells us whether a stale service worker, insecure
  // context, mixed protocol, or cookies-disabled state was already in play.
  useEffect(() => {
    frontendLogger.logInfo('Login page environment snapshot', {
      category: 'login_env_snapshot',
      hasServiceWorker:
        typeof navigator !== 'undefined' &&
        !!navigator.serviceWorker?.controller,
      swScriptUrl:
        typeof navigator !== 'undefined'
          ? navigator.serviceWorker?.controller?.scriptURL
          : null,
      isSecureContext:
        typeof window !== 'undefined' ? window.isSecureContext : null,
      origin: typeof window !== 'undefined' ? window.location.origin : null,
      protocol: typeof window !== 'undefined' ? window.location.protocol : null,
      cookieEnabled:
        typeof navigator !== 'undefined' ? navigator.cookieEnabled : null,
    });
  }, []);

  // Retry generation counter: a new generation supersedes any pending
  // backoff timer or in-flight fetch from a previous attempt (e.g. when
  // `window.online` fires mid-backoff, or the user clicks Retry).
  const attemptRef = useRef(0);
  const abortRef = useRef(null);

  // Check registration status and SSO config, with silent exponential-backoff
  // retry so a transient network blip or cookie-clear race during auto-logout
  // recovers invisibly. Only shows the Retry button once all attempts exhaust.
  const loadConfig = useCallback(async () => {
    attemptRef.current += 1;
    const thisAttempt = attemptRef.current;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    // Reset UI to the pre-load state. configLoaded stays false through the
    // auto-retry window so neither SSO nor the error notice render yet.
    setConfigLoaded(false);
    setConfigError(false);

    // First attempt is immediate; three retries at 0.5s, 1.5s, 3s (~5s total).
    const delays = [0, 500, 1500, 3000];
    for (const delay of delays) {
      if (thisAttempt !== attemptRef.current || ac.signal.aborted) return;
      if (delay > 0) {
        try {
          await new Promise((resolve, reject) => {
            const handleAbort = () => {
              clearTimeout(timer);
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            };
            const timer = setTimeout(() => {
              ac.signal.removeEventListener('abort', handleAbort);
              resolve();
            }, delay);
            ac.signal.addEventListener('abort', handleAbort, { once: true });
          });
        } catch {
          return; // backoff was aborted -- superseded or unmounted
        }
      }
      if (thisAttempt !== attemptRef.current || ac.signal.aborted) return;

      try {
        const [status, config] = await Promise.all([
          authService.checkRegistrationEnabled({ signal: ac.signal }),
          authService.getSSOConfig({ signal: ac.signal }),
        ]);
        if (thisAttempt !== attemptRef.current || ac.signal.aborted) return;

        // error:true means the fetch itself failed -- do not confuse that
        // with "backend returned SSO/registration disabled", which is valid.
        const failed = status.error === true || config.error === true;
        if (!failed) {
          setSSOConfig(config);
          setConfigError(false);
          setConfigLoaded(true);
          return;
        }
        // Soft failure -- fall through to next backoff delay.
      } catch (err) {
        if (err.name === 'AbortError') return;
        // Any other unexpected error: treat as soft failure and keep retrying.
      }
    }

    if (thisAttempt !== attemptRef.current || ac.signal.aborted) return;
    setConfigError(true);
    setConfigLoaded(true);
  }, []);

  // Initial load + unmount cleanup. Kept separate from the online-listener
  // effect so adding configLoaded/configError as deps there can't accidentally
  // re-trigger loadConfig (which would loop, since loadConfig writes both).
  useEffect(() => {
    loadConfig();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadConfig]);

  // If the OS reports connectivity is back, short-circuit any in-progress
  // backoff and re-fetch immediately. Skip when config has already loaded
  // successfully -- otherwise a stray WiFi flap on a working page would
  // briefly hide the SSO/registration UI and fire two redundant requests.
  useEffect(() => {
    const onOnline = () => {
      if (!configLoaded || configError) loadConfig();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [loadConfig, configLoaded, configError]);

  const handleChange = e => {
    clearError(); // Clear any existing errors
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async e => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const result = await login(formData);
      if (result.success) {
        if (result.authenticationPending) {
          if (result.challengeType === 'mfa_enrollment_required') {
            const setup = await setupAdminTotp(result.challengeToken);
            if (!setup.success) {
              notifyError('notifications:toasts.auth.loginFailed');
              return;
            }
            setMfaFlow({
              step: 'enroll',
              challengeToken: result.challengeToken,
              setup,
            });
          } else {
            setMfaFlow({
              step: 'verify',
              challengeToken: result.challengeToken,
            });
          }
          setMfaCode('');
          return;
        }
        // Add a small delay to ensure auth state is fully saved before navigation
        await new Promise(resolve => setTimeout(resolve, 500));

        if (result.mustChangePassword) {
          navigate('/change-password', { replace: true });
        } else {
          const from = resolveProductReturnPath(
            toLocationReturnTarget(location.state?.from),
            { isAdmin: isUserAdmin(result.user) }
          );
          navigate(from, { replace: true });
        }
      } else {
        notifyError('notifications:toasts.auth.loginFailed');
      }
    } catch (error) {
      frontendLogger.logError('Login failed', {
        error: error && error.message ? error.message : String(error),
        component: 'Login',
      });
      notifyError('notifications:toasts.auth.loginFailed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMfaSubmit = async e => {
    e.preventDefault();
    if (!mfaFlow || !mfaCode.trim()) return;
    setIsLoading(true);
    clearError();
    try {
      const result = await completeAdminMfa({
        challengeToken: mfaFlow.challengeToken,
        code: mfaCode.trim(),
        method: mfaMethod,
        enrollment: mfaFlow.step === 'enroll',
      });
      if (!result.success) {
        notifyError('notifications:toasts.auth.loginFailed');
        return;
      }
      if (result.recoveryCodes?.length) {
        setMfaFlow({
          step: 'recovery',
          sessionResult: result,
          recoveryCodes: result.recoveryCodes,
        });
        setMfaCode('');
      }
    } catch (mfaError) {
      frontendLogger.logError('Administrator MFA failed', {
        error: mfaError?.message || String(mfaError),
        component: 'Login',
      });
      notifyError('notifications:toasts.auth.loginFailed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyRecoveryCodes = async () => {
    const text = mfaFlow?.recoveryCodes?.join('\n') || '';
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCodesCopied(true);
  };

  const handleRecoveryCodesSaved = () => {
    acceptAdminMfaSession(mfaFlow.sessionResult);
  };

  const resetMfaFlow = () => {
    setMfaFlow(null);
    setMfaCode('');
    setMfaMethod('totp');
    setCodesCopied(false);
    clearError();
  };

  useEffect(() => {
    const pending = location.state?.mfaChallenge;
    if (!pending || mfaFlow) return;
    const restoreSsoChallenge = async () => {
      if (pending.challengeType === 'mfa_enrollment_required') {
        const setup = await setupAdminTotp(pending.challengeToken);
        if (setup.success) {
          setMfaFlow({
            step: 'enroll',
            challengeToken: pending.challengeToken,
            setup,
          });
        }
      } else {
        setMfaFlow({
          step: 'verify',
          challengeToken: pending.challengeToken,
        });
      }
    };
    void restoreSsoChallenge();
  }, [location.state, mfaFlow, setupAdminTotp]);

  const handleSSOLogin = async () => {
    setSSOLoading(true);
    try {
      // Store current location for redirect after SSO
      const returnUrl = resolveProductReturnPath(
        toLocationReturnTarget(location.state?.from)
      );
      sessionStorage.setItem('sso_return_url', returnUrl);

      const result = await authService.initiateSSOLogin(returnUrl);
      // Redirect to SSO provider
      window.location.href = result.auth_url;
    } catch (error) {
      frontendLogger.logError('SSO login initiation failed', {
        error: error.message,
        component: 'Login',
      });
      notifyError('notifications:toasts.auth.ssoFailed');
    } finally {
      setSSOLoading(false);
    }
  };
  return (
    <div className={styles.loginContainer}>
      <div className={styles.loginForm}>
        <div className={styles.loginHeader}>
          <h1>
            <img
              src="/healthbox-icon.svg"
              alt=""
              width={40}
              height={40}
              style={{ verticalAlign: 'middle', marginRight: '8px' }}
            />
            {/* eslint-disable-next-line i18next/no-literal-string -- Chinese-first product name */}
            {'HealthBox · 健康档案盒'}
          </h1>
        </div>

        <div className={styles.loginDivider}>
          <span>{mfaFlow ? t('mfa.adminVerification') : t('login.title')}</span>
        </div>

        {location.state?.passwordChanged && !mfaFlow && (
          <div className={styles.successMessage} role="status">
            <strong>{t('changePassword.success')}</strong>{' '}
            {t('errors:general.sessionExpired')}
          </div>
        )}

        {error && <div className={styles.errorMessage}>{error}</div>}

        {!mfaFlow && (
          <form onSubmit={handleSubmit}>
            <div className={styles.formGroup}>
              <label htmlFor="username">{t('shared:labels.username')}</label>
              <div className={styles.inputWrapper}>
                <span className={styles.inputIconPrefix}>
                  <IconUser size={18} />
                </span>
                <input
                  type="text"
                  id="username"
                  name="username"
                  value={formData.username}
                  onChange={handleChange}
                  placeholder={t('login.usernamePlaceholder')}
                  required
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="password">{t('shared:labels.password')}</label>
              <div className={styles.inputWrapper}>
                <span className={styles.inputIconPrefix}>
                  <IconLock size={18} />
                </span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder={t('login.passwordPlaceholder')}
                  required
                  disabled={isLoading}
                />
                <span
                  className={styles.inputIconSuffix}
                  onClick={() => setShowPassword(prev => !prev)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setShowPassword(prev => !prev);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={
                    showPassword
                      ? t('login.hidePassword')
                      : t('login.showPassword')
                  }
                >
                  {showPassword ? (
                    <IconEyeOff size={18} />
                  ) : (
                    <IconEye size={18} />
                  )}
                </span>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className={styles.submitBtn}
            >
              {isLoading ? t('login.submitting') : t('login.submit')}
            </button>
          </form>
        )}

        {mfaFlow && mfaFlow.step !== 'recovery' && (
          <form onSubmit={handleMfaSubmit} data-testid="admin-mfa-form">
            <div className={styles.mfaIntro}>
              <IconShieldLock size={24} aria-hidden="true" />
              <div>
                <strong>
                  {mfaFlow.step === 'enroll'
                    ? t('mfa.enrollTitle')
                    : t('mfa.verifyTitle')}
                </strong>
                <p>
                  {mfaFlow.step === 'enroll'
                    ? t('mfa.enrollDescription')
                    : t('mfa.verifyDescription')}
                </p>
              </div>
            </div>

            {mfaFlow.step === 'enroll' && (
              <div className={styles.qrPanel}>
                <QRCodeSVG
                  value={mfaFlow.setup.provisioning_uri}
                  size={164}
                  level="M"
                  aria-label={t('mfa.qrLabel')}
                />
                <p>{t('mfa.manualKeyHelp')}</p>
                <code className={styles.manualKey}>
                  {mfaFlow.setup.manual_key}
                </code>
              </div>
            )}

            {mfaFlow.step === 'verify' && (
              <div className={styles.methodSwitch} role="group">
                <button
                  type="button"
                  className={mfaMethod === 'totp' ? styles.activeMethod : ''}
                  onClick={() => setMfaMethod('totp')}
                >
                  {t('mfa.useTotp')}
                </button>
                <button
                  type="button"
                  className={
                    mfaMethod === 'recovery_code' ? styles.activeMethod : ''
                  }
                  onClick={() => setMfaMethod('recovery_code')}
                >
                  {t('mfa.useRecoveryCode')}
                </button>
              </div>
            )}

            <div className={styles.formGroup}>
              <label htmlFor="mfa-code">
                {mfaMethod === 'recovery_code'
                  ? t('mfa.recoveryCodeLabel')
                  : t('mfa.codeLabel')}
              </label>
              <div className={styles.inputWrapper}>
                <span className={styles.inputIconPrefix}>
                  <IconShieldLock size={18} />
                </span>
                <input
                  id="mfa-code"
                  name="mfa-code"
                  type="text"
                  inputMode={mfaMethod === 'recovery_code' ? 'text' : 'numeric'}
                  autoComplete="one-time-code"
                  value={mfaCode}
                  onChange={event => setMfaCode(event.target.value)}
                  placeholder={
                    mfaMethod === 'recovery_code'
                      ? t('mfa.recoveryCodePlaceholder')
                      : t('mfa.codePlaceholder')
                  }
                  required
                  disabled={isLoading}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className={styles.submitBtn}
            >
              {isLoading ? t('mfa.verifying') : t('mfa.continue')}
            </button>
            <button
              type="button"
              className={styles.secondaryTextBtn}
              onClick={resetMfaFlow}
              disabled={isLoading}
            >
              {t('mfa.backToPassword')}
            </button>
          </form>
        )}

        {mfaFlow?.step === 'recovery' && (
          <section
            className={styles.recoveryPanel}
            data-testid="recovery-codes"
          >
            <IconShieldLock size={28} aria-hidden="true" />
            <h2>{t('mfa.recoveryTitle')}</h2>
            <p>{t('mfa.recoveryDescription')}</p>
            <div className={styles.recoveryGrid}>
              {mfaFlow.recoveryCodes.map(code => (
                <code key={code}>{code}</code>
              ))}
            </div>
            <button
              type="button"
              className={styles.copyCodesBtn}
              onClick={handleCopyRecoveryCodes}
            >
              {codesCopied ? <IconCheck size={18} /> : <IconCopy size={18} />}
              {codesCopied ? t('mfa.copied') : t('mfa.copyCodes')}
            </button>
            <button
              type="button"
              className={styles.submitBtn}
              onClick={handleRecoveryCodesSaved}
            >
              {t('mfa.savedContinue')}
            </button>
          </section>
        )}

        {/* Config-fetch failed -- show retry instead of silently hiding SSO */}
        {!mfaFlow && configLoaded && configError && (
          <div
            className={styles.configWarning}
            data-testid="config-error"
            role="status"
          >
            <span>{t('login.configLoadFailed')}</span>
            <button
              type="button"
              className={styles.retryBtn}
              onClick={loadConfig}
            >
              {t('login.retry')}
            </button>
          </div>
        )}

        {/* SSO Login Option -- only when config loaded successfully AND backend says SSO is on */}
        {!mfaFlow && configLoaded && !configError && ssoConfig.enabled && (
          <div className={styles.ssoSection} data-testid="sso-section">
            <div className={styles.divider}>
              <span>{t('login.or')}</span>
            </div>
            <button
              type="button"
              className={styles.ssoBtn}
              onClick={handleSSOLogin}
              disabled={isLoading || ssoLoading}
            >
              {ssoLoading
                ? t('common:labels.loading')
                : t('login.continueWith', {
                    provider:
                      ssoConfig.provider_type === 'google'
                        ? 'Google'
                        : ssoConfig.provider_type === 'github'
                          ? 'GitHub'
                          : 'SSO',
                  })}
            </button>
          </div>
        )}

        {!mfaFlow && configLoaded && !configError && (
          <div className={styles.loginActions}>
            <div className={styles.registrationDisabledMessage}>
              {t('login.registrationDisabled')}
            </div>
          </div>
        )}

        {/* When config fails, we don't actually know whether registration is on --
            show a neutral notice instead of a misleading "disabled" message */}
        {!mfaFlow && configLoaded && configError && (
          <div className={styles.loginActions}>
            <div className={styles.registrationDisabledMessage}>
              {t('login.registrationStatusUnavailable')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Login;
