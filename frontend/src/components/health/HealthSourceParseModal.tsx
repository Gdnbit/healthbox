import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconListCheck,
  IconRefresh,
  IconX,
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import healthImportApi, {
  type HealthParserReadiness,
  type HealthSourceParseTask,
} from '../../services/api/healthImportApi';

const STALE_RUNNING_TASK_MS = 30 * 60 * 1000;

interface HealthSourceParseModalProps {
  task: HealthSourceParseTask | null;
  opened: boolean;
  onClose: () => void;
  onChanged: (_task: HealthSourceParseTask) => void;
  onOpenBatch: (_batchId: number) => Promise<void>;
  onManualEntry: () => void;
  loadReadiness?: (
    _patientId: number,
    _signal?: AbortSignal
  ) => Promise<HealthParserReadiness>;
}

const taskColor = (status: HealthSourceParseTask['status']) => {
  if (status === 'succeeded') return 'teal';
  if (status === 'failed') return 'red';
  if (status === 'cancelled') return 'gray';
  return 'blue';
};

const HealthSourceParseModal = ({
  task,
  opened,
  onClose,
  onChanged,
  onOpenBatch,
  onManualEntry,
  loadReadiness = healthImportApi.getParserReadiness,
}: HealthSourceParseModalProps) => {
  const { t } = useTranslation('healthInsights');
  const [working, setWorking] = useState(false);
  const [readiness, setReadiness] = useState<HealthParserReadiness | null>(
    null
  );
  const patientId = task?.patient_id;

  useEffect(() => {
    if (!opened || !task || !['queued', 'running'].includes(task.status)) {
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void healthImportApi
        .getParseTask(task.id, controller.signal)
        .then(onChanged)
        .catch(() => undefined);
    }, 900);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [onChanged, opened, task]);

  useEffect(() => {
    if (!opened || !patientId) {
      setReadiness(null);
      return undefined;
    }
    const controller = new AbortController();
    void loadReadiness(patientId, controller.signal)
      .then(setReadiness)
      .catch(() => setReadiness(null));
    return () => controller.abort();
  }, [loadReadiness, opened, patientId]);

  const retry = async () => {
    if (!task) return;
    setWorking(true);
    try {
      onChanged(await healthImportApi.retryParseTask(task.id));
    } catch {
      notifications.show({
        color: 'red',
        message: t('sourceParse.retryError'),
      });
    } finally {
      setWorking(false);
    }
  };

  const cancel = async () => {
    if (!task) return;
    setWorking(true);
    try {
      onChanged(await healthImportApi.cancelParseTask(task.id));
    } catch {
      notifications.show({
        color: 'red',
        message: t('sourceParse.cancelError'),
      });
    } finally {
      setWorking(false);
    }
  };

  const openBatch = async () => {
    if (!task?.import_batch_id) return;
    setWorking(true);
    try {
      await onOpenBatch(task.import_batch_id);
    } catch {
      notifications.show({
        color: 'red',
        message: t('sourceParse.openBatchError'),
      });
    } finally {
      setWorking(false);
    }
  };

  const active = task?.status === 'queued' || task?.status === 'running';
  const staleRunning =
    task?.status === 'running' &&
    !!task.started_at &&
    Date.now() - new Date(task.started_at).getTime() >= STALE_RUNNING_TASK_MS;
  const progress = task?.status === 'queued' ? 24 : active ? 68 : 100;
  const summary = task?.summary || {};

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t('sourceParse.title')}
      centered
      size="lg"
      closeOnClickOutside={!working}
      closeOnEscape={!working}
    >
      {task && (
        <Stack gap="md">
          <Alert color="blue">{t('sourceParse.notice')}</Alert>

          {readiness && (
            <Paper withBorder radius="md" p="md">
              <Stack gap="sm">
                <Group justify="space-between" gap="xs">
                  <Text fw={650}>{t('sourceParse.readiness.title')}</Text>
                  <Badge
                    color={
                      readiness.status === 'ready'
                        ? 'teal'
                        : readiness.status === 'partial'
                          ? 'yellow'
                          : 'red'
                    }
                    variant="light"
                  >
                    {t(`sourceParse.readiness.statuses.${readiness.status}`)}
                  </Badge>
                </Group>
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                  {(
                    [
                      'digital_pdf',
                      'image_ocr',
                      'scanned_pdf_ocr',
                      'heic_image_ocr',
                    ] as const
                  ).map(capability => {
                    const capabilityStatus =
                      readiness.capabilities[capability]?.status ||
                      'unavailable';
                    return (
                      <Group
                        key={capability}
                        justify="space-between"
                        gap="xs"
                        wrap="nowrap"
                      >
                        <Text size="sm">
                          {t(
                            `sourceParse.readiness.capabilities.${capability}`
                          )}
                        </Text>
                        <Badge
                          size="sm"
                          color={
                            capabilityStatus === 'ready'
                              ? 'teal'
                              : capabilityStatus === 'partial'
                                ? 'yellow'
                                : 'gray'
                          }
                          variant="light"
                        >
                          {t(
                            `sourceParse.readiness.statuses.${capabilityStatus}`
                          )}
                        </Badge>
                      </Group>
                    );
                  })}
                </SimpleGrid>
                <Text size="xs" c="dimmed">
                  {t(`sourceParse.readiness.worker.${readiness.worker.status}`)}
                </Text>
                {readiness.status !== 'ready' && (
                  <Text size="xs" c="dimmed">
                    {t('sourceParse.readiness.partialHint')}
                  </Text>
                )}
              </Stack>
            </Paper>
          )}

          <Group justify="space-between">
            <div>
              <Text fw={650}>
                {t('sourceParse.taskNumber', { task: task.id })}
              </Text>
              <Text size="xs" c="dimmed">
                {t('sourceParse.parser', {
                  name: task.parser_name,
                  version: task.parser_version,
                })}
              </Text>
            </div>
            <Badge color={taskColor(task.status)} variant="light">
              {t(`sourceParse.statuses.${task.status}`)}
            </Badge>
          </Group>

          {active && (
            <Paper withBorder radius="md" p="md">
              <Stack gap="xs">
                <Group gap="xs">
                  <Loader size="sm" />
                  <Text size="sm">{t('sourceParse.processing')}</Text>
                </Group>
                <Progress value={progress} animated />
                <Text size="xs" c="dimmed">
                  {t('sourceParse.processingHint')}
                </Text>
              </Stack>
            </Paper>
          )}

          {staleRunning && (
            <Alert color="orange" icon={<IconAlertTriangle size={18} />}>
              {t('sourceParse.staleNotice')}
            </Alert>
          )}

          {task.status === 'succeeded' && (
            <>
              <Alert color="teal">{t('sourceParse.successNotice')}</Alert>
              <SimpleGrid cols={{ base: 2, sm: 4 }}>
                {(
                  [
                    'candidate_count',
                    'low_confidence_count',
                    'unparsed_count',
                    'formal_write_count',
                  ] as const
                ).map(key => (
                  <Paper key={key} withBorder radius="md" p="sm">
                    <Text size="xs" c="dimmed">
                      {t(`sourceParse.summary.${key}`)}
                    </Text>
                    <Text fw={700} size="xl">
                      {summary[key] ?? 0}
                    </Text>
                  </Paper>
                ))}
              </SimpleGrid>
              <Text size="xs" c="dimmed">
                {t('sourceParse.extraction', {
                  method: t(
                    `sourceParse.methods.${summary.extraction_method || 'unknown'}`,
                    {
                      defaultValue: t('sourceParse.methods.unknown'),
                    }
                  ),
                  pages: summary.page_count || 0,
                })}
              </Text>
            </>
          )}

          {task.status === 'failed' && (
            <Alert color="red" icon={<IconAlertTriangle size={18} />}>
              <Text fw={650}>{t('sourceParse.failedTitle')}</Text>
              <Text size="sm">
                {t(`sourceParse.errors.${task.error_code || 'unknown'}`, {
                  defaultValue: t('sourceParse.errors.unknown'),
                })}
              </Text>
              <Text size="xs" mt={4}>
                {t('sourceParse.originalPreserved')}
              </Text>
            </Alert>
          )}

          {task.status === 'cancelled' && (
            <Alert color="gray">{t('sourceParse.cancelledNotice')}</Alert>
          )}

          <Group justify="space-between" wrap="wrap">
            <Button variant="default" onClick={onClose}>
              {t('sourceWorkspace.cancel')}
            </Button>
            <Group gap="xs">
              {task.status === 'queued' && (
                <Button
                  color="gray"
                  variant="light"
                  leftSection={<IconX size={16} />}
                  loading={working}
                  onClick={() => void cancel()}
                >
                  {t('sourceParse.cancelTask')}
                </Button>
              )}
              {['failed', 'cancelled'].includes(task.status) && (
                <>
                  <Button variant="light" onClick={onManualEntry}>
                    {t('sourceParse.manualEntry')}
                  </Button>
                  <Button
                    leftSection={<IconRefresh size={16} />}
                    loading={working}
                    onClick={() => void retry()}
                  >
                    {t('sourceParse.retry')}
                  </Button>
                </>
              )}
              {staleRunning && (
                <Button
                  leftSection={<IconRefresh size={16} />}
                  loading={working}
                  onClick={() => void retry()}
                >
                  {t('sourceParse.resume')}
                </Button>
              )}
              {task.status === 'succeeded' && task.import_batch_id && (
                <Button
                  color="teal"
                  leftSection={<IconListCheck size={16} />}
                  loading={working}
                  onClick={() => void openBatch()}
                >
                  {t('sourceParse.openReview')}
                </Button>
              )}
            </Group>
          </Group>
        </Stack>
      )}
    </Modal>
  );
};

export default HealthSourceParseModal;
