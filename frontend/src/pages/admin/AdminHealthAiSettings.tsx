/* eslint-disable i18next/no-literal-string -- Chinese-first sole-admin AI configuration */
import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Loader,
  NativeSelect,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconCheck,
  IconKey,
  IconRefresh,
  IconServer,
  IconShieldLock,
  IconSparkles,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AdminLayout from '../../components/admin/AdminLayout';
import defaultAdminHealthAiApi, {
  type AdminHealthAiMode,
  type AdminHealthAiSettings,
  type AdminHealthAiTestResponse,
} from '../../services/api/adminHealthAiApi';
import logger from '../../services/logger';
import './admin-health-ai-settings.css';

const MODE_LABELS: Record<AdminHealthAiMode, string> = {
  off: '关闭',
  test: '虚构数据动态测试',
  local: '家庭服务器模型',
};

const LOCAL_ENDPOINT_PRESET = {
  baseUrl: 'http://host.docker.internal:11434/v1',
} as const;

const REASON_LABELS: Record<string, string> = {
  not_configured: '尚未完成配置或服务器未允许本地模型运行',
  connection_test_required: '当前修订尚未通过虚构数据连接测试',
  test_provider_not_allowed: '服务器尚未打开虚构数据测试门禁',
  synthetic_instance_required: '当前实例不是虚构数据测试实例',
  configuration_invalid: '服务器中的配置格式无效',
  invalid_local_endpoint: '服务地址不在允许的家庭服务器范围内',
  invalid_model_id: '模型 ID 格式无效',
  unsupported_provider: '提供方类型不受支持',
};

const OPERATION_ERROR_LABELS: Record<string, string> = {
  invalid_health_ai_configuration_reason:
    '操作原因需要填写 3～200 个单行字符。',
  health_ai_configuration_invalid:
    '服务器中保存的 AI 配置无效，请先检查服务器配置。',
  health_ai_configuration_revision_conflict:
    '配置已在其他会话中更新，请刷新状态后再重试。',
  invalid_local_endpoint:
    '服务地址不在允许的家庭服务器范围内，请使用本机或局域网地址。',
  invalid_model_id: '模型 ID 格式无效，请检查后重试。',
  test_provider_not_allowed: '服务器尚未开启虚构数据测试门禁。',
  synthetic_instance_required:
    '虚构数据测试只能在标记为 synthetic 的隔离实例中运行。',
  health_ai_not_configured: '请先保存一个可用的 AI 运行模式。',
  health_ai_invalid_model_citation:
    '模型返回了无效引用，本次测试结果已被拒绝。',
  health_ai_provider_response_too_large:
    '模型返回内容超过安全上限，本次测试结果已被拒绝。',
  health_ai_invalid_provider_response:
    '模型返回格式不符合约定，本次测试结果已被拒绝。',
  health_ai_tool_call_rejected:
    '模型尝试调用工具，本次测试结果已按只读规则拒绝。',
  health_ai_provider_redirect_rejected:
    '模型服务发生了不允许的重定向，本次测试已停止。',
  health_ai_unsafe_model_output:
    '模型回答未通过健康安全检查，本次测试结果已被拒绝。',
  health_ai_ungrounded_model_output:
    '模型回答未完整绑定每条虚构记录的编号、数值和单位，本次测试结果已被拒绝。',
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
};

const getOperationErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return fallback;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string'
    ? (OPERATION_ERROR_LABELS[code] ?? fallback)
    : fallback;
};

const cleanValue = (value: string): string => value.trim();

interface AdminHealthAiSettingsPageProps {
  api?: Pick<
    typeof defaultAdminHealthAiApi,
    'getSettings' | 'updateSettings' | 'testConnection'
  >;
  standalone?: boolean;
}

