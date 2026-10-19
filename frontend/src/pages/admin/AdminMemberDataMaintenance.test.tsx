import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOwnerSubjects: vi.fn(),
  listSourceDocuments: vi.fn(),
  getSourceDocumentDependencies: vi.fn(),
  withdrawSourceDocument: vi.fn(),
  restoreSourceDocument: vi.fn(),
}));

vi.mock('../../components/admin/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../../components/health/HealthBackgroundPanel', () => ({
  default: ({
    patientId,
    maintenance,
  }: {
    patientId: number;
    maintenance?: { notice: string };
  }) => (
    <div>
      背景维护主体 {patientId} {maintenance?.notice}
    </div>
  ),
}));

vi.mock('../../components/health/HealthCoverageEvidencePanel', () => ({
  default: ({
    patientId,
    maintenance,
  }: {
    patientId: number;
    maintenance?: { notice: string };
  }) => (
    <div>
      覆盖维护主体 {patientId} {maintenance?.notice}
    </div>
  ),
}));

vi.mock('../../services/api/adminApi', () => ({
  adminApiService: {
    getOwnerSubjects: mocks.getOwnerSubjects,
  },
}));

vi.mock('../../services/api/healthImportApi', () => ({
  default: {
    listSourceDocuments: mocks.listSourceDocuments,
    getSourceDocumentDependencies: mocks.getSourceDocumentDependencies,
    withdrawSourceDocument: mocks.withdrawSourceDocument,
    restoreSourceDocument: mocks.restoreSourceDocument,
  },
}));

import AdminMemberDataMaintenance, {
  SourceLifecycleActionForm,
} from './AdminMemberDataMaintenance';

const renderPage = () =>
  render(
    <MantineProvider>
      <Notifications />
      <AdminMemberDataMaintenance />
    </MantineProvider>
  );

describe('AdminMemberDataMaintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOwnerSubjects.mockResolvedValue({
      subjects: [
        {
          id: 1,
          first_name: '管理员',
          last_name: '',
          owner_user_id: 10,
          access_basis: 'owner',
        },
        {
          id: 17,
          first_name: '合成',
          last_name: '成员',
          owner_user_id: 20,
          access_basis: 'owner_global_read',
        },
      ],
    });
    mocks.listSourceDocuments.mockResolvedValue([
      {
        id: 51,
        patient_id: 17,
        display_name: '合成体检报告',
        original_filename: 'synthetic.pdf',
        document_type: 'checkup',
        report_date: '2026-07-01',
        facility: '虚构机构',
        status: 'uploaded',
        created_at: '2026-07-01T00:00:00Z',
      },
    ]);
    mocks.getSourceDocumentDependencies.mockResolvedValue({
      source_document_id: 51,
      import_batches_total: 1,
      import_batches_open: 0,
      import_batches_committed: 1,
      formal_lab_components: 3,
      health_background_entries: 1,
      health_coverage_statements: 1,
      duplicate_documents: 0,
      has_derived_data: true,
    });
    mocks.withdrawSourceDocument.mockResolvedValue({
      document: { id: 51, status: 'archived' },
      dependencies: {},
    });
  });

  it('keeps actor and target visible and excludes the administrator self archive', async () => {
    renderPage();

    expect(
      await screen.findByText('实际操作者：当前唯一管理员')
    ).toBeInTheDocument();
    expect(screen.getByText(/当前维护档案：合成成员/)).toBeInTheDocument();
    expect(screen.queryByText('当前维护档案：管理员')).not.toBeInTheDocument();
    expect(screen.getByText(/背景维护主体 17/)).toBeInTheDocument();
  });

  it('requires an impact check and explicit reason before withdrawing a source', async () => {
    render(
      <MantineProvider>
        <Notifications />
        <SourceLifecycleActionForm
          source={{
            id: 51,
            patient_id: 17,
            display_name: '合成体检报告',
            original_filename: 'synthetic.pdf',
            document_type: 'checkup',
            report_date: '2026-07-01',
            facility: '虚构机构',
            mime_type: 'application/pdf',
            size_bytes: 100,
            sha256: 'a'.repeat(64),
            storage_backend: 'local',
            status: 'uploaded',
            created_at: '2026-07-01T00:00:00Z',
            updated_at: '2026-07-01T00:00:00Z',
          }}
          kind="withdraw"
          targetLabel="合成成员"
          onCancel={vi.fn()}
          onComplete={vi.fn()}
          api={mocks}
        />
      </MantineProvider>
    );
    fireEvent.change(screen.getByLabelText(/本次操作原因/), {
      target: { value: '成员确认原件上传错误' },
    });
    fireEvent.click(screen.getByRole('button', { name: '检查影响' }));

    await waitFor(() =>
      expect(mocks.getSourceDocumentDependencies).toHaveBeenCalledWith(
        51,
        undefined,
        {
          capability: 'owner_source_withdraw',
          reason: '成员确认原件上传错误',
        }
      )
    );
    expect(await screen.findByText(/正式检验指标 3 项/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确认撤回' }));
    await waitFor(() =>
      expect(mocks.withdrawSourceDocument).toHaveBeenCalledWith(
        51,
        '成员确认原件上传错误',
        {
          capability: 'owner_source_withdraw',
          reason: '成员确认原件上传错误',
        }
      )
    );
  });
});
