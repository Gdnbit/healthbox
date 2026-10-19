import {
  Alert,
  Autocomplete,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconChecklist,
  IconHistory,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import healthCoverageApi, {
  type HealthCoverageAbsenceReason,
  type HealthCoverageContent,
  type HealthCoverageStatement,
  type HealthCoverageVerification,
} from '../../services/api/healthCoverageApi';
import type { OwnerHealthReadAccess } from '../../services/api/healthBackgroundApi';
import healthImportApi, {
  type HealthSourceDocument,
} from '../../services/api/healthImportApi';
import type { LabTestComponentForStack } from '../../services/api/labTestComponentApi';
import {
  buildCoverageEvidence,
  type CoverageEvidenceSummary,
} from '../../utils/healthCoverageEvidence';
import {
  getMetricDisplayName,
  getNormalizedMetricKey,
} from '../../utils/householdHealthDashboard';
import HealthCoverageMatrix from './HealthCoverageMatrix';

interface HealthCoverageEvidencePanelProps {
  patientId: number;
  components: LabTestComponentForStack[];
  componentsLoading: boolean;
  componentsError: boolean;
  onChanged?: () => void;
  onOpenLabRecord: (_labResultId: number) => void;
  onOpenSourceDocument: (_sourceDocumentId: number) => void;
  maintenance?: {
    readAccess: OwnerHealthReadAccess;
    notice: string;
  };
}

interface CoverageForm {
  examDate: string;
  metricKey: string;
  metricName: string;
  metricCode: string;
  absenceReason: HealthCoverageAbsenceReason;
  verificationStatus: HealthCoverageVerification;
  note: string;
  sourceDocumentId: string;
  sourcePage: string;
  sourceLocator: string;
  changeNote: string;
}

const EMPTY_FORM: CoverageForm = {
  examDate: '',
  metricKey: '',
  metricName: '',
  metricCode: '',
  absenceReason: 'not-performed',
  verificationStatus: 'confirmed',
  note: '',
  sourceDocumentId: '',
  sourcePage: '',
  sourceLocator: '',
  changeNote: '',
};

const normalizeMetricKey = (value: string) =>
  value.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');

const toOptionalNumber = (value: string) => {
  const parsed = Number(value);
  return value.trim() && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const localToday = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const summaryItems = [
  {
    key: 'recordedObservations',
    translationKey: 'coverageEvidence.summary.recorded',
    color: 'teal',
  },
  {
    key: 'confirmedNotPerformed',
    translationKey: 'coverageEvidence.summary.notPerformed',
    color: 'grape',
  },
  {
    key: 'notApplicable',
    translationKey: 'coverageEvidence.summary.notApplicable',
    color: 'gray',
  },
  {
    key: 'unknown',
    translationKey: 'coverageEvidence.summary.unknown',
    color: 'blue',
  },
  {
    key: 'needsReview',
    translationKey: 'coverageEvidence.summary.needsReview',
    color: 'orange',
  },
  {
    key: 'questionable',
    translationKey: 'coverageEvidence.summary.questionable',
    color: 'yellow',
  },
  {
    key: 'conflicts',
    translationKey: 'coverageEvidence.summary.conflicts',
    color: 'red',
  },
  {
    key: 'undatedObservations',
    translationKey: 'coverageEvidence.summary.undated',
    color: 'gray',
  },
] as const satisfies ReadonlyArray<{
  key: keyof CoverageEvidenceSummary;
  translationKey: string;
  color: string;
}>;

const HealthCoverageEvidencePanel = ({
  patientId,
  components,
  componentsLoading,
  componentsError,
  onChanged,
  onOpenLabRecord,
  onOpenSourceDocument,
  maintenance,
}: HealthCoverageEvidencePanelProps) => {
  const { t } = useTranslation('healthInsights');
  const [statements, setStatements] = useState<HealthCoverageStatement[]>([]);
  const [sources, setSources] = useState<HealthSourceDocument[]>([]);
  const [includeHistory, setIncludeHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<HealthCoverageStatement | null>(null);
  const [form, setForm] = useState<CoverageForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [voiding, setVoiding] = useState<HealthCoverageStatement | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(false);
      try {
        setStatements(
          maintenance
            ? await healthCoverageApi.list(
                patientId,
                includeHistory,
                signal,
                maintenance.readAccess
              )
            : await healthCoverageApi.list(patientId, includeHistory, signal)
        );
      } catch (_loadError) {
        if (!signal?.aborted) setError(true);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [includeHistory, maintenance, patientId]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    healthImportApi
      .listSourceDocuments(
        patientId,
        controller.signal,
        false,
        maintenance?.readAccess
      )
      .then(setSources)
      .catch(() => {
        if (!controller.signal.aborted) setSources([]);
      });
    return () => controller.abort();
  }, [maintenance, patientId]);

  const knownMetrics = useMemo(() => {
    const metrics = new Map<string, { key: string; name: string }>();
    components.forEach(component => {
      const key = getNormalizedMetricKey(component);
      if (!key || metrics.has(key)) return;
      metrics.set(key, { key, name: getMetricDisplayName(component) });
    });
    return Array.from(metrics.values()).sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    );
  }, [components]);

  const currentStatements = useMemo(
    () =>
      statements.filter(
        statement => statement.is_current && statement.status === 'active'
      ),
    [statements]
  );
  const exactEvidence = useMemo(
    () => buildCoverageEvidence(components, currentStatements, 'date'),
    [components, currentStatements]
  );
  const annualEvidence = useMemo(
    () => buildCoverageEvidence(components, currentStatements, 'year'),
    [components, currentStatements]
  );

  const reasonOptions = useMemo(
    () =>
      (['not-performed', 'not-applicable', 'unknown'] as const).map(value => ({
        value,
        label: t(`coverageEvidence.reasons.${value}`),
      })),
    [t]
  );
  const verificationOptions = useMemo(
    () =>
      (['confirmed', 'needs_review', 'questionable'] as const).map(value => ({
        value,
        label: t(`coverageEvidence.verification.${value}`),
      })),
    [t]
  );
  const sourceOptions = useMemo(
    () =>
      sources.map(source => ({
        value: String(source.id),
        label: source.report_date
          ? `${source.display_name} · ${source.report_date}`
          : source.display_name,
      })),
    [sources]
  );

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openRevision = (statement: HealthCoverageStatement) => {
    setEditing(statement);
    setForm({
      examDate: statement.exam_date,
      metricKey: statement.metric_key,
      metricName: statement.metric_name,
      metricCode: statement.metric_code || '',
      absenceReason: statement.absence_reason,
      verificationStatus: statement.verification_status,
      note: statement.note || '',
      sourceDocumentId: statement.source_document_id?.toString() || '',
      sourcePage: statement.source_page?.toString() || '',
      sourceLocator: statement.source_locator || '',
      changeNote: '',
    });
    setFormOpen(true);
  };

  const updateMetricName = (metricName: string) => {
    const known = knownMetrics.find(metric => metric.name === metricName);
    setForm(current => ({
      ...current,
      metricName,
      metricKey: known?.key || normalizeMetricKey(metricName),
    }));
  };

  const contentFromForm = (): HealthCoverageContent => ({
    exam_date: form.examDate,
    metric_key: form.metricKey || normalizeMetricKey(form.metricName),
    metric_name: form.metricName.trim(),
    metric_code: form.metricCode.trim() || null,
    absence_reason: form.absenceReason,
    verification_status: form.verificationStatus,
    note: form.note.trim() || null,
    source_document_id: toOptionalNumber(form.sourceDocumentId),
    source_page: toOptionalNumber(form.sourcePage),
    source_locator: form.sourceLocator.trim() || null,
  });

  const canSave =
    form.examDate.length > 0 &&
    form.metricName.trim().length > 0 &&
    (form.metricKey || normalizeMetricKey(form.metricName)).length > 0 &&
    (!editing || form.changeNote.trim().length > 0);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (editing) {
        await healthCoverageApi.revise(
          editing.id,
          {
            ...contentFromForm(),
            expected_version: editing.version_number,
            change_note: form.changeNote.trim(),
          },
          maintenance
            ? {
                capability: 'owner_record_revise',
                reason: form.changeNote.trim(),
              }
            : undefined
        );
      } else {
        await healthCoverageApi.create(patientId, contentFromForm());
      }
      notifications.show({
        color: 'teal',
        message: t('coverageEvidence.saveSuccess'),
      });
      setFormOpen(false);
      await load();
      onChanged?.();
    } catch (saveError: unknown) {
      const status = (saveError as { response?: { status?: number } })?.response
        ?.status;
      notifications.show({
        color: 'red',
        message: t(
          status === 409
            ? 'coverageEvidence.conflict'
            : 'coverageEvidence.saveError'
        ),
      });
    } finally {
      setSaving(false);
    }
  };

  const confirmVoid = async () => {
    if (!voiding || !voidReason.trim()) return;
    setSaving(true);
    try {
      await healthCoverageApi.void(
        voiding.id,
        voiding.version_number,
        voidReason.trim(),
        maintenance
          ? {
              capability: 'owner_record_void',
              reason: voidReason.trim(),
            }
          : undefined
      );
      notifications.show({
        color: 'teal',
        message: t('coverageEvidence.voidSuccess'),
      });
      setVoiding(null);
      setVoidReason('');
      await load();
      onChanged?.();
    } catch (_voidError) {
      notifications.show({
        color: 'red',
        message: t('coverageEvidence.saveError'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={3}>{t('coverageEvidence.title')}</Title>
          <Text size="sm" c="dimmed" maw={820}>
            {t('coverageEvidence.description')}
          </Text>
        </div>
        <Group>
          <Button
            variant="subtle"
            leftSection={<IconRefresh size={16} />}
            onClick={() => void load()}
          >
            {t('actions.refresh')}
          </Button>
          {!maintenance && (
            <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
              {t('coverageEvidence.add')}
            </Button>
          )}
        </Group>
      </Group>

      {maintenance && (
        <Alert color="orange" icon={<IconAlertTriangle size={18} />}>
          {maintenance.notice}
        </Alert>
      )}

      <Alert color="blue" icon={<IconChecklist size={18} />}>
        {t('coverageEvidence.noPercentageNotice')}
      </Alert>

      <SimpleGrid cols={{ base: 2, sm: 4, lg: 8 }}>
        {summaryItems.map(item => (
          <Card withBorder p="sm" key={item.key}>
            <Text size="xs" c="dimmed">
              {t(item.translationKey)}
            </Text>
            <Text size="xl" fw={700} c={item.color}>
              {exactEvidence.summary[item.key]}
            </Text>
          </Card>
        ))}
      </SimpleGrid>

      <HealthCoverageMatrix
        evidenceMatrix={exactEvidence.matrix}
        annualEvidenceMatrix={annualEvidence.matrix}
        loading={componentsLoading || loading}
        error={componentsError || error}
        onOpenLabRecord={onOpenLabRecord}
        onOpenSourceDocument={onOpenSourceDocument}
      />

      <Card withBorder radius="md" p="md">
        <Stack gap="md">
          <Group justify="space-between">
            <div>
              <Title order={4}>{t('coverageEvidence.statementsTitle')}</Title>
              <Text size="sm" c="dimmed">
                {t('coverageEvidence.statementsDescription')}
              </Text>
            </div>
            <Switch
              checked={includeHistory}
              onChange={event => setIncludeHistory(event.currentTarget.checked)}
              label={t('coverageEvidence.showHistory')}
            />
          </Group>

          {error ? (
            <Alert color="red" icon={<IconAlertTriangle size={18} />}>
              {t('coverageEvidence.loadError')}
            </Alert>
          ) : loading ? (
            <Center mih={120}>
              <Loader aria-label={t('coverageEvidence.loading')} />
            </Center>
          ) : statements.length === 0 ? (
            <Text c="dimmed">{t('coverageEvidence.empty')}</Text>
          ) : (
            <SimpleGrid cols={{ base: 1, md: 2 }}>
              {statements.map(statement => (
                <Card withBorder key={statement.id} p="md">
                  <Stack gap="xs">
                    <Group justify="space-between" align="flex-start">
                      <div>
                        <Text fw={700}>{statement.metric_name}</Text>
                        <Text size="xs" c="dimmed">
                          {statement.exam_date} ·{' '}
                          {t('coverageEvidence.version', {
                            version: statement.version_number,
                          })}
                        </Text>
                      </div>
                      <Group gap={4}>
                        <Badge variant="light">
                          {t(
                            `coverageEvidence.reasons.${statement.absence_reason}`
                          )}
                        </Badge>
                        <Badge
                          color={
                            statement.status === 'voided'
                              ? 'red'
                              : statement.verification_status === 'confirmed'
                                ? 'teal'
                                : 'orange'
                          }
                        >
                          {statement.status === 'voided'
                            ? t('coverageEvidence.statuses.voided')
                            : t(
                                `coverageEvidence.verification.${statement.verification_status}`
                              )}
                        </Badge>
                      </Group>
                    </Group>
                    {statement.note && <Text size="sm">{statement.note}</Text>}
                    {statement.source_document_id && (
                      <Button
                        variant="subtle"
                        size="compact-sm"
                        onClick={() =>
                          onOpenSourceDocument(statement.source_document_id!)
                        }
                      >
                        {t('coverageEvidence.source', {
                          id: statement.source_document_id,
                          page: statement.source_page || '—',
                        })}
                      </Button>
                    )}
                    {statement.is_current && statement.status === 'active' && (
                      <Group justify="flex-end">
                        <Button
                          variant="light"
                          size="xs"
                          leftSection={<IconPencil size={14} />}
                          onClick={() => openRevision(statement)}
                        >
                          {t('coverageEvidence.revise')}
                        </Button>
                        <Button
                          variant="light"
                          color="red"
                          size="xs"
                          leftSection={<IconTrash size={14} />}
                          onClick={() => setVoiding(statement)}
                        >
                          {t('coverageEvidence.void')}
                        </Button>
                      </Group>
                    )}
                  </Stack>
                </Card>
              ))}
            </SimpleGrid>
          )}
        </Stack>
      </Card>

      <Modal
        opened={formOpen}
        onClose={() => setFormOpen(false)}
        title={
          editing
            ? t('coverageEvidence.form.reviseTitle')
            : t('coverageEvidence.form.createTitle')
        }
        size="lg"
      >
        <Stack>
          <Alert color="blue" icon={<IconHistory size={18} />}>
            {t('coverageEvidence.form.explicitNotice')}
          </Alert>
          <TextInput
            type="date"
            label={t('coverageEvidence.form.examDate')}
            value={form.examDate}
            max={localToday()}
            required
            onChange={event =>
              setForm(current => ({
                ...current,
                examDate: event.currentTarget.value,
              }))
            }
          />
          <Autocomplete
            label={t('coverageEvidence.form.metricName')}
            description={t('coverageEvidence.form.metricHelp')}
            data={knownMetrics.map(metric => metric.name)}
            value={form.metricName}
            required
            onChange={updateMetricName}
          />
          <TextInput
            label={t('coverageEvidence.form.metricCode')}
            value={form.metricCode}
            onChange={event =>
              setForm(current => ({
                ...current,
                metricCode: event.currentTarget.value,
              }))
            }
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select
              label={t('coverageEvidence.form.reason')}
              data={reasonOptions}
              value={form.absenceReason}
              allowDeselect={false}
              onChange={value =>
                setForm(current => ({
                  ...current,
                  absenceReason:
                    (value as HealthCoverageAbsenceReason) || 'not-performed',
                }))
              }
            />
            <Select
              label={t('coverageEvidence.form.verification')}
              data={verificationOptions}
              value={form.verificationStatus}
              allowDeselect={false}
              onChange={value =>
                setForm(current => ({
                  ...current,
                  verificationStatus:
                    (value as HealthCoverageVerification) || 'needs_review',
                }))
              }
            />
          </SimpleGrid>
          <Select
            label={t('coverageEvidence.form.source')}
            data={sourceOptions}
            value={form.sourceDocumentId || null}
            clearable
            searchable
            onChange={value =>
              setForm(current => ({
                ...current,
                sourceDocumentId: value || '',
                sourcePage: value ? current.sourcePage : '',
                sourceLocator: value ? current.sourceLocator : '',
              }))
            }
          />
          {form.sourceDocumentId && (
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput
                type="number"
                min={1}
                label={t('coverageEvidence.form.sourcePage')}
                value={form.sourcePage}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    sourcePage: event.currentTarget.value,
                  }))
                }
              />
              <TextInput
                label={t('coverageEvidence.form.sourceLocator')}
                value={form.sourceLocator}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    sourceLocator: event.currentTarget.value,
                  }))
                }
              />
            </SimpleGrid>
          )}
          <Textarea
            label={t('coverageEvidence.form.note')}
            value={form.note}
            autosize
            minRows={2}
            maxRows={5}
            onChange={event =>
              setForm(current => ({
                ...current,
                note: event.currentTarget.value,
              }))
            }
          />
          {editing && (
            <Textarea
              label={t('coverageEvidence.form.changeNote')}
              value={form.changeNote}
              required
              onChange={event =>
                setForm(current => ({
                  ...current,
                  changeNote: event.currentTarget.value,
                }))
              }
            />
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setFormOpen(false)}>
              {t('coverageEvidence.cancel')}
            </Button>
            <Button
              loading={saving}
              disabled={!canSave}
              onClick={() => void save()}
            >
              {t('coverageEvidence.form.save')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(voiding)}
        onClose={() => {
          setVoiding(null);
          setVoidReason('');
        }}
        title={t('coverageEvidence.voidTitle')}
      >
        <Stack>
          <Alert color="red" icon={<IconAlertTriangle size={18} />}>
            {t('coverageEvidence.voidNotice')}
          </Alert>
          <Textarea
            label={t('coverageEvidence.voidReason')}
            value={voidReason}
            required
            onChange={event => setVoidReason(event.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setVoiding(null)}>
              {t('coverageEvidence.cancel')}
            </Button>
            <Button
              color="red"
              loading={saving}
              disabled={!voidReason.trim()}
              onClick={() => void confirmVoid()}
            >
              {t('coverageEvidence.voidConfirm')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default HealthCoverageEvidencePanel;
