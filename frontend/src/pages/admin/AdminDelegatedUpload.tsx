/* eslint-disable i18next/no-literal-string -- Chinese-first sole-admin delegated upload workflow */
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  NativeSelect,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconFileUpload,
  IconRefresh,
  IconShieldLock,
  IconTrash,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import HouseholdReportUploadModal from '../../features/householdHealth/HouseholdReportUploadModal';
import type { HealthSourceUploadBatch } from '../../services/api/healthImportApi';
import defaultAdminDelegatedUploadApi, {
  type AdminDelegatedUploadSettings,
  type AdminDelegatedUploadSubject,
} from '../../services/api/adminDelegatedUploadApi';
import logger from '../../services/logger';
import '../prototype/HouseholdHealthPrototype.css';
import './admin-delegated-upload.css';

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const batchStatusLabel: Record<HealthSourceUploadBatch['status'], string> = {
  open: '等待继续上传',
  completed: '原件已完整保存',
  partial: '部分文件已保存',
  cancelled: '已取消',
};

interface AdminDelegatedUploadProps {
  api?: typeof defaultAdminDelegatedUploadApi;
  standalone?: boolean;
}

const AdminDelegatedUpload = ({
  api = defaultAdminDelegatedUploadApi,
  standalone = false,
}: AdminDelegatedUploadProps) => {
  const [settings, setSettings] = useState<AdminDelegatedUploadSettings | null>(
    null
  );
  const [subjects, setSubjects] = useState<AdminDelegatedUploadSubject[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [toggleReason, setToggleReason] = useState('');
  const [operationReason, setOperationReason] = useState('');
  const [batches, setBatches] = useState<HealthSourceUploadBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [settingsResponse, subjectResponse] = await Promise.all([
        api.getSettings(),
        api.listSubjects(),
      ]);
      setSettings(settingsResponse);
      setSubjects(subjectResponse.subjects);
    } catch (loadError) {
      logger.error('admin_delegated_upload_load_error', {
        component: 'AdminDelegatedUpload',
        error: errorMessage(loadError),
      });
      setError('无法载入管理员代上传设置，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedSubject = useMemo(
    () =>
      subjects.find(
        subject => String(subject.patient_id) === selectedPatientId
      ) ?? null,
    [selectedPatientId, subjects]
  );

  const useReasonReady = operationReason.trim().length >= 3;

  const loadBatches = useCallback(async () => {
    if (!settings?.enabled || !selectedSubject || !useReasonReady) {
      setBatches([]);
      return;
    }
    setLoadingBatches(true);
    setError('');
    try {
      setBatches(
        await api.listUploadBatches(selectedSubject.patient_id, operationReason)
      );
    } catch (loadError) {
      logger.error('admin_delegated_upload_batches_load_error', {
        component: 'AdminDelegatedUpload',
        error: errorMessage(loadError),
      });
      setError('无法载入该成员最近的代上传批次。');
    } finally {
      setLoadingBatches(false);
    }
  }, [
    api,
    operationReason,
    selectedSubject,
    settings?.enabled,
    useReasonReady,
  ]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadBatches();
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [loadBatches]);

  const updateEnabled = async () => {
    const reason = toggleReason.trim();
    if (reason.length < 3) {
      setError('请先填写本次启用原因。');
      return;
    }
    if (!settings || busy) return;

    setBusy(true);
    setError('');
    try {
      const response = await api.setEnabled(!settings.enabled, reason);
      setSettings(response);
      setToggleReason('');
      if (!response.enabled) {
        setSelectedPatientId('');
        setOperationReason('');
        setBatches([]);
        setModalOpen(false);
      }
    } catch (updateError) {
      logger.error('admin_delegated_upload_setting_update_error', {
        component: 'AdminDelegatedUpload',
        error: errorMessage(updateError),
      });
      setError(
        settings.enabled
          ? '关闭代上传失败，系统仍保持原状态。'
          : '启用代上传失败，系统仍保持关闭。'
      );
    } finally {
      setBusy(false);
    }
  };

  const withdrawDocument = async (
    sourceDocumentId: number,
    filename: string
  ) => {
    if (!useReasonReady || busy) return;
    const confirmed = window.confirm(
      `确认撤回原件“${filename}”吗？原件不会被物理删除，可在审计记录中追溯。`
    );
    if (!confirmed) return;

    setBusy(true);
    setError('');
    try {
      await api.withdrawSourceDocument(
        sourceDocumentId,
        operationReason,
        '管理员发现该原件不应归入当前目标档案'
      );
      await loadBatches();
    } catch (withdrawError) {
      logger.error('admin_delegated_upload_withdraw_error', {
        component: 'AdminDelegatedUpload',
        sourceDocumentId,
        error: errorMessage(withdrawError),
      });
      setError('原件撤回失败，当前数据未发生变化。');
    } finally {
      setBusy(false);
    }
  };

  const wrapLayout = (content: ReactNode) =>
    standalone ? content : <AdminLayout>{content}</AdminLayout>;

  if (loading) {
    return wrapLayout(
      <div className="admin-delegated-upload-loading">
        <Loader />
        <Text c="dimmed">正在载入代上传设置…</Text>
      </div>
    );
  }

  return wrapLayout(
    <div className="admin-delegated-upload-page">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Text className="admin-delegated-upload-eyebrow">
            仅限唯一系统管理员
          </Text>
          <Title order={1}>管理员代上传</Title>
          <Text c="dimmed" mt={6}>
            仅在成员确实需要协助时临时开启。系统会分别保存实际操作者和目标档案，
            不会把管理员伪装成成员本人。
          </Text>
        </div>
        <Badge
          size="lg"
          color={settings?.enabled ? 'orange' : 'gray'}
          variant="light"
        >
          {settings?.enabled ? '当前已启用' : '当前已关闭'}
        </Badge>
      </Group>

      {error ? (
        <Alert
          color="red"
          icon={<IconAlertCircle size={18} />}
          title="操作没有完成"
        >
          {error}
        </Alert>
      ) : null}

      <Card withBorder radius="md" padding="lg">
        <Stack gap="md">
          <Group gap="sm" align="flex-start" wrap="nowrap">
            <IconShieldLock size={24} aria-hidden="true" />
            <div>
              <Text fw={700}>默认关闭的临时能力</Text>
              <Text size="sm" c="dimmed">
                启用、关闭以及每一次代上传都会单独记录原因。关闭后，尚未完成的代上传操作也会立即被拒绝。
              </Text>
            </div>
          </Group>
          <div className="admin-delegated-upload-toggle">
            <TextInput
              label="启用或关闭原因"
              description="请说明本次为什么需要改变开关状态，至少 3 个字。"
              placeholder={
                settings?.enabled
                  ? '例如：成员已可自行上传，结束临时协助'
                  : '例如：成员暂时无法自行上传，需要协助留存'
              }
              value={toggleReason}
              onChange={event => setToggleReason(event.currentTarget.value)}
            />
            <Button
              color={settings?.enabled ? 'red' : 'orange'}
              variant={settings?.enabled ? 'light' : 'filled'}
              loading={busy}
              onClick={() => void updateEnabled()}
            >
              {settings?.enabled ? '关闭代上传' : '启用代上传'}
            </Button>
          </div>
        </Stack>
      </Card>

      {settings?.enabled ? (
        <>
          <Card withBorder radius="md" padding="lg">
            <Stack gap="md">
              <Title order={2} size="h3">
                选择本次目标
              </Title>
              <div className="admin-delegated-upload-target-grid">
                <NativeSelect
                  label="选择目标成员"
                  description="只能选择已有独立账号的档案主体。"
                  value={selectedPatientId}
                  onChange={event =>
                    setSelectedPatientId(event.currentTarget.value)
                  }
                  data={[
                    { value: '', label: '请选择成员' },
                    ...subjects
                      .filter(subject => subject.account_active)
                      .map(subject => ({
                        value: String(subject.patient_id),
                        label: `${subject.display_name}（${subject.username}）`,
                      })),
                  ]}
                />
                <TextInput
                  label="本次代上传原因"
                  description="该原因会随本次操作写入审计记录，至少 3 个字。"
                  placeholder="例如：协助成员保存本次体检报告"
                  value={operationReason}
                  onChange={event =>
                    setOperationReason(event.currentTarget.value)
                  }
                />
              </div>

              <div className="admin-delegated-upload-disclosure" role="status">
                <div>
                  <Text size="xs" c="dimmed">
                    实际操作者
                  </Text>
                  <Text fw={700}>实际操作者：系统管理员</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">
                    数据归属
                  </Text>
                  <Text fw={700}>
                    目标档案：{selectedSubject?.display_name ?? '尚未选择'}
                  </Text>
                </div>
              </div>

              <Group justify="space-between" align="center" wrap="wrap">
                <Text size="sm" c="dimmed">
                  上传前请再次核对报告姓名与目标成员是否一致。
                </Text>
                <Button
                  leftSection={<IconFileUpload size={18} />}
                  disabled={!selectedSubject || !useReasonReady}
                  onClick={() => setModalOpen(true)}
                >
                  为该成员上传报告
                </Button>
              </Group>
            </Stack>
          </Card>

          <Card withBorder radius="md" padding="lg">
            <Group justify="space-between" mb="md">
              <div>
                <Title order={2} size="h3">
                  最近代上传批次
                </Title>
                <Text size="sm" c="dimmed">
                  这里只显示由当前管理员为所选成员创建的批次。
                </Text>
              </div>
              <Button
                variant="subtle"
                leftSection={<IconRefresh size={17} />}
                disabled={!selectedSubject || !useReasonReady}
                loading={loadingBatches}
                onClick={() => void loadBatches()}
              >
                刷新
              </Button>
            </Group>

            {!selectedSubject || !useReasonReady ? (
              <Text c="dimmed">
                选择目标成员并填写本次原因后，才会读取相关批次。
              </Text>
            ) : batches.length === 0 && !loadingBatches ? (
              <Text c="dimmed">该成员暂无由当前管理员建立的上传批次。</Text>
            ) : (
              <div className="admin-delegated-upload-batches">
                {batches.map(batch => (
                  <section
                    className="admin-delegated-upload-batch"
                    key={batch.id}
                  >
                    <Group justify="space-between" wrap="wrap">
                      <div>
                        <Text fw={700}>批次 #{batch.id}</Text>
                        <Text size="sm" c="dimmed">
                          {batch.expected_file_count} 个文件 ·{' '}
                          {batchStatusLabel[batch.status]}
                        </Text>
                      </div>
                      <Badge variant="light">
                        {batchStatusLabel[batch.status]}
                      </Badge>
                    </Group>
                    {batch.items.length > 0 ? (
                      <div className="admin-delegated-upload-files">
                        {batch.items.map(item => (
                          <div
                            className="admin-delegated-upload-file"
                            key={item.id}
                          >
                            <div>
                              <Text size="sm" fw={600}>
                                {item.original_filename}
                              </Text>
                              <Text size="xs" c="dimmed">
                                {item.status === 'uploaded'
                                  ? '原件已保存'
                                  : item.status === 'duplicate'
                                    ? '重复原件已跳过'
                                    : '处理状态：' + item.status}
                              </Text>
                            </div>
                            {item.source_document_id ? (
                              <Button
                                size="xs"
                                color="red"
                                variant="subtle"
                                leftSection={<IconTrash size={15} />}
                                disabled={busy}
                                onClick={() =>
                                  void withdrawDocument(
                                    item.source_document_id!,
                                    item.original_filename
                                  )
                                }
                              >
                                撤回原件
                              </Button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </section>
                ))}
              </div>
            )}
          </Card>
        </>
      ) : null}

      {modalOpen && selectedSubject ? (
        <HouseholdReportUploadModal
          patientId={selectedSubject.patient_id}
          subjectLabel={selectedSubject.display_name}
          serverBatchMode
          operatorContext={{
            mode: 'delegated',
            label: '管理员代上传（不会冒充成员）',
          }}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            void loadBatches();
          }}
          uploadDocument={(patientId, input, options) =>
            api.uploadSourceDocument(patientId, input, operationReason, options)
          }
          createUploadBatch={(patientId, input) =>
            api.createUploadBatch(patientId, input, operationReason)
          }
          completeUploadBatch={batchId =>
            api.completeUploadBatch(batchId, operationReason)
          }
          listUploadBatches={(patientId, signal) =>
            api.listUploadBatches(patientId, operationReason, signal)
          }
          getUploadBatch={(batchId, signal) =>
            api.getUploadBatch(batchId, operationReason, signal)
          }
          cancelUploadBatch={batchId =>
            api.cancelUploadBatch(batchId, operationReason)
          }
        />
      ) : null}
    </div>
  );
};

export default AdminDelegatedUpload;
