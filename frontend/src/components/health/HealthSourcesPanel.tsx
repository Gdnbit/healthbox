import {
  Alert,
  Badge,
  Button,
  FileInput,
  Group,
  Loader,
  Modal,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconArchive,
  IconExternalLink,
  IconFileDescription,
  IconFileSearch,
  IconListCheck,
  IconRefresh,
  IconRestore,
  IconUpload,
} from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import healthImportApi, {
  type HealthImportBatch,
  type HealthSourceDocument,
  type HealthSourceDocumentDependencies,
  type HealthSourceParseTask,
} from '../../services/api/healthImportApi';
import HealthImportBatchCreateModal from './HealthImportBatchCreateModal';
import HealthImportReviewModal from './HealthImportReviewModal';
import HealthSourceParseModal from './HealthSourceParseModal';

interface HealthSourcesPanelProps {
  patientId: number;
  focusedSourceDocumentId?: number | null;
}

const DOCUMENT_TYPES = [
  'checkup',
  'laboratory',
  'imaging',
  'prescription',
  'visit',
  'other',
] as const;

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const batchColor = (status: HealthImportBatch['status']) => {
  if (status === 'committed') return 'teal';
  if (status === 'reviewed') return 'blue';
  if (status === 'rolled_back') return 'gray';
  return 'orange';
};

const parseTaskColor = (status: HealthSourceParseTask['status']) => {
  if (status === 'succeeded') return 'teal';
  if (status === 'failed') return 'red';
  if (status === 'cancelled') return 'gray';
  return 'blue';
};

