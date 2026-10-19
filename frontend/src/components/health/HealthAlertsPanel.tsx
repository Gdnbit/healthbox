import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconBell,
  IconBellOff,
  IconClock,
  IconPlus,
  IconRefresh,
  IconShieldCheck,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import healthAlertApi, {
  type EvaluatedHealthAlert,
  type HealthAlertOperator,
  type HealthAlertRule,
  type HealthAlertRuleInput,
  type HealthAlertRuleType,
} from '../../services/api/healthAlertApi';

interface HealthAlertsPanelProps {
  patientId: number;
}

const DEFAULT_RULE: HealthAlertRuleInput = {
  name: '',
  rule_type: 'threshold',
  test_name: '',
  unit: '',
  operator: 'gt',
  threshold_value: null,
  overdue_days: null,
  enabled: true,
};

const severityColor = (severity: EvaluatedHealthAlert['severity']) => {
  if (severity === 'critical') return 'red';
  if (severity === 'warning') return 'orange';
  return 'blue';
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
};

const formatEvidenceValue = (alert: EvaluatedHealthAlert) => {
  const { evidence } = alert;
  if (typeof evidence.numeric_value === 'number') {
    const value = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 6,
    }).format(evidence.numeric_value);
    return evidence.unit ? `${value} ${evidence.unit}` : value;
  }
  return evidence.qualitative_value || evidence.textual_value || '—';
};