const AdminHealthAiSettingsPage = ({
  api = defaultAdminHealthAiApi,
  standalone = false,
}: AdminHealthAiSettingsPageProps) => {
  const { t } = useTranslation('admin');
  const [settings, setSettings] = useState<AdminHealthAiSettings | null>(null);
  const [mode, setMode] = useState<AdminHealthAiMode>('off');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [testResult, setTestResult] =
    useState<AdminHealthAiTestResponse | null>(null);

  const applySettings = useCallback((next: AdminHealthAiSettings) => {
    setSettings(next);
    setMode(next.selected_mode);
    setBaseUrl(next.base_url ?? '');
    setModel(next.model ?? '');
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError('');
      try {
        applySettings(await api.getSettings(signal));
      } catch (loadError) {
        if (
          loadError instanceof DOMException &&
          loadError.name === 'AbortError'
        ) {
          return;
        }
        logger.error('admin_health_ai_settings_load_error', {
          component: 'AdminHealthAiSettingsPage',
          error: getErrorMessage(loadError, 'unknown'),
        });
        setError('无法载入 AI 服务设置，请确认管理员会话和服务状态后重试。');
      } finally {
        setLoading(false);
      }
    },
    [api, applySettings]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const draftDirty = useMemo(() => {
    if (!settings) return false;
    return (
      mode !== settings.selected_mode ||
      cleanValue(baseUrl) !== settings.base_url ||
      cleanValue(model) !== settings.model
    );
  }, [baseUrl, mode, model, settings]);

  const localFieldsReady =
    mode !== 'local' || (baseUrl.trim().length > 0 && model.trim().length > 0);
  const reasonReady = reason.trim().length >= 3;
  const canSave = Boolean(
    settings && draftDirty && localFieldsReady && reasonReady && !saving
  );
  const savedModeCanRun = Boolean(
    settings &&
    settings.selected_mode !== 'off' &&
    ((settings.selected_mode === 'test' &&
      settings.test_provider_allowed &&
      settings.instance_data_class === 'synthetic') ||
      (settings.selected_mode === 'local' &&
        settings.local_runtime_allowed &&
        settings.base_url &&
        settings.model))
  );
  const canTest = Boolean(
    settings &&
    !draftDirty &&
    savedModeCanRun &&
    reasonReady &&
    !testing &&
    !saving
  );

  const save = async () => {
    if (!settings || !canSave) return;
    setSaving(true);
    setError('');
    setNotice('');
    setTestResult(null);
    try {
      const next = await api.updateSettings({
        expected_revision: settings.configuration_revision,
        mode,
        base_url: cleanValue(baseUrl),
        model: cleanValue(model),
        reason: reason.trim(),
      });
      applySettings(next);
      setReason('');
      setNotice(
        next.connection_test_required
          ? '配置已保存。当前修订通过虚构数据连接测试后，才会对成员的“最近变化”安全整理生效。'
          : '配置已保存并按服务端返回状态生效。'
      );
    } catch (saveError) {
      logger.error('admin_health_ai_settings_save_error', {
        component: 'AdminHealthAiSettingsPage',
        error: getErrorMessage(saveError, 'unknown'),
      });
      setError(
        getOperationErrorMessage(
          saveError,
          '保存没有完成，当前配置未被界面视为已改变。请检查服务器状态后重试。'
        )
      );
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    if (!settings || !canTest) return;
    setTesting(true);
    setError('');
    setNotice('');
    setTestResult(null);
    try {
      const response = await api.testConnection({
        expected_revision: settings.configuration_revision,
        reason: reason.trim(),
      });
      setTestResult(response);
      setReason('');
      try {
        applySettings(await api.getSettings());
        setNotice(
          '测试完成。测试没有读取成员档案，也没有写入回答历史；它不代表医学正确性验证。'
        );
      } catch (refreshError) {
        logger.error('admin_health_ai_settings_refresh_after_test_error', {
          component: 'AdminHealthAiSettingsPage',
          error: getErrorMessage(refreshError, 'unknown'),
        });
        setNotice(
          '测试已通过，但状态刷新失败，请手动刷新。测试没有读取成员档案，也没有写入回答历史；它不代表医学正确性验证。'
        );
      }
    } catch (testError) {
      logger.error('admin_health_ai_connection_test_error', {
        component: 'AdminHealthAiSettingsPage',
        error: getErrorMessage(testError, 'unknown'),
      });
      const operationMessage = getOperationErrorMessage(
        testError,
        '连接测试没有通过。'
      );
      setError(
        `${operationMessage} 系统未读取成员数据，也没有自动切换到其他提供方。`
      );
    } finally {
      setTesting(false);
    }
  };

  const statusLabel =
    settings?.selected_mode === 'off'
      ? '已关闭'
      : settings?.available
        ? '已通过配置门禁'
        : '尚未通过配置门禁';
  const statusReason = settings?.reason_code
    ? (REASON_LABELS[settings.reason_code] ?? settings.reason_code)
    : settings?.available
      ? '仅表示当前修订已通过配置与连接门禁，不代表医学正确性或后续请求必然成功'
      : '等待配置';

  const content = (
    <div className="admin-health-ai-page">
      <header className="admin-health-ai-heading">
        <div>
          <Text className="admin-health-ai-eyebrow">唯一管理员设置</Text>
          <Title order={1}>AI 服务</Title>
          <Text c="dimmed">
            设置家庭服务器上的只读回答链路。通过结构、引用和安全检查的模型回答会展示给本人并保存到独立回答历史；手机和浏览器不会因此获得数据库、文件或健康档案写权限。
          </Text>
        </div>
        <Button
          variant="light"
          leftSection={<IconRefresh size={17} />}
          onClick={() => void load()}
          disabled={loading || saving || testing}
        >
          刷新状态
        </Button>
      </header>

      {error ? (
        <Alert color="red" icon={<IconAlertTriangle size={19} />} role="alert">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert color="teal" icon={<IconCheck size={19} />} role="status">
          {notice}
        </Alert>
      ) : null}

      {loading && !settings ? (
        <div className="admin-health-ai-loading">
          <Loader size="lg" />
          <Text c="dimmed">正在读取服务器配置…</Text>
        </div>
      ) : settings ? (
        <>
          <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
            <Card withBorder className="admin-health-ai-status-card">
              <Group wrap="nowrap" align="flex-start">
                <ThemeIcon
                  size="lg"
                  variant="light"
                  color={settings.available ? 'teal' : 'gray'}
                >
                  <IconServer size={21} />
                </ThemeIcon>
                <div>
                  <Text size="sm" c="dimmed">
                    运行状态
                  </Text>
                  <Group gap="xs">
                    <Text fw={700}>{statusLabel}</Text>
                    <Badge
                      color={settings.available ? 'teal' : 'gray'}
                      variant="light"
                    >
                      {MODE_LABELS[settings.selected_mode]}
                    </Badge>
                  </Group>
                  <Text size="sm" mt={4}>
                    {statusReason}
                  </Text>
                </div>
              </Group>
            </Card>
            <Card withBorder className="admin-health-ai-status-card">
              <Group wrap="nowrap" align="flex-start">
                <ThemeIcon size="lg" variant="light" color="violet">
                  <IconKey size={21} />
                </ThemeIcon>
                <div>
                  <Text size="sm" c="dimmed">
                    服务器密钥
                  </Text>
                  <Text fw={700}>
                    {settings.api_key_configured ? '已配置' : '未配置'}
                  </Text>
                  <Text size="sm" mt={4}>
                    仅从服务器 Secret 读取，本页面不接收也不回显密钥。
                  </Text>
                </div>
              </Group>
            </Card>
            <Card withBorder className="admin-health-ai-status-card">
              <Group wrap="nowrap" align="flex-start">
                <ThemeIcon size="lg" variant="light" color="blue">
                  <IconShieldLock size={21} />
                </ThemeIcon>
                <div>
                  <Text size="sm" c="dimmed">
                    配置版本
                  </Text>
                  <Text fw={700}>修订 {settings.configuration_revision}</Text>
                  <Text size="sm" mt={4}>
                    {settings.connection_test_required
                      ? '待虚构数据连接测试'
                      : settings.verified_revision ===
                            settings.configuration_revision &&
                          settings.selected_mode === 'local'
                        ? '当前修订已通过连接测试'
                        : settings.processing_location || '家庭服务器处理'}
                  </Text>
                </div>
              </Group>
            </Card>
          </SimpleGrid>

          <Card withBorder padding="lg">
            <Stack gap="md">
              <div>
                <Title order={2} size="h3">
                  提供方配置
                </Title>
                <Text size="sm" c="dimmed" mt={4}>
                  保存不会触发模型调用。不同模式之间不会自动降级或回退。
                </Text>
              </div>
              <NativeSelect
                label="运行模式"
                description="关闭、使用虚构记录验证链路，或连接家庭服务器上的轻量模型。"
                value={mode}
                onChange={event =>
                  setMode(event.currentTarget.value as AdminHealthAiMode)
                }
                data={[
                  { value: 'off', label: '关闭' },
                  {
                    value: 'test',
                    label: '虚构数据动态测试（非模型回答）',
                  },
                  { value: 'local', label: '家庭服务器模型' },
                ]}
              />

              {mode === 'test' ? (
                <Alert color="violet" icon={<IconSparkles size={19} />}>
                  <Text fw={700}>虚构数据动态测试·非模型回答</Text>
                  <Text size="sm">
                    只有服务器测试门禁已开启且实例标记为 synthetic
                    时才能启用。它按固定规则读取虚构记录，用于验证数据流和引用，不代表大模型质量。
                  </Text>
                </Alert>
              ) : null}

              {mode === 'local' ? (
                <div className="admin-health-ai-local-fields">
                  <Card withBorder padding="sm">
                    <Group justify="space-between" align="flex-start">
                      <div>
                        <Text fw={700}>家庭服务器连接起步</Text>
                        <Text size="sm" c="dimmed">
                          本机实测的 Qwen3 0.6B 和 1.7B
                          均未通过当前逐记录绑定门禁，因此不预填模型。按钮只填写本机
                          Ollama 地址，不会下载、启动、保存或启用任何模型。
                        </Text>
                      </div>
                      <Button
                        type="button"
                        variant="light"
                        size="compact-sm"
                        onClick={() => {
                          setBaseUrl(LOCAL_ENDPOINT_PRESET.baseUrl);
                        }}
                      >
                        填入本机地址
                      </Button>
                    </Group>
                  </Card>
                  <TextInput
                    label={t(
                      'healthAi.localBaseUrl.label',
                      'OpenAI-compatible 服务地址'
                    )}
                    description={t(
                      'healthAi.localBaseUrl.description',
                      '只允许 127.0.0.1、localhost、::1 或 host.docker.internal；服务端会再次校验。'
                    )}
                    placeholder={t(
                      'healthAi.localBaseUrl.placeholder',
                      '例如 http://127.0.0.1:11434/v1'
                    )}
                    value={baseUrl}
                    onChange={event => setBaseUrl(event.currentTarget.value)}
                    required
                  />
                  <TextInput
                    label={t('healthAi.model.label', '模型 ID')}
                    description={t(
                      'healthAi.model.description',
                      '模型 ID 必须由管理员手动填写；保存后仍需用固定虚构数据通过当前修订和安全合同的连接测试。'
                    )}
                    placeholder={t(
                      'healthAi.model.placeholder',
                      '例如已自行验证的本机模型 ID'
                    )}
                    value={model}
                    onChange={event => setModel(event.currentTarget.value)}
                    required
                  />
                </div>
              ) : null}

              <Textarea
                label="本次操作原因"
                description="至少 3 个字符。保存配置和连接测试都会单独写入脱敏审计。"
                placeholder="例如：启用虚构数据链路验收"
                value={reason}
                onChange={event => setReason(event.currentTarget.value)}
                minRows={2}
                required
              />

              {!localFieldsReady ? (
                <Text c="orange" size="sm">
                  家庭服务器模式需要同时填写服务地址和模型 ID。
                </Text>
              ) : null}
              {draftDirty ? (
                <Text c="orange" size="sm" role="status">
                  有尚未保存的修改。连接测试只会使用已保存配置。
                </Text>
              ) : null}

              <Group justify="flex-end">
                <Button
                  variant="default"
                  leftSection={<IconSparkles size={17} />}
                  onClick={() => void testConnection()}
                  loading={testing}
                  disabled={!canTest}
                >
                  使用虚构数据动态测试当前配置
                </Button>
                <Button
                  leftSection={<IconCheck size={17} />}
                  onClick={() => void save()}
                  loading={saving}
                  disabled={!canSave}
                >
                  保存配置
                </Button>
              </Group>
            </Stack>
          </Card>

          <Card withBorder padding="lg">
            <Title order={2} size="h3">
              边界与门禁
            </Title>
            <div className="admin-health-ai-guard-grid">
              <div>
                <Text size="sm" c="dimmed">
                  虚构测试门禁
                </Text>
                <Badge
                  color={settings.test_provider_allowed ? 'teal' : 'gray'}
                  variant="light"
                >
                  {settings.test_provider_allowed ? '允许' : '未允许'}
                </Badge>
              </div>
              <div>
                <Text size="sm" c="dimmed">
                  实例数据类别
                </Text>
                <Code>{settings.instance_data_class}</Code>
              </div>
              <div>
                <Text size="sm" c="dimmed">
                  本地模型门禁
                </Text>
                <Badge
                  color={settings.local_runtime_allowed ? 'teal' : 'gray'}
                  variant="light"
                >
                  {settings.local_runtime_allowed ? '允许' : '未允许'}
                </Badge>
              </div>
            </div>
            <Text size="sm" c="dimmed" mt="md">
              {settings.disclosure}
            </Text>
            {settings.last_tested_at ? (
              <Text size="sm" c="dimmed" mt="xs">
                最近通过连接测试：{settings.last_tested_at}
              </Text>
            ) : null}
          </Card>

          {testResult ? (
            <Card
              withBorder
              padding="lg"
              className="admin-health-ai-test-output"
            >
              <Group justify="space-between" align="flex-start">
                <div>
                  <Text className="admin-health-ai-eyebrow">
                    虚构数据连接测试
                  </Text>
                  <Title order={2} size="h3">
                    {testResult.test_mode
                      ? '虚构数据动态测试·非模型回答'
                      : '家庭服务器配置测试结果'}
                  </Title>
                </div>
                <Badge color="teal" variant="light">
                  {testResult.status}
                </Badge>
              </Group>
              <Text size="sm" c="dimmed" mt="xs">
                {testResult.model || testResult.provider} ·{' '}
                {testResult.processing_location}
              </Text>
              <Stack gap="sm" mt="md">
                {testResult.output.answer_items.map((item, index) => (
                  <Text key={`${index}-${item.text}`}>
                    {item.text}{' '}
                    <Text component="span" c="blue" fw={700}>
                      {item.citation_ids.map(id => `[${id}]`).join(' ')}
                    </Text>
                  </Text>
                ))}
              </Stack>
              <Text size="sm" c="dimmed" mt="md">
                {testResult.disclosure}
              </Text>
              <Text size="sm" c="dimmed" mt="xs">
                测试时间：{testResult.tested_at}
              </Text>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );

  return standalone ? content : <AdminLayout>{content}</AdminLayout>;
};

export default AdminHealthAiSettingsPage;