const HealthSourcesPanel = ({
  patientId,
  focusedSourceDocumentId,
}: HealthSourcesPanelProps) => {
  const { t } = useTranslation('healthInsights');
  const [documents, setDocuments] = useState<HealthSourceDocument[]>([]);
  const [batches, setBatches] = useState<HealthImportBatch[]>([]);
  const [parseTasks, setParseTasks] = useState<HealthSourceParseTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [documentType, setDocumentType] = useState('checkup');
  const [reportDate, setReportDate] = useState('');
  const [facility, setFacility] = useState('');
  const [duplicatePending, setDuplicatePending] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<HealthImportBatch | null>(
    null
  );
  const [selectedSourceDocument, setSelectedSourceDocument] =
    useState<HealthSourceDocument | null>(null);
  const [selectedParseTask, setSelectedParseTask] =
    useState<HealthSourceParseTask | null>(null);
  const [startingParseSourceId, setStartingParseSourceId] = useState<
    number | null
  >(null);
  const [lifecycleDocument, setLifecycleDocument] =
    useState<HealthSourceDocument | null>(null);
  const [dependencies, setDependencies] =
    useState<HealthSourceDocumentDependencies | null>(null);
  const [dependenciesLoading, setDependenciesLoading] = useState(false);
  const [lifecycleSaving, setLifecycleSaving] = useState(false);
  const [withdrawalReason, setWithdrawalReason] = useState('');

  const workspaceSummary = {
    documents: documents.length,
    pending: batches.filter(batch => batch.status === 'pending_review').length,
    reviewed: batches.filter(batch => batch.status === 'reviewed').length,
    committed: batches.filter(batch => batch.status === 'committed').length,
    quality: batches.reduce(
      (total, batch) => total + (batch.summary.quality_issue_count || 0),
      0
    ),
  };

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(false);
      try {
        const [sourceDocuments, importBatches, sourceParseTasks] =
          await Promise.all([
            healthImportApi.listSourceDocuments(patientId, signal, true),
            healthImportApi.listBatches(patientId, signal),
            healthImportApi.listParseTasks(patientId, signal),
          ]);
        setDocuments(sourceDocuments || []);
        setBatches(importBatches || []);
        setParseTasks(sourceParseTasks || []);
      } catch (loadError) {
        if (signal?.aborted) return;
        setError(true);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [patientId]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const focusedSourceExists = focusedSourceDocumentId
    ? documents.some(document => document.id === focusedSourceDocumentId)
    : false;

  useEffect(() => {
    if (loading || !focusedSourceDocumentId || !focusedSourceExists) return;
    document
      .getElementById(`health-source-document-${focusedSourceDocumentId}`)
      ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [focusedSourceDocumentId, focusedSourceExists, loading]);

  const resetUpload = () => {
    setFile(null);
    setDisplayName('');
    setDocumentType('checkup');
    setReportDate('');
    setFacility('');
    setDuplicatePending(false);
  };

  const openLifecycle = async (document: HealthSourceDocument) => {
    setLifecycleDocument(document);
    setDependencies(null);
    setWithdrawalReason('');
    setDependenciesLoading(true);
    try {
      setDependencies(
        await healthImportApi.getSourceDocumentDependencies(document.id)
      );
    } catch {
      notifications.show({
        color: 'red',
        title: t('sourceWorkspace.lifecycle.loadErrorTitle'),
        message: t('sourceWorkspace.lifecycle.loadErrorMessage'),
      });
      setLifecycleDocument(null);
    } finally {
      setDependenciesLoading(false);
    }
  };

  const closeLifecycle = () => {
    if (lifecycleSaving) return;
    setLifecycleDocument(null);
    setDependencies(null);
    setWithdrawalReason('');
  };

  const submitLifecycle = async () => {
    if (!lifecycleDocument) return;
    const restoring = lifecycleDocument.status === 'archived';
    setLifecycleSaving(true);
    try {
      const result = restoring
        ? await healthImportApi.restoreSourceDocument(lifecycleDocument.id)
        : await healthImportApi.withdrawSourceDocument(
            lifecycleDocument.id,
            withdrawalReason
          );
      setDocuments(current =>
        current.map(document =>
          document.id === result.document.id ? result.document : document
        )
      );
      notifications.show({
        color: 'teal',
        title: t(
          restoring
            ? 'sourceWorkspace.lifecycle.restoreSuccessTitle'
            : 'sourceWorkspace.lifecycle.withdrawSuccessTitle'
        ),
        message: t(
          restoring
            ? 'sourceWorkspace.lifecycle.restoreSuccessMessage'
            : 'sourceWorkspace.lifecycle.withdrawSuccessMessage'
        ),
      });
      setLifecycleDocument(null);
      setDependencies(null);
      setWithdrawalReason('');
    } catch {
      notifications.show({
        color: 'red',
        title: t('sourceWorkspace.lifecycle.actionErrorTitle'),
        message: t('sourceWorkspace.lifecycle.actionErrorMessage'),
      });
    } finally {
      setLifecycleSaving(false);
    }
  };

  const submitUpload = async (allowDuplicate = false) => {
    if (!file) return;
    setUploading(true);
    try {
      await healthImportApi.uploadSourceDocument(patientId, {
        file,
        displayName,
        documentType,
        reportDate: reportDate || undefined,
        facility,
        allowDuplicate,
      });
      notifications.show({
        color: 'teal',
        title: t('sourceWorkspace.uploadSuccessTitle'),
        message: t('sourceWorkspace.uploadSuccessMessage'),
      });
      setUploadOpen(false);
      resetUpload();
      await load();
    } catch (uploadError) {
      const message =
        uploadError instanceof Error
          ? uploadError.message
          : String(uploadError);
      if (message.includes('Duplicate source document')) {
        setDuplicatePending(true);
      } else {
        notifications.show({
          color: 'red',
          title: t('sourceWorkspace.uploadErrorTitle'),
          message: t('sourceWorkspace.uploadErrorMessage'),
        });
      }
    } finally {
      setUploading(false);
    }
  };

  const updateParseTask = useCallback((updatedTask: HealthSourceParseTask) => {
    setSelectedParseTask(updatedTask);
    setParseTasks(current => [
      updatedTask,
      ...current.filter(task => task.id !== updatedTask.id),
    ]);
  }, []);

  const latestParseTask = (sourceDocumentId: number) =>
    parseTasks.find(task => task.source_document_id === sourceDocumentId);

  const openOrStartParse = async (document: HealthSourceDocument) => {
    const existingTask = latestParseTask(document.id);
    if (existingTask) {
      setSelectedParseTask(existingTask);
      return;
    }
    setStartingParseSourceId(document.id);
    try {
      updateParseTask(await healthImportApi.startParseTask(document.id));
    } catch {
      notifications.show({
        color: 'red',
        title: t('sourceParse.startErrorTitle'),
        message: t('sourceParse.startErrorMessage'),
      });
    } finally {
      setStartingParseSourceId(null);
    }
  };

  const openParsedBatch = async (batchId: number) => {
    const batch = await healthImportApi.getBatch(batchId);
    setBatches(current => [
      batch,
      ...current.filter(item => item.id !== batch.id),
    ]);
    setSelectedParseTask(null);
    setSelectedBatch(batch);
  };

  const openManualEntryForParseTask = () => {
    if (!selectedParseTask) return;
    const sourceDocument = documents.find(
      document => document.id === selectedParseTask.source_document_id
    );
    setSelectedParseTask(null);
    if (sourceDocument) setSelectedSourceDocument(sourceDocument);
  };

  if (loading) {
    return (
      <Paper withBorder radius="md" p="xl">
        <Group justify="center">
          <Loader size="sm" />
          <Text>{t('sourceWorkspace.loading')}</Text>
        </Group>
      </Paper>
    );
  }

  return (
    <Stack gap="lg">
      <Alert color="blue" icon={<IconFileDescription size={18} />}>
        {t('sourceWorkspace.safetyNotice')}
      </Alert>

      <Paper withBorder radius="md" p="md">
        <Stack gap="md">
          <div>
            <Title order={2} size="h3">
              {t('sourceWorkspace.entryWorkspace.title')}
            </Title>
            <Text size="sm" c="dimmed">
              {t('sourceWorkspace.entryWorkspace.description')}
            </Text>
          </div>

          <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }}>
            {(
              [
                ['documents', workspaceSummary.documents],
                ['pending', workspaceSummary.pending],
                ['reviewed', workspaceSummary.reviewed],
                ['committed', workspaceSummary.committed],
                ['quality', workspaceSummary.quality],
              ] as const
            ).map(([key, value]) => (
              <Paper
                key={key}
                withBorder
                radius="md"
                p="sm"
                data-testid={`entry-summary-${key}`}
              >
                <Text size="xs" c="dimmed" fw={600}>
                  {t(`sourceWorkspace.entryWorkspace.summary.${key}`)}
                </Text>
                <Text size="xl" fw={750}>
                  {value}
                </Text>
              </Paper>
            ))}
          </SimpleGrid>

          <div>
            <Text fw={700} mb="xs">
              {t('sourceWorkspace.entryWorkspace.actionsTitle')}
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              {(
                [
                  ['lab', '/lab-results'],
                  ['vitals', '/vitals'],
                  ['background', '/health-insights?view=background'],
                ] as const
              ).map(([key, href]) => (
                <Paper key={key} withBorder radius="md" p="sm">
                  <Stack gap="xs" h="100%" justify="space-between">
                    <Text size="sm" c="dimmed">
                      {t(
                        `sourceWorkspace.entryWorkspace.actionDescriptions.${key}`
                      )}
                    </Text>
                    <Button
                      component="a"
                      href={href}
                      variant="light"
                      size="xs"
                      fullWidth
                    >
                      {t(`sourceWorkspace.entryWorkspace.actions.${key}`)}
                    </Button>
                  </Stack>
                </Paper>
              ))}
            </SimpleGrid>
          </div>

          <Paper withBorder radius="md" p="sm" bg="var(--mantine-color-gray-0)">
            <Text fw={700} mb="xs">
              {t('sourceWorkspace.entryWorkspace.workflowTitle')}
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
              {(['original', 'candidate', 'review', 'commit'] as const).map(
                (stage, index) => (
                  <Group key={stage} align="flex-start" wrap="nowrap">
                    <Badge circle variant="light" mt={2}>
                      {index + 1}
                    </Badge>
                    <div>
                      <Text fw={650} size="sm">
                        {t(
                          `sourceWorkspace.entryWorkspace.workflow.${stage}.title`
                        )}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {t(
                          `sourceWorkspace.entryWorkspace.workflow.${stage}.description`
                        )}
                      </Text>
                    </div>
                  </Group>
                )
              )}
            </SimpleGrid>
          </Paper>
        </Stack>
      </Paper>

      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />}>
          <Group justify="space-between">
            <Text size="sm">{t('sourceWorkspace.loadError')}</Text>
            <Button
              size="xs"
              variant="light"
              color="red"
              onClick={() => void load()}
            >
              {t('actions.retry')}
            </Button>
          </Group>
        </Alert>
      )}

      <Paper withBorder radius="md" p="md">
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <div>
              <Title order={3}>{t('sourceWorkspace.documentsTitle')}</Title>
              <Text size="sm" c="dimmed">
                {t('sourceWorkspace.documentsDescription')}
              </Text>
            </div>
            <Group gap="xs">
              <Button
                variant="subtle"
                leftSection={<IconRefresh size={16} />}
                onClick={() => void load()}
              >
                {t('actions.refresh')}
              </Button>
              <Button
                leftSection={<IconUpload size={16} />}
                onClick={() => setUploadOpen(true)}
              >
                {t('sourceWorkspace.uploadAction')}
              </Button>
            </Group>
          </Group>

          {documents.length === 0 ? (
            <Text c="dimmed">{t('sourceWorkspace.documentsEmpty')}</Text>
          ) : (
            <>
              {focusedSourceDocumentId && !focusedSourceExists && (
                <Alert color="yellow" icon={<IconAlertTriangle size={18} />}>
                  {t('visualizationContext.source.notFound', {
                    document: focusedSourceDocumentId,
                  })}
                </Alert>
              )}
              <Table.ScrollContainer minWidth={820}>
                <Table striped highlightOnHover verticalSpacing="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>
                        {t('sourceWorkspace.columns.document')}
                      </Table.Th>
                      <Table.Th>{t('sourceWorkspace.columns.type')}</Table.Th>
                      <Table.Th>
                        {t('sourceWorkspace.columns.reportDate')}
                      </Table.Th>
                      <Table.Th>{t('sourceWorkspace.columns.size')}</Table.Th>
                      <Table.Th>
                        {t('sourceWorkspace.columns.fingerprint')}
                      </Table.Th>
                      <Table.Th>{t('sourceWorkspace.columns.status')}</Table.Th>
                      <Table.Th>
                        {t('sourceWorkspace.columns.actions')}
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {documents.map(document => (
                      <Table.Tr
                        key={document.id}
                        id={`health-source-document-${document.id}`}
                        data-focused={
                          document.id === focusedSourceDocumentId
                            ? 'true'
                            : undefined
                        }
                        bg={
                          document.id === focusedSourceDocumentId
                            ? 'var(--mantine-color-blue-light)'
                            : undefined
                        }
                      >
                        <Table.Td>
                          <Text fw={600}>{document.display_name}</Text>
                          {document.id === focusedSourceDocumentId && (
                            <Badge size="xs" variant="light" color="blue">
                              {t('visualizationContext.source.focused')}
                            </Badge>
                          )}
                          <Text size="xs" c="dimmed">
                            {document.facility || document.original_filename}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          {t(
                            `sourceWorkspace.types.${document.document_type}`,
                            {
                              defaultValue: document.document_type,
                            }
                          )}
                        </Table.Td>
                        <Table.Td>{document.report_date || '—'}</Table.Td>
                        <Table.Td>{formatBytes(document.size_bytes)}</Table.Td>
                        <Table.Td>
                          <Text ff="monospace" size="xs">
                            {document.sha256.slice(0, 12)}…
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={5}>
                            <Badge
                              variant="light"
                              color={
                                document.status === 'archived' ? 'gray' : 'teal'
                              }
                            >
                              {t(
                                `sourceWorkspace.statuses.${document.status}`,
                                {
                                  defaultValue: document.status,
                                }
                              )}
                            </Badge>
                            {document.duplicate_of_source_document_id && (
                              <Badge variant="light" color="orange">
                                {t('sourceWorkspace.duplicate')}
                              </Badge>
                            )}
                            {latestParseTask(document.id) && (
                              <Badge
                                variant="light"
                                color={parseTaskColor(
                                  latestParseTask(document.id)!.status
                                )}
                              >
                                {t(
                                  `sourceParse.statuses.${
                                    latestParseTask(document.id)!.status
                                  }`
                                )}
                              </Badge>
                            )}
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Group gap="xs" wrap="nowrap">
                            {document.primary_file_id && (
                              <Button
                                component="a"
                                href={`/api/v1/entity-files/files/${document.primary_file_id}/view`}
                                target="_blank"
                                rel="noreferrer"
                                size="xs"
                                variant="light"
                                leftSection={<IconExternalLink size={14} />}
                              >
                                {t('sourceWorkspace.openOriginal')}
                              </Button>
                            )}
                            <Button
                              size="xs"
                              variant="outline"
                              leftSection={<IconListCheck size={14} />}
                              disabled={document.status === 'archived'}
                              onClick={() =>
                                setSelectedSourceDocument(document)
                              }
                            >
                              {t('sourceEntry.start')}
                            </Button>
                            <Button
                              size="xs"
                              variant="light"
                              leftSection={<IconFileSearch size={14} />}
                              disabled={document.status === 'archived'}
                              loading={startingParseSourceId === document.id}
                              onClick={() => void openOrStartParse(document)}
                            >
                              {latestParseTask(document.id)
                                ? t('sourceParse.viewTask')
                                : t('sourceParse.start')}
                            </Button>
                            <Button
                              size="xs"
                              variant="subtle"
                              color={
                                document.status === 'archived'
                                  ? 'blue'
                                  : 'orange'
                              }
                              leftSection={
                                document.status === 'archived' ? (
                                  <IconRestore size={14} />
                                ) : (
                                  <IconArchive size={14} />
                                )
                              }
                              onClick={() => void openLifecycle(document)}
                            >
                              {t(
                                document.status === 'archived'
                                  ? 'sourceWorkspace.lifecycle.restore'
                                  : 'sourceWorkspace.lifecycle.withdraw'
                              )}
                            </Button>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </>
          )}
        </Stack>
      </Paper>

      <Paper withBorder radius="md" p="md">
        <Stack gap="md">
          <div>
            <Title order={3}>{t('sourceWorkspace.batchesTitle')}</Title>
            <Text size="sm" c="dimmed">
              {t('sourceWorkspace.batchesDescription')}
            </Text>
          </div>
          {batches.length === 0 ? (
            <Text c="dimmed">{t('sourceWorkspace.batchesEmpty')}</Text>
          ) : (
            <Table.ScrollContainer minWidth={760}>
              <Table striped verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('sourceWorkspace.columns.batch')}</Table.Th>
                    <Table.Th>{t('sourceWorkspace.columns.parser')}</Table.Th>
                    <Table.Th>
                      {t('sourceWorkspace.columns.candidates')}
                    </Table.Th>
                    <Table.Th>{t('sourceWorkspace.columns.review')}</Table.Th>
                    <Table.Th>{t('sourceWorkspace.columns.status')}</Table.Th>
                    <Table.Th>
                      {t('sourceWorkspace.columns.createdAt')}
                    </Table.Th>
                    <Table.Th>{t('sourceWorkspace.columns.actions')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {batches.map(batch => (
                    <Table.Tr key={batch.id}>
                      <Table.Td>#{batch.id}</Table.Td>
                      <Table.Td>
                        {batch.parser_name}
                        {batch.parser_version ? ` ${batch.parser_version}` : ''}
                      </Table.Td>
                      <Table.Td>{batch.summary.total}</Table.Td>
                      <Table.Td>
                        {t('sourceWorkspace.reviewSummary', {
                          accepted: batch.summary.accepted,
                          pending: batch.summary.pending,
                          duplicate: batch.summary.duplicate,
                        })}
                      </Table.Td>
                      <Table.Td>
                        <Badge color={batchColor(batch.status)} variant="light">
                          {t(`sourceWorkspace.batchStatuses.${batch.status}`)}
                        </Badge>
                      </Table.Td>
                      <Table.Td>{batch.created_at.slice(0, 10)}</Table.Td>
                      <Table.Td>
                        <Button
                          size="xs"
                          variant="light"
                          onClick={() => setSelectedBatch(batch)}
                        >
                          {t('sourceReview.open')}
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Stack>
      </Paper>

      <Modal
        opened={uploadOpen}
        onClose={() => {
          if (uploading) return;
          setUploadOpen(false);
          resetUpload();
        }}
        title={t('sourceWorkspace.uploadTitle')}
        centered
        closeOnClickOutside={!uploading}
        closeOnEscape={!uploading}
      >
        <Stack gap="md">
          <Alert color="blue">{t('sourceWorkspace.uploadNotice')}</Alert>
          <FileInput
            value={file}
            onChange={value => {
              setFile(value);
              setDuplicatePending(false);
            }}
            label={t('sourceWorkspace.fileLabel')}
            placeholder={t('sourceWorkspace.filePlaceholder')}
            accept="application/pdf,image/jpeg,image/png,image/tiff"
            required
            clearable
          />
          <TextInput
            value={displayName}
            onChange={event => setDisplayName(event.currentTarget.value)}
            label={t('sourceWorkspace.nameLabel')}
            placeholder={t('sourceWorkspace.namePlaceholder')}
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select
              value={documentType}
              onChange={value => setDocumentType(value || 'other')}
              label={t('sourceWorkspace.typeLabel')}
              data={DOCUMENT_TYPES.map(value => ({
                value,
                label: t(`sourceWorkspace.types.${value}`),
              }))}
              allowDeselect={false}
            />
            <TextInput
              type="date"
              value={reportDate}
              onChange={event => setReportDate(event.currentTarget.value)}
              label={t('sourceWorkspace.reportDateLabel')}
            />
          </SimpleGrid>
          <TextInput
            value={facility}
            onChange={event => setFacility(event.currentTarget.value)}
            label={t('sourceWorkspace.facilityLabel')}
          />
          {duplicatePending && (
            <Alert color="orange" icon={<IconAlertTriangle size={18} />}>
              <Stack gap="xs">
                <Text size="sm">{t('sourceWorkspace.duplicateWarning')}</Text>
                <Button
                  color="orange"
                  variant="light"
                  size="xs"
                  loading={uploading}
                  onClick={() => void submitUpload(true)}
                >
                  {t('sourceWorkspace.keepDuplicate')}
                </Button>
              </Stack>
            </Alert>
          )}
          <Group justify="flex-end">
            <Button
              variant="default"
              disabled={uploading}
              onClick={() => {
                setUploadOpen(false);
                resetUpload();
              }}
            >
              {t('sourceWorkspace.cancel')}
            </Button>
            <Button
              loading={uploading}
              disabled={!file || duplicatePending}
              onClick={() => void submitUpload(false)}
            >
              {t('sourceWorkspace.saveOriginal')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={lifecycleDocument !== null}
        onClose={closeLifecycle}
        title={t(
          lifecycleDocument?.status === 'archived'
            ? 'sourceWorkspace.lifecycle.restoreTitle'
            : 'sourceWorkspace.lifecycle.withdrawTitle'
        )}
        centered
        closeOnClickOutside={!lifecycleSaving}
        closeOnEscape={!lifecycleSaving}
      >
        <Stack gap="md">
          <Alert
            color={lifecycleDocument?.status === 'archived' ? 'blue' : 'orange'}
            icon={
              lifecycleDocument?.status === 'archived' ? (
                <IconRestore size={18} />
              ) : (
                <IconArchive size={18} />
              )
            }
          >
            {t(
              lifecycleDocument?.status === 'archived'
                ? 'sourceWorkspace.lifecycle.restoreNotice'
                : 'sourceWorkspace.lifecycle.withdrawNotice'
            )}
          </Alert>

          {dependenciesLoading ? (
            <Group justify="center">
              <Loader size="sm" />
              <Text size="sm">
                {t('sourceWorkspace.lifecycle.loadingDependencies')}
              </Text>
            </Group>
          ) : (
            dependencies && (
              <Paper withBorder radius="md" p="sm">
                <Text fw={700} mb="xs">
                  {t('sourceWorkspace.lifecycle.dependenciesTitle')}
                </Text>
                <SimpleGrid cols={2}>
                  {(
                    [
                      ['batches', dependencies.import_batches_total],
                      ['formal', dependencies.formal_lab_components],
                      ['background', dependencies.health_background_entries],
                      ['coverage', dependencies.health_coverage_statements],
                    ] as const
                  ).map(([key, count]) => (
                    <div key={key}>
                      <Text size="xs" c="dimmed">
                        {t(`sourceWorkspace.lifecycle.dependencies.${key}`)}
                      </Text>
                      <Text fw={700}>{count}</Text>
                    </div>
                  ))}
                </SimpleGrid>
                {dependencies.has_derived_data && (
                  <Text size="xs" c="dimmed" mt="sm">
                    {t('sourceWorkspace.lifecycle.preserveDependencies')}
                  </Text>
                )}
              </Paper>
            )
          )}

          {lifecycleDocument?.status !== 'archived' && (
            <Textarea
              value={withdrawalReason}
              onChange={event => setWithdrawalReason(event.currentTarget.value)}
              label={t('sourceWorkspace.lifecycle.reasonLabel')}
              placeholder={t('sourceWorkspace.lifecycle.reasonPlaceholder')}
              maxLength={500}
              autosize
              minRows={2}
            />
          )}

          <Group justify="flex-end">
            <Button
              variant="default"
              disabled={lifecycleSaving}
              onClick={closeLifecycle}
            >
              {t('sourceWorkspace.cancel')}
            </Button>
            <Button
              color={
                lifecycleDocument?.status === 'archived' ? 'blue' : 'orange'
              }
              loading={lifecycleSaving}
              disabled={dependenciesLoading || !dependencies}
              onClick={() => void submitLifecycle()}
            >
              {t(
                lifecycleDocument?.status === 'archived'
                  ? 'sourceWorkspace.lifecycle.confirmRestore'
                  : 'sourceWorkspace.lifecycle.confirmWithdraw'
              )}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <HealthImportBatchCreateModal
        patientId={patientId}
        sourceDocument={selectedSourceDocument}
        opened={selectedSourceDocument !== null}
        onClose={() => setSelectedSourceDocument(null)}
        onCreated={batch => {
          setSelectedSourceDocument(null);
          setBatches(current => [
            batch,
            ...current.filter(item => item.id !== batch.id),
          ]);
          setSelectedBatch(batch);
        }}
      />

      <HealthSourceParseModal
        task={selectedParseTask}
        opened={selectedParseTask !== null}
        onClose={() => setSelectedParseTask(null)}
        onChanged={updateParseTask}
        onOpenBatch={openParsedBatch}
        onManualEntry={openManualEntryForParseTask}
      />

      <HealthImportReviewModal
        batch={selectedBatch}
        opened={selectedBatch !== null}
        onClose={() => setSelectedBatch(null)}
        onChanged={updatedBatch => {
          setSelectedBatch(updatedBatch);
          setBatches(current =>
            current.map(batch =>
              batch.id === updatedBatch.id ? updatedBatch : batch
            )
          );
        }}
      />
    </Stack>
  );
};

export default HealthSourcesPanel;
