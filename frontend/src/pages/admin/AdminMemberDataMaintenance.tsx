/* eslint-disable i18next/no-literal-string -- Chinese-first sole-admin maintenance workflow */
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  NativeSelect,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconFileDescription,
  IconHistory,
  IconRefresh,
  IconShieldLock,
  IconTrash,
} from '@tabler/icons-react';
import type { ComponentProps, ComponentType, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import HealthBackgroundPanel from '../../components/health/HealthBackgroundPanel';
import HealthCoverageEvidencePanel from '../../components/health/HealthCoverageEvidencePanel';
import { adminApiService } from '../../services/api/adminApi';
import healthImportApi, {
  type HealthSourceDocument,
  type HealthSourceDocumentDependencies,
  type OwnerSourceLifecycleAction,
} from '../../services/api/healthImportApi';
import logger from '../../services/logger';
import './admin-member-data-maintenance.css';

interface OwnerDirectorySubject {
  id: number;
  first_name: string;
  last_name: string;
  owner_user_id: number;
  access_basis: 'owner' | 'owner_global_read';
}

interface SourceActionState {
  source: HealthSourceDocument;
  kind: 'withdraw' | 'restore';
}

interface AdminMemberDataMaintenanceProps {
  standalone?: boolean;
  directoryApi?: Pick<typeof adminApiService, 'getOwnerSubjects'>;
  sourceApi?: Pick<
    typeof healthImportApi,
    | 'listSourceDocuments'
    | 'getSourceDocumentDependencies'
    | 'withdrawSourceDocument'
    | 'restoreSourceDocument'
  >;
  BackgroundPanel?: ComponentType<ComponentProps<typeof HealthBackgroundPanel>>;
  CoveragePanel?: ComponentType<
    ComponentProps<typeof HealthCoverageEvidencePanel>
  >;
}

interface SourceLifecycleActionFormProps {
  source: HealthSourceDocument;
  kind: SourceActionState['kind'];
  targetLabel: string;
  onCancel: () => void;
  onComplete: () => Promise<void> | void;
  api?: Pick<
    typeof healthImportApi,
    | 'getSourceDocumentDependencies'
    | 'withdrawSourceDocument'
    | 'restoreSourceDocument'
  >;
}

const subjectLabel = (subject: OwnerDirectorySubject): string =>
  [subject.first_name, subject.last_name].filter(Boolean).join('').trim() ||
  `成员 ${subject.id}`;

const sourceStatusLabel = (status: string): string =>
  status === 'archived' ? '已撤回，可恢复' : '原件已留存';

export const SourceLifecycleActionForm = ({
  source,
  kind,
  targetLabel,
  onCancel,
  onComplete,
  api = healthImportApi,
}: SourceLifecycleActionFormProps) => {
  const [reason, setReason] = useState('');
  const [dependencies, setDependencies] =
    useState<HealthSourceDocumentDependencies | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const actionContext = (): OwnerSourceLifecycleAction | null => {
    if (reason.trim().length < 3) return null;
    return {
      capability:
        kind === 'withdraw' ? 'owner_source_withdraw' : 'owner_source_restore',
      reason: reason.trim(),
    };
  };

  const inspectDependencies = async () => {
    const context = actionContext();
    if (!context) return;
    setBusy(true);
    setError('');
    try {
      setDependencies(
        await api.getSourceDocumentDependencies(source.id, undefined, context)
      );
    } catch (inspectError) {
      setError('无法检查该原件的关联数据，本次操作未执行。');
      logger.error('admin_member_data_maintenance_dependencies_error', {
        component: 'SourceLifecycleActionForm',
        sourceDocumentId: source.id,
        error:
          inspectError instanceof Error
            ? inspectError.message
            : String(inspectError),
      });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    const context = actionContext();
    if (!context || !dependencies) return;
    setBusy(true);
    setError('');
    try {
      if (kind === 'withdraw') {
        await api.withdrawSourceDocument(source.id, reason.trim(), context);
      } else {
        await api.restoreSourceDocument(source.id, context);
      }
      await onComplete();
    } catch (actionError) {
      setError('操作未完成。数据状态没有被界面视为已改变，请刷新后重试。');
      logger.error('admin_member_data_maintenance_action_error', {
        component: 'SourceLifecycleActionForm',
        sourceDocumentId: source.id,
        action: kind,
        error:
          actionError instanceof Error
            ? actionError.message
            : String(actionError),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="md">
      <Alert color="orange" icon={<IconShieldLock size={18} />}>
        实际操作者：当前唯一管理员
        <br />
        目标档案：{targetLabel}
        <br />
        目标原件：{source.display_name}
      </Alert>
      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />}>
          {error}
        </Alert>
      )}
      <Textarea
        label="本次操作原因"
        description="3—200 个单行字符；原因会写入脱敏审计，但不会复制报告内容。"
        minRows={2}
        maxLength={200}
        value={reason}
        onChange={event => {
          setReason(event.currentTarget.value.replace(/[\r\n]/g, ' '));
          setDependencies(null);
        }}
        required
      />
      {dependencies && (
        <Alert color={dependencies.has_derived_data ? 'orange' : 'blue'}>
          关联导入批次 {dependencies.import_batches_total} 个，正式检验指标{' '}
          {dependencies.formal_lab_components} 项，健康背景{' '}
          {dependencies.health_background_entries} 条，检查覆盖声明{' '}
          {dependencies.health_coverage_statements} 条。
          <br />
          这些派生数据不会被自动删除或作废。
        </Alert>
      )}
      <Group justify="flex-end">
        <Button variant="default" onClick={onCancel} disabled={busy}>
          取消
        </Button>
        <Button
          variant="light"
          onClick={() => void inspectDependencies()}
          loading={busy && !dependencies}
          disabled={reason.trim().length < 3}
        >
          检查影响
        </Button>
        <Button
          color={kind === 'restore' ? 'blue' : 'orange'}
          onClick={() => void confirm()}
          loading={busy && Boolean(dependencies)}
          disabled={!dependencies}
        >
          {kind === 'restore' ? '确认恢复' : '确认撤回'}
        </Button>
      </Group>
    </Stack>
  );
};

const AdminMemberDataMaintenance = ({
  standalone = false,
  directoryApi = adminApiService,
  sourceApi = healthImportApi,
  BackgroundPanel = HealthBackgroundPanel,
  CoveragePanel = HealthCoverageEvidencePanel,
}: AdminMemberDataMaintenanceProps) => {
  const [subjects, setSubjects] = useState<OwnerDirectorySubject[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [sources, setSources] = useState<HealthSourceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [error, setError] = useState('');
  const [sourceAction, setSourceAction] = useState<SourceActionState | null>(
    null
  );

  const loadSubjects = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await directoryApi.getOwnerSubjects();
      const payload = response?.data || response;
      const crossSubject = (payload?.subjects || []).filter(
        (subject: OwnerDirectorySubject) =>
          subject.access_basis === 'owner_global_read'
      );
      setSubjects(crossSubject);
      setSelectedPatientId(current =>
        crossSubject.some(
          (subject: OwnerDirectorySubject) => String(subject.id) === current
        )
          ? current
          : crossSubject[0]
            ? String(crossSubject[0].id)
            : ''
      );
    } catch (loadError) {
      logger.error('admin_member_data_maintenance_subjects_error', {
        component: 'AdminMemberDataMaintenance',
        error:
          loadError instanceof Error ? loadError.message : String(loadError),
      });
      setError(
        '无法载入可维护的成员目录。请确认当前只有一个启用中的管理员账号。'
      );
    } finally {
      setLoading(false);
    }
  }, [directoryApi]);

  useEffect(() => {
    void loadSubjects();
  }, [loadSubjects]);

  const patientId = Number(selectedPatientId);
  const selectedSubject = useMemo(
    () => subjects.find(subject => subject.id === patientId) || null,
    [patientId, subjects]
  );
  const readAccess = useMemo(
    () => ({
      capability: 'global_read' as const,
      reason: '维护前查看成员资料',
    }),
    []
  );
  const maintenance = useMemo(
    () => ({
      readAccess,
      notice:
        '这是跨成员维护。每次修订或作废都必须填写原因，并保存旧版本、真实操作者、目标成员和时间。',
    }),
    [readAccess]
  );

  const loadSources = useCallback(async () => {
    if (!Number.isInteger(patientId) || !selectedSubject) {
      setSources([]);
      return;
    }
    setSourcesLoading(true);
    try {
      setSources(
        await sourceApi.listSourceDocuments(
          patientId,
          undefined,
          true,
          readAccess
        )
      );
    } catch (loadError) {
      logger.error('admin_member_data_maintenance_sources_error', {
        component: 'AdminMemberDataMaintenance',
        patientId,
        error:
          loadError instanceof Error ? loadError.message : String(loadError),
      });
      setSources([]);
      setError('报告原件目录暂时无法载入，请稍后重试。');
    } finally {
      setSourcesLoading(false);
    }
  }, [patientId, readAccess, selectedSubject, sourceApi]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const openSourceAction = (
    source: HealthSourceDocument,
    kind: SourceActionState['kind']
  ) => {
    setSourceAction({ source, kind });
    setError('');
  };

  let content: ReactNode;
  if (loading) {
    content = (
      <div className="admin-member-maintenance-state">
        <Loader />
        <Text>正在载入成员数据维护台…</Text>
      </div>
    );
  } else if (!selectedSubject) {
    content = (
      <div className="admin-member-maintenance-page">
        <Alert color="blue" icon={<IconShieldLock size={18} />}>
          当前没有其他成员档案可维护。管理员自己的档案请使用普通个人入口。
        </Alert>
      </div>
    );
  } else {
    content = (
      <div className="admin-member-maintenance-page">
        <header className="admin-member-maintenance-hero">
          <div>
            <Text className="admin-member-maintenance-eyebrow">
              唯一管理员 · 显式跨成员操作
            </Text>
            <Title order={1}>成员数据维护</Title>
            <Text c="dimmed" maw={760}>
              这里只提供版本化修订、作废和报告原件撤回/恢复。不会冒充成员，也不会放开检验值、生命体征、解析提交或通用数据库写入。
            </Text>
          </div>
          <Button
            variant="light"
            leftSection={<IconRefresh size={17} />}
            onClick={() => {
              void loadSubjects();
              void loadSources();
            }}
          >
            刷新
          </Button>
        </header>

        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={18} />}>
            {error}
          </Alert>
        )}

        <Card
          withBorder
          radius="lg"
          className="admin-member-maintenance-context"
        >
          <Stack gap="sm">
            <NativeSelect
              label="选择需要维护的成员档案"
              value={selectedPatientId}
              onChange={event =>
                setSelectedPatientId(event.currentTarget.value)
              }
              data={subjects.map(subject => ({
                value: String(subject.id),
                label: subjectLabel(subject),
              }))}
            />
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <Alert color="orange" icon={<IconShieldLock size={18} />}>
                <strong>实际操作者：当前唯一管理员</strong>
                <br />
                任何操作都以管理员身份留痕，不记录成成员本人。
              </Alert>
              <Alert color="blue" icon={<IconHistory size={18} />}>
                <strong>当前维护档案：{subjectLabel(selectedSubject)}</strong>
                <br />
                切换成员会重新授权和读取，不沿用上一人的操作状态。
              </Alert>
            </SimpleGrid>
          </Stack>
        </Card>

        <Tabs defaultValue="background" keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="background">健康背景</Tabs.Tab>
            <Tabs.Tab value="coverage">检查覆盖</Tabs.Tab>
            <Tabs.Tab value="sources">报告原件</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="background" pt="lg">
            <BackgroundPanel
              patientId={selectedSubject.id}
              maintenance={maintenance}
            />
          </Tabs.Panel>

          <Tabs.Panel value="coverage" pt="lg">
            <CoveragePanel
              patientId={selectedSubject.id}
              components={[]}
              componentsLoading={false}
              componentsError={false}
              onOpenLabRecord={() => undefined}
              onOpenSourceDocument={() => undefined}
              maintenance={maintenance}
            />
          </Tabs.Panel>

          <Tabs.Panel value="sources" pt="lg">
            <Stack gap="md">
              <Alert color="orange" icon={<IconAlertTriangle size={18} />}>
                撤回不会物理删除原件或联动作废正式数据。确认前必须先检查关联批次、检验指标、健康背景和覆盖声明；误撤回可以恢复。
              </Alert>
              {sourcesLoading ? (
                <div className="admin-member-maintenance-state">
                  <Loader size="sm" />
                  <Text>正在载入报告原件…</Text>
                </div>
              ) : sources.length === 0 ? (
                <Card withBorder>
                  <Text c="dimmed">该成员还没有留存的报告原件。</Text>
                </Card>
              ) : (
                <div className="admin-member-maintenance-source-grid">
                  {sources.map(source => {
                    const archived = source.status === 'archived';
                    return (
                      <Card withBorder radius="md" key={source.id}>
                        <Stack gap="sm">
                          <Group justify="space-between" align="flex-start">
                            <Group gap="sm" wrap="nowrap">
                              <IconFileDescription size={22} />
                              <div>
                                <Text fw={700}>{source.display_name}</Text>
                                <Text size="sm" c="dimmed">
                                  {source.report_date || '报告日期未记录'}
                                  {source.facility
                                    ? ` · ${source.facility}`
                                    : ''}
                                </Text>
                              </div>
                            </Group>
                            <Badge color={archived ? 'gray' : 'teal'}>
                              {sourceStatusLabel(source.status)}
                            </Badge>
                          </Group>
                          {source.withdrawal_reason && (
                            <Text size="sm" c="dimmed">
                              上次撤回原因：{source.withdrawal_reason}
                            </Text>
                          )}
                          <Button
                            color={archived ? 'blue' : 'orange'}
                            variant="light"
                            leftSection={
                              archived ? (
                                <IconHistory size={16} />
                              ) : (
                                <IconTrash size={16} />
                              )
                            }
                            onClick={() =>
                              openSourceAction(
                                source,
                                archived ? 'restore' : 'withdraw'
                              )
                            }
                          >
                            {archived ? '检查并恢复' : '检查并撤回'}
                          </Button>
                        </Stack>
                      </Card>
                    );
                  })}
                </div>
              )}
            </Stack>
          </Tabs.Panel>
        </Tabs>

        <Modal
          opened={Boolean(sourceAction)}
          onClose={() => setSourceAction(null)}
          title={
            sourceAction?.kind === 'restore' ? '恢复报告原件' : '撤回报告原件'
          }
          centered
          transitionProps={{ duration: 0 }}
        >
          {sourceAction && (
            <SourceLifecycleActionForm
              source={sourceAction.source}
              kind={sourceAction.kind}
              targetLabel={subjectLabel(selectedSubject)}
              api={sourceApi}
              onCancel={() => setSourceAction(null)}
              onComplete={async () => {
                setSourceAction(null);
                await loadSources();
              }}
            />
          )}
        </Modal>
      </div>
    );
  }

  return standalone ? content : <AdminLayout>{content}</AdminLayout>;
};

export default AdminMemberDataMaintenance;
