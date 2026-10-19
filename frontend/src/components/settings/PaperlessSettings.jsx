// Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Radio,
  Group,
  TextInput,
  PasswordInput,
  Switch,
  Text,
} from '@mantine/core';
import IntegrationSettingsCard from './IntegrationSettingsCard';
import { testPaperlessConnection } from '../../services/api/paperlessApi.jsx';
import frontendLogger from '../../services/frontendLogger';

/**
 * PaperlessSettings Component
 *
 * Manages Paperless-ngx integration settings using the shared
 * IntegrationSettingsCard template. Adds auth method selection
 * (token vs username/password) and sync options as extras.
 */
const PaperlessSettings = ({
  preferences,
  onPreferencesUpdate,
  loading = false,
}) => {
  const { t } = useTranslation(['settings', 'shared', 'ui']);
  const [connectionStatus, setConnectionStatus] = useState(null);
  const [connectionMessage, setConnectionMessage] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);
  const [authMethod, setAuthMethod] = useState(() => {
    if (preferences?.paperless_api_token || preferences?.paperless_has_token)
      return 'token';
    if (
      preferences?.paperless_username ||
      preferences?.paperless_has_credentials
    )
      return 'credentials';
    return 'token';
  });

  // Don't render until preferences are loaded
  if (!preferences || Object.keys(preferences).length === 0) {
    return <Text c="dimmed">Loading settings...</Text>;
  }

  const handleUpdate = updates => {
    const updatedPrefs = { ...preferences, ...updates };

    // If disabling and currently the active backend, fall back to local
    if (
      updates.paperless_enabled === false &&
      preferences.default_storage_backend === 'paperless'
    ) {
      updatedPrefs.default_storage_backend = 'local';
    }

    onPreferencesUpdate(updatedPrefs);
  };

  const handleTestConnection = async () => {
    const url = preferences.paperless_url;
    if (!url) return;

    try {
      setTestingConnection(true);
      setConnectionStatus(null);
      setConnectionMessage('');

      const token = preferences.paperless_api_token;
      const username = preferences.paperless_username;
      const password = preferences.paperless_password;
      const hasApiToken = token && token.trim();
      const hasCredentials = username && password;

      let result;
      if (hasApiToken) {
        frontendLogger.logInfo('Testing connection with API token', {
          component: 'PaperlessSettings',
        });
        result = await testPaperlessConnection(url, '', '', token);
      } else if (hasCredentials) {
        frontendLogger.logInfo('Testing connection with username/password', {
          component: 'PaperlessSettings',
        });
        result = await testPaperlessConnection(url, username, password);
      } else {
        frontendLogger.logInfo('Using saved credentials for connection test', {
          component: 'PaperlessSettings',
        });
        result = await testPaperlessConnection(url, '', '', '');
      }

      if (result.status === 'connected') {
        setConnectionStatus('success');
        setConnectionMessage('Connected successfully');
        // Optimistically mark verified so StoragePreferencesCard unlocks immediately
        handleUpdate({ paperless_connection_verified: true });
        frontendLogger.logInfo('Paperless connection test successful', {
          component: 'PaperlessSettings',
          authMethod: result.auth_method,
        });
      } else {
        setConnectionStatus('error');
        setConnectionMessage(result.message || 'Connection failed');
        frontendLogger.logWarning('Paperless connection test failed', {
          component: 'PaperlessSettings',
          error: result.message,
        });
      }
    } catch (error) {
      setConnectionStatus('error');
      setConnectionMessage(error.message || 'Connection failed');
      frontendLogger.logError('Paperless connection test error', {
        component: 'PaperlessSettings',
        error: error.message,
      });
    } finally {
      setTestingConnection(false);
    }
  };

  const paperlessEnabled = preferences.paperless_enabled ?? false;
  const hasTokenSaved = preferences.paperless_has_token ?? false;
  const hasCredentialsSaved = preferences.paperless_has_credentials ?? false;
  const isVerified = preferences.paperless_connection_verified ?? false;

  return (
    <IntegrationSettingsCard
      name="Paperless-ngx"
      enabled={paperlessEnabled}
      onEnabledChange={checked => handleUpdate({ paperless_enabled: checked })}
      url={preferences.paperless_url || ''}
      onUrlChange={value => handleUpdate({ paperless_url: value })}
      urlPlaceholder="https://paperless.example.com"
      token={
        authMethod === 'token' ? preferences.paperless_api_token || '' : ''
      }
      onTokenChange={value => handleUpdate({ paperless_api_token: value })}
      hasTokenSaved={hasTokenSaved}
      hasAlternateAuth={
        authMethod === 'credentials' &&
        ((preferences.paperless_username && preferences.paperless_password) ||
          hasCredentialsSaved)
      }
      onTestConnection={handleTestConnection}
      testingConnection={testingConnection}
      connectionStatus={connectionStatus}
      connectionMessage={connectionMessage}
      loading={loading}
      renderAuthExtras={({ disabled, testingConnection: testing }) => (
        <>
          <Radio.Group
            label={t('ui:u_44ff9dbcb9c4')}
            description={t('ui:u_aab77c10bb4a')}
            value={authMethod}
            onChange={setAuthMethod}
          >
            <Group mt="xs">
              <Radio
                value="token"
                label={t('ui:u_9fac0356cefe')}
                disabled={disabled || testing}
              />
              <Radio
                value="credentials"
                label={t('ui:u_05e43eb0f640')}
                disabled={disabled || testing}
              />
            </Group>
          </Radio.Group>

          {authMethod === 'credentials' && (
            <>
              <TextInput
                label={t('ui:u_e3b89e9d33f8')}
                placeholder={t('ui:u_78664f0c398b')}
                value={preferences.paperless_username || ''}
                onChange={e =>
                  handleUpdate({
                    paperless_username: e.currentTarget.value.trim(),
                  })
                }
                disabled={disabled || testing}
              />
              <PasswordInput
                label={t('ui:u_e7cf3ef4f17c')}
                placeholder={
                  hasCredentialsSaved && !preferences.paperless_password
                    ? 'Password saved - leave blank to keep current'
                    : 'Enter your password'
                }
                value={preferences.paperless_password || ''}
                onChange={e =>
                  handleUpdate({ paperless_password: e.currentTarget.value })
                }
                disabled={disabled || testing}
              />
            </>
          )}
        </>
      )}
      renderExtras={({ connectionStatus: status }) =>
        (status === 'success' || isVerified) && (
          <>
            <Switch
              label={t('ui:u_76cfeb1bc6b1')}
              description={t('ui:u_c3f588cc1672')}
              checked={preferences.paperless_auto_sync ?? false}
              onChange={e =>
                handleUpdate({ paperless_auto_sync: e.currentTarget.checked })
              }
            />
            <Switch
              label={t('ui:u_092fd680cb27')}
              description={t('ui:u_ec3b443d57a2')}
              checked={preferences.paperless_sync_tags ?? true}
              onChange={e =>
                handleUpdate({ paperless_sync_tags: e.currentTarget.checked })
              }
              disabled
              styles={{ track: { opacity: 0.5 } }}
            />
          </>
        )
      }
    />
  );
};

export default PaperlessSettings;
