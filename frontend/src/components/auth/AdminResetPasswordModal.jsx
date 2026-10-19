// Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
import { useState } from 'react';
import {
  Alert,
  Button,
  Code,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconCopy } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { adminApiService } from '../../services/api/adminApi';
import logger from '../../services/logger';

const AdminResetPasswordModal = ({ isOpen, onClose, userId, username }) => {
  const { t } = useTranslation(['admin', 'common', 'shared']);
  const [confirmUsername, setConfirmUsername] = useState('');
  const [reason, setReason] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const resetForm = () => {
    setConfirmUsername('');
    setReason('');
    setError('');
    setResult(null);
    setCopied(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleAccessReset = async event => {
    event.preventDefault();
    if (confirmUsername.trim() !== username || reason.trim().length < 3) return;

    setError('');
    try {
      setIsResetting(true);
      const response = await adminApiService.resetMemberAccess(userId, {
        confirm_username: confirmUsername.trim(),
        reason: reason.trim(),
      });
      setResult(response?.data || response);
    } catch (resetError) {
      logger.error('member_access_reset_error', {
        component: 'AdminResetPasswordModal',
        userId,
        error:
          resetError instanceof Error ? resetError.message : String(resetError),
      });
      setError(
        resetError?.message ||
          t(
            'users.passwordModal.resetFailed',
            '无法生成一次性临时密码，请重试。'
          )
      );
    } finally {
      setIsResetting(false);
    }
  };

  const copyTemporaryPassword = async () => {
    if (!result?.temporary_password) return;
    try {
      await navigator.clipboard.writeText(result.temporary_password);
      setCopied(true);
    } catch {
      setError(
        t(
          'users.passwordModal.copyFailed',
          '复制失败，请手动选择并复制临时密码。'
        )
      );
    }
  };

  return (
    <Modal
      opened={isOpen}
      onClose={handleClose}
      closeOnClickOutside={!result}
      title={t('users.passwordModal.titleShort', '重置成员访问凭据')}
      size="sm"
      centered
    >
      <Stack gap="md">
        {error ? (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        ) : null}

        {result ? (
          <>
            <Alert color="green" variant="light" icon={<IconCheck size={18} />}>
              {t(
                'users.passwordModal.issuedNotice',
                '一次性临时密码已生成。旧会话已经失效，成员登录后必须立即设置新密码。'
              )}
            </Alert>
            <Text size="sm" c="dimmed">
              {t(
                'users.passwordModal.oneTimeDisplay',
                '请立即通过安全方式转交给成员；关闭后无法再次查看。'
              )}
            </Text>
            <Paper withBorder p="md">
              <Stack gap="xs">
                <Text size="xs" c="dimmed">
                  {t('users.passwordModal.temporaryPassword', '一次性临时密码')}
                </Text>
                <Code
                  block
                  data-testid="model-edit-temporary-password"
                  style={{ fontSize: '1rem', overflowWrap: 'anywhere' }}
                >
                  {result.temporary_password}
                </Code>
                <Button
                  variant="light"
                  leftSection={<IconCopy size={16} />}
                  onClick={copyTemporaryPassword}
                >
                  {copied
                    ? t('users.passwordModal.copied', '已复制')
                    : t(
                        'users.passwordModal.copyTemporaryPassword',
                        '复制临时密码'
                      )}
                </Button>
              </Stack>
            </Paper>
            <Group justify="flex-end">
              <Button onClick={handleClose}>
                {t('shared:fields.close', '关闭')}
              </Button>
            </Group>
          </>
        ) : (
          <>
            <Paper
              p="sm"
              radius="sm"
              withBorder
              style={{ borderLeft: '4px solid var(--mantine-color-yellow-5)' }}
            >
              <Text size="sm">
                {t(
                  'users.passwordModal.resettingForPlain',
                  '正在为成员 {{username}} 重置访问凭据。',
                  { username }
                )}
              </Text>
              <Alert
                color="yellow"
                variant="light"
                icon={<IconAlertTriangle size={16} />}
                mt="xs"
                p="xs"
              >
                <Text size="xs">
                  {t(
                    'users.passwordModal.resetImpact',
                    '提交后，该成员的旧登录会话会立即失效；系统生成的临时密码只能成功登录一次，并在60分钟后过期。'
                  )}
                </Text>
              </Alert>
            </Paper>

            <form onSubmit={handleAccessReset}>
              <Stack gap="md">
                <TextInput
                  label={t(
                    'users.passwordModal.confirmUsername',
                    '输入成员账号以确认'
                  )}
                  description={t(
                    'users.passwordModal.confirmUsernameDescription',
                    '请输入 {{username}}',
                    { username }
                  )}
                  value={confirmUsername}
                  onChange={event =>
                    setConfirmUsername(event.currentTarget.value)
                  }
                  data-testid="model-edit-reset-confirm"
                  autoComplete="off"
                />
                <TextInput
                  label={t('users.passwordModal.reason', '重置原因')}
                  description={t(
                    'users.passwordModal.reasonDescription',
                    '只填写账号维护原因，不要填写密码、临时凭据或健康资料。'
                  )}
                  placeholder={t(
                    'users.passwordModal.reasonPlaceholder',
                    '例如：成员忘记密码'
                  )}
                  value={reason}
                  onChange={event => setReason(event.currentTarget.value)}
                  data-testid="model-edit-reset-reason"
                  maxLength={200}
                />
                <Group justify="flex-end" gap="sm">
                  <Button
                    variant="default"
                    onClick={handleClose}
                    disabled={isResetting}
                  >
                    {t('shared:fields.cancel', '取消')}
                  </Button>
                  <Button
                    type="submit"
                    loading={isResetting}
                    disabled={
                      confirmUsername.trim() !== username ||
                      reason.trim().length < 3
                    }
                    data-testid="model-edit-issue-reset"
                  >
                    {t(
                      'users.passwordModal.issueTemporaryPassword',
                      '生成一次性临时密码'
                    )}
                  </Button>
                </Group>
              </Stack>
            </form>
          </>
        )}
      </Stack>
    </Modal>
  );
};

export default AdminResetPasswordModal;
