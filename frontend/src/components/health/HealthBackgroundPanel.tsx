import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Timeline,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconHistory,
  IconNotebook,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import healthBackgroundApi, {
  type HealthBackgroundCategory,
  type HealthBackgroundContent,
  type HealthBackgroundEntry,
  type HealthBackgroundVerification,
  type OwnerHealthReadAccess,
} from '../../services/api/healthBackgroundApi';
import healthImportApi, {
  type HealthSourceDocument,
} from '../../services/api/healthImportApi';

interface HealthBackgroundPanelProps {
  patientId: number;
  maintenance?: {
    readAccess: OwnerHealthReadAccess;
    notice: string;
  };
}

interface BackgroundForm {
  category: HealthBackgroundCategory;
  title: string;
  narrative: string;
  effectiveDate: string;
  verificationStatus: HealthBackgroundVerification;
  sourceDocumentId: string;
  sourcePage: string;
  sourceLocator: string;
  changeNote: string;
}

const EMPTY_FORM: BackgroundForm = {
  category: 'general',
  title: '',
  narrative: '',
  effectiveDate: '',
  verificationStatus: 'needs_review',
  sourceDocumentId: '',
  sourcePage: '',
  sourceLocator: '',
  changeNote: '',
};

const toOptionalNumber = (value: string) => {
  const parsed = Number(value);
  return value.trim() && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const HealthBackgroundPanel = ({
  patientId,
  maintenance,
}: HealthBackgroundPanelProps) => {
  const { t } = useTranslation('healthInsights');
  const [entries, setEntries] = useState<HealthBackgroundEntry[]>([]);
  const [sources, setSources] = useState<HealthSourceDocument[]>([]);
  const [includeHistory, setIncludeHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<HealthBackgroundEntry | null>(null);
  const [form, setForm] = useState<BackgroundForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [voiding, setVoiding] = useState<HealthBackgroundEntry | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(false);
      try {
        setEntries(
          maintenance
            ? await healthBackgroundApi.list(
                patientId,
                includeHistory,
                signal,
                maintenance.readAccess
              )
            : await healthBackgroundApi.list(patientId, includeHistory, signal)
        );
      } catch (loadError) {
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

  const categoryOptions = useMemo(
    () =>
      (
        [
          'general',
          'medical_history',
          'lifestyle',
          'family_history',
          'social_context',
          'other',
        ] as const
      ).map(value => ({
        value,
        label: t(`healthBackground.categories.${value}` as const),
      })),
    [t]
  );

  const verificationOptions = useMemo(
    () =>
      (['needs_review', 'confirmed', 'questionable'] as const).map(value => ({
        value,
        label: t(`healthBackground.verification.${value}` as const),
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

  const openRevision = (entry: HealthBackgroundEntry) => {
    setEditing(entry);
    setForm({
      category: entry.category,
      title: entry.title,
      narrative: entry.narrative,
      effectiveDate: entry.effective_date || '',
      verificationStatus: entry.verification_status,
      sourceDocumentId: entry.source_document_id?.toString() || '',
      sourcePage: entry.source_page?.toString() || '',
      sourceLocator: entry.source_locator || '',
      changeNote: '',
    });
    setFormOpen(true);
  };

  const contentFromForm = (): HealthBackgroundContent => ({
    category: form.category,
    title: form.title.trim(),
    narrative: form.narrative.trim(),
    effective_date: form.effectiveDate || null,
    verification_status: form.verificationStatus,
    source_document_id: toOptionalNumber(form.sourceDocumentId),
    source_page: toOptionalNumber(form.sourcePage),
    source_locator: form.sourceLocator.trim() || null,
  });

  const canSave =
    form.title.trim().length > 0 &&
    form.narrative.trim().length > 0 &&
    (!editing || form.changeNote.trim().length > 0);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (editing) {
        await healthBackgroundApi.revise(
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
        await healthBackgroundApi.create(patientId, contentFromForm());
      }
      notifications.show({
        color: 'teal',
        message: t('healthBackground.saveSuccess'),
      });
      setFormOpen(false);
      await load();
    } catch (saveError: unknown) {
      const status = (saveError as { response?: { status?: number } })?.response
        ?.status;
      notifications.show({
        color: 'red',
        message: t(
          status === 409
            ? 'healthBackground.conflict'
            : 'healthBackground.saveError'
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
      await healthBackgroundApi.void(
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
        message: t('healthBackground.voidSuccess'),
      });
      setVoiding(null);
      setVoidReason('');
      await load();
    } catch (voidError) {
      notifications.show({
        color: 'red',
        message: t('healthBackground.saveError'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={3}>{t('healthBackground.title')}</Title>
          <Text size="sm" c="dimmed" maw={780}>
            {t('healthBackground.description')}
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
              {t('healthBackground.add')}
            </Button>
          )}
        </Group>
      </Group>

      {maintenance && (
        <Alert color="orange" icon={<IconAlertTriangle size={18} />}>
          {maintenance.notice}
        </Alert>
      )}

      <Alert color="blue" icon={<IconHistory size={18} />}>
        {t('healthBackground.versionNotice')}
      </Alert>

      <Switch
        checked={includeHistory}
        onChange={event => setIncludeHistory(event.currentTarget.checked)}
        label={t('healthBackground.showHistory')}
      />

      {error ? (
        <Alert color="red" icon={<IconAlertTriangle size={18} />}>
          <Stack gap="xs">
            <Text size="sm">{t('healthBackground.loadError')}</Text>
            <Button size="xs" variant="light" onClick={() => void load()}>
              {t('actions.retry')}
            </Button>
          </Stack>
        </Alert>
      ) : loading ? (
        <Center mih={220}>
          <Loader aria-label={t('healthBackground.loading')} />
        </Center>
      ) : entries.length === 0 ? (
        <Card withBorder p="xl">
          <Stack align="center">
            <IconNotebook size={36} color="var(--mantine-color-dimmed)" />
            <Text c="dimmed" ta="center">
              {t('healthBackground.empty')}
            </Text>
            <Button variant="light" onClick={openCreate}>
              {t('healthBackground.add')}
            </Button>
          </Stack>
        </Card>
      ) : (
        <Timeline active={entries.length} bulletSize={28} lineWidth={2}>
          {entries.map(entry => (
            <Timeline.Item
              key={entry.id}
              bullet={<IconNotebook size={15} />}
              title={
                <Group gap="xs">
                  <Text fw={700}>{entry.title}</Text>
                  <Badge variant="light">
                    {t(`healthBackground.categories.${entry.category}`)}
                  </Badge>
                  <Badge color="gray" variant="outline">
                    {t('healthBackground.version', {
                      version: entry.version_number,
                    })}
                  </Badge>
                  <Badge
                    color={
                      entry.status === 'voided'
                        ? 'red'
                        : entry.verification_status === 'confirmed'
                          ? 'teal'
                          : 'orange'
                    }
                  >
                    {entry.status === 'voided'
                      ? t('healthBackground.statuses.voided')
                      : t(
                          `healthBackground.verification.${entry.verification_status}`
                        )}
                  </Badge>
                </Group>
              }
            >
              <Card withBorder mt="xs" p="md">
                <Stack gap="xs">
                  <Text size="xs" c="dimmed">
                    {entry.effective_date ||
                      t('healthBackground.noEffectiveDate')}
                  </Text>
                  <Text style={{ whiteSpace: 'pre-wrap' }}>
                    {entry.narrative}
                  </Text>
                  {entry.source_document_id && (
                    <Text size="xs" c="dimmed">
                      {t('healthBackground.source', {
                        document: entry.source_document_id,
                        page: entry.source_page || '—',
                      })}
                      {entry.source_locator ? ` · ${entry.source_locator}` : ''}
                    </Text>
                  )}
                  {entry.change_note && (
                    <Text size="xs" c="dimmed">
                      {t('healthBackground.changeNote')}: {entry.change_note}
                    </Text>
                  )}
                  {entry.is_current && entry.status === 'active' && (
                    <Group mt="xs">
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconPencil size={14} />}
                        onClick={() => openRevision(entry)}
                      >
                        {t('healthBackground.revise')}
                      </Button>
                      <Button
                        size="xs"
                        color="red"
                        variant="subtle"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => {
                          setVoiding(entry);
                          setVoidReason('');
                        }}
                      >
                        {t('healthBackground.void')}
                      </Button>
                    </Group>
                  )}
                </Stack>
              </Card>
            </Timeline.Item>
          ))}
        </Timeline>
      )}

      <Modal
        opened={formOpen}
        onClose={() => setFormOpen(false)}
        title={
          editing
            ? t('healthBackground.reviseTitle')
            : t('healthBackground.createTitle')
        }
        size="lg"
      >
        <Stack>
          <Select
            label={t('healthBackground.fields.category')}
            data={categoryOptions}
            value={form.category}
            onChange={value =>
              setForm(current => ({
                ...current,
                category: (value || 'general') as HealthBackgroundCategory,
              }))
            }
            allowDeselect={false}
          />
          <TextInput
            label={t('healthBackground.fields.title')}
            value={form.title}
            onChange={event =>
              setForm(current => ({
                ...current,
                title: event.currentTarget.value,
              }))
            }
            required
          />
          <Textarea
            label={t('healthBackground.fields.narrative')}
            value={form.narrative}
            onChange={event =>
              setForm(current => ({
                ...current,
                narrative: event.currentTarget.value,
              }))
            }
            minRows={5}
            autosize
            required
          />
          <TextInput
            type="date"
            label={t('healthBackground.fields.effectiveDate')}
            value={form.effectiveDate}
            onChange={event =>
              setForm(current => ({
                ...current,
                effectiveDate: event.currentTarget.value,
              }))
            }
          />
          <Select
            label={t('healthBackground.fields.verification')}
            data={verificationOptions}
            value={form.verificationStatus}
            onChange={value =>
              setForm(current => ({
                ...current,
                verificationStatus: (value ||
                  'needs_review') as HealthBackgroundVerification,
              }))
            }
            allowDeselect={false}
          />
          <Group grow align="flex-start">
            <Select
              label={t('healthBackground.fields.sourceDocument')}
              placeholder={t('healthBackground.noSource')}
              data={sourceOptions}
              searchable
              clearable
              value={form.sourceDocumentId}
              onChange={value =>
                setForm(current => ({
                  ...current,
                  sourceDocumentId: value || '',
                  sourcePage: value ? current.sourcePage : '',
                  sourceLocator: value ? current.sourceLocator : '',
                }))
              }
            />
            <TextInput
              type="number"
              min={1}
              label={t('healthBackground.fields.sourcePage')}
              disabled={!form.sourceDocumentId}
              value={form.sourcePage}
              onChange={event =>
                setForm(current => ({
                  ...current,
                  sourcePage: event.currentTarget.value,
                }))
              }
            />
          </Group>
          <TextInput
            label={t('healthBackground.fields.sourceLocator')}
            disabled={!form.sourceDocumentId}
            value={form.sourceLocator}
            onChange={event =>
              setForm(current => ({
                ...current,
                sourceLocator: event.currentTarget.value,
              }))
            }
          />
          {editing && (
            <Textarea
              label={t('healthBackground.fields.changeNote')}
              value={form.changeNote}
              onChange={event =>
                setForm(current => ({
                  ...current,
                  changeNote: event.currentTarget.value,
                }))
              }
              required
            />
          )}
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setFormOpen(false)}>
              {t('healthBackground.cancel')}
            </Button>
            <Button
              onClick={() => void save()}
              disabled={!canSave}
              loading={saving}
            >
              {t('healthBackground.save')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(voiding)}
        onClose={() => setVoiding(null)}
        title={t('healthBackground.voidTitle')}
      >
        <Stack>
          <Alert color="orange">{t('healthBackground.voidNotice')}</Alert>
          <Textarea
            label={t('healthBackground.fields.voidReason')}
            value={voidReason}
            onChange={event => setVoidReason(event.currentTarget.value)}
            required
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setVoiding(null)}>
              {t('healthBackground.cancel')}
            </Button>
            <Button
              color="red"
              disabled={!voidReason.trim()}
              loading={saving}
              onClick={() => void confirmVoid()}
            >
              {t('healthBackground.confirmVoid')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default HealthBackgroundPanel;