const HealthAlertsPanel = ({ patientId }: HealthAlertsPanelProps) => {
  const { t } = useTranslation('healthInsights');
  const [alerts, setAlerts] = useState<EvaluatedHealthAlert[]>([]);
  const [rules, setRules] = useState<HealthAlertRule[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [mutedCount, setMutedCount] = useState(0);
  const [calculatedAt, setCalculatedAt] = useState<string | null>(null);
  const [includeMuted, setIncludeMuted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [ruleForm, setRuleForm] = useState<HealthAlertRuleInput>(DEFAULT_RULE);
  const [savingRule, setSavingRule] = useState(false);
  const [workingAlertId, setWorkingAlertId] = useState<string | null>(null);
  const [workingRuleId, setWorkingRuleId] = useState<number | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(false);
      try {
        const [evaluation, storedRules] = await Promise.all([
          healthAlertApi.evaluate(patientId, includeMuted, signal),
          healthAlertApi.listRules(patientId, signal),
        ]);
        setAlerts(evaluation.alerts || []);
        setActiveCount(evaluation.active_count || 0);
        setMutedCount(evaluation.muted_count || 0);
        setCalculatedAt(evaluation.calculated_at || null);
        setRules(storedRules || []);
      } catch (loadError) {
        if (signal?.aborted) return;
        setError(true);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [includeMuted, patientId]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const ruleTypeOptions = useMemo(
    () => [
      {
        value: 'threshold',
        label: t('healthAlerts.types.threshold', 'Numeric threshold'),
      },
      {
        value: 'overdue',
        label: t('healthAlerts.types.overdue', 'Record interval'),
      },
    ],
    [t]
  );

  const operatorOptions = useMemo(
    () =>
      (['gt', 'gte', 'lt', 'lte'] as HealthAlertOperator[]).map(value => ({
        value,
        label: t(`healthAlerts.operators.${value}`),
      })),
    [t]
  );

  const setRuleType = (value: string | null) => {
    const ruleType = (value || 'threshold') as HealthAlertRuleType;
    setRuleForm(current => ({
      ...current,
      rule_type: ruleType,
      unit: ruleType === 'threshold' ? current.unit : null,
      operator: ruleType === 'threshold' ? current.operator || 'gt' : null,
      threshold_value:
        ruleType === 'threshold' ? current.threshold_value : null,
      overdue_days: ruleType === 'overdue' ? current.overdue_days : null,
    }));
  };

  const canSaveRule =
    ruleForm.name.trim().length > 0 &&
    ruleForm.test_name.trim().length > 0 &&
    (ruleForm.rule_type === 'threshold'
      ? Boolean(ruleForm.unit?.trim()) &&
        Boolean(ruleForm.operator) &&
        typeof ruleForm.threshold_value === 'number'
      : typeof ruleForm.overdue_days === 'number' &&
        ruleForm.overdue_days >= 1);

  const createRule = async () => {
    if (!canSaveRule) return;
    setSavingRule(true);
    try {
      await healthAlertApi.createRule(patientId, {
        ...ruleForm,
        name: ruleForm.name.trim(),
        test_name: ruleForm.test_name.trim(),
        unit: ruleForm.unit?.trim() || null,
      });
      notifications.show({
        color: 'teal',
        message: t('healthAlerts.ruleSuccess', 'Rule saved and recalculated.'),
      });
      setRuleModalOpen(false);
      setRuleForm(DEFAULT_RULE);
      await load();
    } catch (ruleError) {
      notifications.show({
        color: 'red',
        message: t('healthAlerts.ruleError', 'Unable to save this rule.'),
      });
    } finally {
      setSavingRule(false);
    }
  };

  const toggleRule = async (rule: HealthAlertRule) => {
    setWorkingRuleId(rule.id);
    try {
      const input: HealthAlertRuleInput = {
        name: rule.name,
        rule_type: rule.rule_type,
        test_name: rule.test_name,
        unit: rule.unit,
        operator: rule.operator,
        threshold_value: rule.threshold_value,
        overdue_days: rule.overdue_days,
        enabled: !rule.enabled,
      };
      await healthAlertApi.updateRule(rule.id, input);
      await load();
    } catch (ruleError) {
      notifications.show({
        color: 'red',
        message: t('healthAlerts.ruleError', 'Unable to save this rule.'),
      });
    } finally {
      setWorkingRuleId(null);
    }
  };

  const muteAlert = async (alertId: string, days: number) => {
    setWorkingAlertId(alertId);
    try {
      const mutedUntil = new Date();
      mutedUntil.setDate(mutedUntil.getDate() + days);
      await healthAlertApi.mute(patientId, alertId, mutedUntil.toISOString());
      notifications.show({
        color: 'teal',
        message: t('healthAlerts.muteSuccess', 'Alert muted.'),
      });
      await load();
    } catch (actionError) {
      notifications.show({
        color: 'red',
        message: t('healthAlerts.actionError', 'Unable to update this alert.'),
      });
    } finally {
      setWorkingAlertId(null);
    }
  };

  const unmuteAlert = async (alertId: string) => {
    setWorkingAlertId(alertId);
    try {
      await healthAlertApi.unmute(patientId, alertId);
      notifications.show({
        color: 'teal',
        message: t('healthAlerts.unmuteSuccess', 'Alert restored.'),
      });
      await load();
    } catch (actionError) {
      notifications.show({
        color: 'red',
        message: t('healthAlerts.actionError', 'Unable to update this alert.'),
      });
    } finally {
      setWorkingAlertId(null);
    }
  };

  if (loading) {
    return (
      <Paper withBorder radius="md" p="xl">
        <Group justify="center">
          <Loader size="sm" />
          <Text>{t('healthAlerts.loading', 'Recalculating alerts…')}</Text>
        </Group>
      </Paper>
    );
  }

  if (error) {
    return (
      <Alert color="red" icon={<IconAlertTriangle size={18} />}>
        <Group justify="space-between">
          <Text>{t('healthAlerts.error', 'Unable to calculate alerts.')}</Text>
          <Button variant="light" color="red" onClick={() => void load()}>
            {t('healthAlerts.retry', 'Try again')}
          </Button>
        </Group>
      </Alert>
    );
  }

  return (
    <Stack gap="lg">
      <Alert color="blue" icon={<IconShieldCheck size={20} />}>
        <Text fw={650}>
          {t('healthAlerts.safetyTitle', 'Rule-based reminders')}
        </Text>
        <Text size="sm">
          {t(
            'healthAlerts.safetyNotice',
            'These alerts only organize stored records using visible, deterministic rules. They are not a diagnosis, risk score or treatment recommendation.'
          )}
        </Text>
      </Alert>

      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Card withBorder radius="md" p="md">
          <Group justify="space-between">
            <div>
              <Text size="sm" c="dimmed">
                {t('healthAlerts.activeCount', 'Active alerts')}
              </Text>
              <Text size="xl" fw={700}>
                {activeCount}
              </Text>
            </div>
            <IconBell color="var(--mantine-color-orange-6)" />
          </Group>
        </Card>
        <Card withBorder radius="md" p="md">
          <Group justify="space-between">
            <div>
              <Text size="sm" c="dimmed">
                {t('healthAlerts.mutedCount', 'Muted alerts')}
              </Text>
              <Text size="xl" fw={700}>
                {mutedCount}
              </Text>
            </div>
            <IconBellOff color="var(--mantine-color-gray-6)" />
          </Group>
        </Card>
        <Card withBorder radius="md" p="md">
          <Group justify="space-between" wrap="nowrap">
            <div>
              <Text size="sm" c="dimmed">
                {t('healthAlerts.calculatedAt', 'Calculated at')}
              </Text>
              <Text fw={650}>{formatDateTime(calculatedAt)}</Text>
            </div>
            <IconClock color="var(--mantine-color-blue-6)" />
          </Group>
        </Card>
      </SimpleGrid>

      <Paper withBorder radius="md" p="md">
        <Stack gap="md">
          <Group justify="space-between">
            <div>
              <Title order={3}>{t('healthAlerts.title', 'Alerts')}</Title>
              <Text size="sm" c="dimmed">
                {t(
                  'healthAlerts.description',
                  'Every alert shows its evidence, source, rule version and limitations.'
                )}
              </Text>
            </div>
            <Group>
              <Checkbox
                checked={includeMuted}
                onChange={event => setIncludeMuted(event.currentTarget.checked)}
                label={t('healthAlerts.showMuted', 'Show muted')}
              />
              <Button
                variant="light"
                leftSection={<IconRefresh size={16} />}
                onClick={() => void load()}
              >
                {t('actions.refresh', 'Refresh')}
              </Button>
            </Group>
          </Group>

          {alerts.length === 0 ? (
            <Text c="dimmed" ta="center" py="xl">
              {t('healthAlerts.empty', 'No current rule-based alerts.')}
            </Text>
          ) : (
            <Stack gap="sm">
              {alerts.map(alert => (
                <Card key={alert.alert_id} withBorder radius="md" p="md">
                  <Stack gap="sm">
                    <Group justify="space-between" align="flex-start">
                      <div>
                        <Group gap="xs">
                          <Text fw={700}>{alert.title}</Text>
                          <Badge
                            color={severityColor(alert.severity)}
                            variant="light"
                          >
                            {t(`healthAlerts.severity.${alert.severity}`)}
                          </Badge>
                          <Badge variant="outline">
                            {t(`healthAlerts.types.${alert.alert_type}`)}
                          </Badge>
                        </Group>
                        <Text size="sm" mt={4}>
                          {t(`healthAlerts.explanations.${alert.alert_type}`)}
                        </Text>
                      </div>
                      {alert.muted_until ? (
                        <Button
                          size="xs"
                          variant="light"
                          loading={workingAlertId === alert.alert_id}
                          onClick={() => void unmuteAlert(alert.alert_id)}
                        >
                          {t('healthAlerts.unmute', 'Restore')}
                        </Button>
                      ) : (
                        <Select
                          w={150}
                          size="xs"
                          placeholder={t('healthAlerts.mute', 'Mute')}
                          disabled={workingAlertId === alert.alert_id}
                          value={null}
                          onChange={value => {
                            if (value)
                              void muteAlert(alert.alert_id, Number(value));
                          }}
                          data={[7, 30, 90].map(days => ({
                            value: String(days),
                            label: t(
                              'healthAlerts.muteDays',
                              '{{count}} days',
                              { count: days }
                            ),
                          }))}
                        />
                      )}
                    </Group>

                    <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                      <div>
                        <Text size="xs" c="dimmed">
                          {t('healthAlerts.value', 'Stored value')}
                        </Text>
                        <Text fw={650}>{formatEvidenceValue(alert)}</Text>
                      </div>
                      <div>
                        <Text size="xs" c="dimmed">
                          {t('healthAlerts.observedDate', 'Observed date')}
                        </Text>
                        <Text fw={650}>
                          {alert.evidence.observed_date || '—'}
                        </Text>
                      </div>
                      <div>
                        <Text size="xs" c="dimmed">
                          {t('healthAlerts.source', 'Source')}
                        </Text>
                        <Text fw={650}>
                          {alert.source.source_document_id
                            ? t(
                                'healthAlerts.sourceLocation',
                                'Document {{document}}, page {{page}}',
                                {
                                  document: alert.source.source_document_id,
                                  page: alert.source.source_page || '—',
                                }
                              )
                            : t(
                                'healthAlerts.recordSource',
                                'Lab record {{record}}',
                                {
                                  record: alert.source.lab_result_id,
                                }
                              )}
                        </Text>
                        {alert.source.source_locator && (
                          <Text size="xs" c="dimmed">
                            {alert.source.source_locator}
                          </Text>
                        )}
                      </div>
                      <div>
                        <Text size="xs" c="dimmed">
                          {t('healthAlerts.rule', 'Rule')}
                        </Text>
                        <Text fw={650}>{alert.rule_description}</Text>
                        <Text size="xs" c="dimmed">
                          {alert.rule_id} ·{' '}
                          {t('healthAlerts.version', 'v{{version}}', {
                            version: alert.rule_version,
                          })}
                        </Text>
                      </div>
                    </SimpleGrid>

                    {(alert.evidence.threshold_operator ||
                      alert.evidence.overdue_days) && (
                      <Text size="sm">
                        {alert.evidence.threshold_operator
                          ? t(
                              'healthAlerts.thresholdEvidence',
                              'Rule: latest value {{operator}} {{value}} {{unit}}',
                              {
                                operator: t(
                                  `healthAlerts.operators.${alert.evidence.threshold_operator}`,
                                  {
                                    defaultValue:
                                      alert.evidence.threshold_operator,
                                  }
                                ),
                                value: alert.evidence.threshold_value,
                                unit: alert.evidence.unit || '',
                              }
                            )
                          : t(
                              'healthAlerts.overdueEvidence',
                              'Rule: more than {{days}} days; currently {{elapsed}} days since the latest stored record.',
                              {
                                days: alert.evidence.overdue_days,
                                elapsed: alert.evidence.elapsed_days,
                              }
                            )}
                      </Text>
                    )}

                    <Alert color="gray" variant="light">
                      <Text size="xs" fw={650}>
                        {t('healthAlerts.limitations', 'Limitations')}
                      </Text>
                      <Text size="xs">
                        {t(`healthAlerts.limitationsText.${alert.alert_type}`)}
                      </Text>
                      {alert.muted_until && (
                        <Text size="xs" mt={4}>
                          {t(
                            'healthAlerts.mutedUntil',
                            'Muted until {{date}}',
                            {
                              date: formatDateTime(alert.muted_until),
                            }
                          )}
                        </Text>
                      )}
                    </Alert>
                  </Stack>
                </Card>
              ))}
            </Stack>
          )}
        </Stack>
      </Paper>

      <Paper withBorder radius="md" p="md">
        <Stack gap="md">
          <Group justify="space-between">
            <div>
              <Title order={3}>
                {t('healthAlerts.rulesTitle', 'Custom rules')}
              </Title>
              <Text size="sm" c="dimmed">
                {t(
                  'healthAlerts.rulesDescription',
                  'Rules use exact metric names and units from stored records.'
                )}
              </Text>
            </div>
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => setRuleModalOpen(true)}
            >
              {t('healthAlerts.addRule', 'Add rule')}
            </Button>
          </Group>

          {rules.length === 0 ? (
            <Text c="dimmed">
              {t('healthAlerts.rulesEmpty', 'No custom rules yet.')}
            </Text>
          ) : (
            <Stack gap="xs">
              {rules.map(rule => (
                <Card key={rule.id} withBorder radius="md" p="sm">
                  <Group justify="space-between" align="center">
                    <div>
                      <Group gap="xs">
                        <Text fw={650}>{rule.name}</Text>
                        <Badge variant="light">
                          {t(`healthAlerts.types.${rule.rule_type}`)}
                        </Badge>
                        <Badge
                          color={rule.enabled ? 'teal' : 'gray'}
                          variant="light"
                        >
                          {rule.enabled
                            ? t('healthAlerts.enabled', 'Enabled')
                            : t('healthAlerts.disabled', 'Disabled')}
                        </Badge>
                      </Group>
                      <Text size="sm" c="dimmed">
                        {rule.test_name}
                        {rule.unit ? ` · ${rule.unit}` : ''} ·{' '}
                        {t('healthAlerts.version', 'v{{version}}', {
                          version: rule.version,
                        })}
                      </Text>
                    </div>
                    <Switch
                      checked={rule.enabled}
                      disabled={workingRuleId === rule.id}
                      aria-label={
                        rule.enabled
                          ? t('healthAlerts.disable', 'Disable')
                          : t('healthAlerts.enable', 'Enable')
                      }
                      onChange={() => void toggleRule(rule)}
                    />
                  </Group>
                </Card>
              ))}
            </Stack>
          )}
        </Stack>
      </Paper>

      <Modal
        opened={ruleModalOpen}
        onClose={() => setRuleModalOpen(false)}
        title={t('healthAlerts.addRule', 'Add rule')}
        centered
      >
        <Stack gap="md">
          <TextInput
            required
            label={t('healthAlerts.ruleName', 'Rule name')}
            value={ruleForm.name}
            onChange={event =>
              setRuleForm(current => ({
                ...current,
                name: event.currentTarget.value,
              }))
            }
          />
          <Select
            required
            allowDeselect={false}
            label={t('healthAlerts.ruleType', 'Rule type')}
            data={ruleTypeOptions}
            value={ruleForm.rule_type}
            onChange={setRuleType}
          />
          <TextInput
            required
            label={t('healthAlerts.testName', 'Exact metric name')}
            description={t(
              'healthAlerts.testNameHelp',
              'Use the exact name shown in the metric catalog.'
            )}
            value={ruleForm.test_name}
            onChange={event =>
              setRuleForm(current => ({
                ...current,
                test_name: event.currentTarget.value,
              }))
            }
          />
          {ruleForm.rule_type === 'threshold' ? (
            <>
              <TextInput
                required
                label={t('healthAlerts.unit', 'Exact unit')}
                value={ruleForm.unit || ''}
                onChange={event =>
                  setRuleForm(current => ({
                    ...current,
                    unit: event.currentTarget.value,
                  }))
                }
              />
              <SimpleGrid cols={2}>
                <Select
                  required
                  allowDeselect={false}
                  label={t('healthAlerts.operator', 'Operator')}
                  data={operatorOptions}
                  value={ruleForm.operator}
                  onChange={value =>
                    setRuleForm(current => ({
                      ...current,
                      operator: value as HealthAlertOperator,
                    }))
                  }
                />
                <NumberInput
                  required
                  label={t('healthAlerts.thresholdValue', 'Threshold value')}
                  value={ruleForm.threshold_value ?? ''}
                  onChange={value =>
                    setRuleForm(current => ({
                      ...current,
                      threshold_value: typeof value === 'number' ? value : null,
                    }))
                  }
                />
              </SimpleGrid>
            </>
          ) : (
            <NumberInput
              required
              min={1}
              max={3650}
              label={t(
                'healthAlerts.overdueDays',
                'Days since latest stored record'
              )}
              value={ruleForm.overdue_days ?? ''}
              onChange={value =>
                setRuleForm(current => ({
                  ...current,
                  overdue_days: typeof value === 'number' ? value : null,
                }))
              }
            />
          )}
          <Checkbox
            checked={ruleForm.enabled}
            onChange={event =>
              setRuleForm(current => ({
                ...current,
                enabled: event.currentTarget.checked,
              }))
            }
            label={t('healthAlerts.enabled', 'Enabled')}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRuleModalOpen(false)}>
              {t('healthAlerts.cancel', 'Cancel')}
            </Button>
            <Button
              disabled={!canSaveRule}
              loading={savingRule}
              onClick={() => void createRule()}
            >
              {t('healthAlerts.saveRule', 'Save rule')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default HealthAlertsPanel;
