/* eslint-disable i18next/no-literal-string -- development-only synthetic prototype */
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconPencil, IconShieldLock } from '@tabler/icons-react';
import type { HealthSourceDocument } from '../../services/api/healthImportApi';
import AdminMemberDataMaintenance from '../admin/AdminMemberDataMaintenance';

let prototypeSources: HealthSourceDocument[] = [
  {
    id: 51,
    patient_id: 17,
    display_name: '2026 年度合成体检报告',
    original_filename: 'synthetic-checkup-2026.pdf',
    document_type: 'checkup',
    report_date: '2026-07-01',
    facility: '虚构市健康体检中心',
    mime_type: 'application/pdf',
    size_bytes: 680000,
    sha256: 'a'.repeat(64),
    storage_backend: 'local',
    status: 'uploaded',
    created_at: '2026-07-01T08:00:00Z',
    updated_at: '2026-07-01T08:00:00Z',
  },
  {
    id: 52,
    patient_id: 17,
    display_name: '2025 年度合成检验截图',
    original_filename: 'synthetic-lab-2025.png',
    document_type: 'laboratory',
    report_date: '2025-06-18',
    facility: '虚构市第一医院',
    mime_type: 'image/png',
    size_bytes: 420000,
    sha256: 'b'.repeat(64),
    storage_backend: 'local',
    status: 'archived',
    withdrawal_reason: '成员确认截图重复上传',
    withdrawn_at: '2026-07-20T08:00:00Z',
    withdrawn_by_user_id: 1,
    withdrawal_previous_status: 'uploaded',
    created_at: '2025-06-18T08:00:00Z',
    updated_at: '2026-07-20T08:00:00Z',
  },
];

const prototypeDirectoryApi = {
  async getOwnerSubjects() {
    return {
      subjects: [
        {
          id: 1,
          first_name: '管理员',
          last_name: '',
          owner_user_id: 1,
          access_basis: 'owner',
        },
        {
          id: 17,
          first_name: '合成',
          last_name: '成员',
          owner_user_id: 2,
          access_basis: 'owner_global_read',
        },
        {
          id: 18,
          first_name: '演示',
          last_name: '家人',
          owner_user_id: 3,
          access_basis: 'owner_global_read',
        },
      ],
    };
  },
};

const prototypeSourceApi = {
  async listSourceDocuments(patientId: number) {
    return prototypeSources
      .filter(source => source.patient_id === patientId)
      .map(source => ({ ...source }));
  },
  async getSourceDocumentDependencies(sourceDocumentId: number) {
    return {
      source_document_id: sourceDocumentId,
      import_batches_total: 1,
      import_batches_open: 0,
      import_batches_committed: 1,
      formal_lab_components: 7,
      health_background_entries: 1,
      health_coverage_statements: 2,
      duplicate_documents: 0,
      has_derived_data: true,
    };
  },
  async withdrawSourceDocument(sourceDocumentId: number, reason?: string) {
    prototypeSources = prototypeSources.map(source =>
      source.id === sourceDocumentId
        ? {
            ...source,
            status: 'archived',
            withdrawal_reason: reason || null,
            withdrawal_previous_status: source.status,
          }
        : source
    );
    const document = prototypeSources.find(
      source => source.id === sourceDocumentId
    )!;
    return {
      document,
      dependencies: await this.getSourceDocumentDependencies(sourceDocumentId),
    };
  },
  async restoreSourceDocument(sourceDocumentId: number) {
    prototypeSources = prototypeSources.map(source =>
      source.id === sourceDocumentId
        ? {
            ...source,
            status: source.withdrawal_previous_status || 'uploaded',
            withdrawal_reason: null,
            withdrawal_previous_status: null,
          }
        : source
    );
    const document = prototypeSources.find(
      source => source.id === sourceDocumentId
    )!;
    return {
      document,
      dependencies: await this.getSourceDocumentDependencies(sourceDocumentId),
    };
  },
};

const PrototypeBackgroundPanel = ({ patientId }: { patientId: number }) => (
  <Stack gap="md">
    <Group justify="space-between">
      <div>
        <Title order={3}>健康背景</Title>
        <Text size="sm" c="dimmed">
          这里只展示已确认的版本化背景资料。
        </Text>
      </div>
      <Button variant="subtle">刷新</Button>
    </Group>
    <Alert color="orange" icon={<IconShieldLock size={18} />}>
      这是跨成员维护。每次修订或作废都会创建不可变版本并记录管理员原因。
    </Alert>
    <Card withBorder radius="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Group gap="xs">
            <Badge color="teal">生活方式</Badge>
            <Badge variant="light">第 2 版</Badge>
          </Group>
          <Text fw={700} mt="sm">
            合成成员的日常作息
          </Text>
          <Text size="sm" c="dimmed">
            仅用于界面验证的虚构叙述，主体编号 {patientId}。
          </Text>
        </div>
        <Button variant="light" leftSection={<IconPencil size={16} />}>
          修订
        </Button>
      </Group>
    </Card>
  </Stack>
);

const PrototypeCoveragePanel = ({ patientId }: { patientId: number }) => (
  <Stack gap="md">
    <Title order={3}>检查覆盖</Title>
    <Alert color="orange" icon={<IconShieldLock size={18} />}>
      当前维护主体 {patientId}；作废不会删除旧版本。
    </Alert>
    <Card withBorder radius="md">
      <Group justify="space-between">
        <div>
          <Text fw={700}>合成筛查项目</Text>
          <Text size="sm" c="dimmed">
            2026-07-01 · 情况未知 · 已确认
          </Text>
        </div>
        <Button variant="light" leftSection={<IconPencil size={16} />}>
          修订
        </Button>
      </Group>
    </Card>
  </Stack>
);

const AdminMemberDataMaintenancePrototype = () => (
  <AdminMemberDataMaintenance
    standalone
    directoryApi={prototypeDirectoryApi}
    sourceApi={prototypeSourceApi}
    BackgroundPanel={PrototypeBackgroundPanel}
    CoveragePanel={PrototypeCoveragePanel}
  />
);

export default AdminMemberDataMaintenancePrototype;
