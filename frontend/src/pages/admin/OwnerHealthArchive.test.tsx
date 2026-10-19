import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  getOwnerSubjects: vi.fn(),
  authorizeOwnerDashboardHandoff: vi.fn(),
  getVitals: vi.fn(),
  getCatalog: vi.fn(),
  getTrend: vi.fn(),
  getSourceDocuments: vi.fn(),
  downloadSourceDocument: vi.fn(),
  previewSourceDocument: vi.fn(),
  downloadBlob: vi.fn(),
}));

vi.mock('../../services/api/adminApi', () => ({
  adminApiService: {
    getOwnerSubjects: mocks.getOwnerSubjects,
    authorizeOwnerDashboardHandoff: mocks.authorizeOwnerDashboardHandoff,
  },
}));

vi.mock('../../services/medical/vitalsService', () => ({
  vitalsService: {
    getVitals: mocks.getVitals,
  },
}));

vi.mock('../../services/api/labTestComponentApi', () => ({
  labTestComponentApi: {
    getComponentCatalog: mocks.getCatalog,
    getTrendsByPatientAndTest: mocks.getTrend,
  },
}));

vi.mock('../../services/api/healthImportApi', () => ({
  default: {
    listSourceDocuments: mocks.getSourceDocuments,
    downloadSourceDocument: mocks.downloadSourceDocument,
    previewSourceDocument: mocks.previewSourceDocument,
  },
}));

vi.mock('../../utils/downloadUtils', () => ({
  downloadBlob: mocks.downloadBlob,
}));

vi.mock('../prototype/HouseholdHealthPrototype', () => ({
  default: ({
    experience,
    onDownloadReport,
    onPreviewReport,
    onPrepareHandoff,
  }: {
    experience: {
      subject: { label: string };
      accessNotice?: string;
      capabilities: {
        canUpload: boolean;
        canExport: boolean;
        canDownloadSources?: boolean;
        canPreviewSources?: boolean;
        canCopyForAi?: boolean;
        canShare?: boolean;
      };
    };
    onDownloadReport?: (_sourceDocumentId: number) => void;
    onPreviewReport?: (_sourceDocumentId: number) => Promise<Blob>;
    onPrepareHandoff?: (_request: {
      kind: 'clipboard' | 'csv' | 'print';
      scope: 'all-loaded' | 'latest-report' | 'recent-five-years';
      includeReports: boolean;
      metricCount: number;
      reportCount: number;
    }) => Promise<void>;
  }) => (
    <div>
      <span data-testid="subject-label">{experience.subject.label}</span>
      <span data-testid="access-notice">{experience.accessNotice}</span>
      <span data-testid="can-upload">
        {String(experience.capabilities.canUpload)}
      </span>
      <span data-testid="can-export">
        {String(experience.capabilities.canExport)}
      </span>
      <span data-testid="can-download">
        {String(experience.capabilities.canDownloadSources)}
      </span>
      <span data-testid="can-preview">
        {String(experience.capabilities.canPreviewSources)}
      </span>
      <span data-testid="can-share">
        {String(experience.capabilities.canShare)}
      </span>
      <span data-testid="can-copy-for-ai">
        {String(experience.capabilities.canCopyForAi)}
      </span>
      {experience.capabilities.canDownloadSources ? (
        <button type="button" onClick={() => onDownloadReport?.(41)}>
          下载测试原件
        </button>
      ) : null}
      {experience.capabilities.canPreviewSources ? (
        <button type="button" onClick={() => void onPreviewReport?.(41)}>
          预览测试原件
        </button>
      ) : null}
      {experience.capabilities.canExport ? (
        <button
          type="button"
          onClick={() =>
            void onPrepareHandoff?.({
              kind: 'csv',
              scope: 'recent-five-years',
              includeReports: true,
              metricCount: 2,
              reportCount: 1,
            })
          }
        >
          准备测试导出
        </button>
      ) : null}
    </div>
  ),
}));

import OwnerHealthArchive from './OwnerHealthArchive';

const renderPage = (patientId = '22') =>
  render(
    <MemoryRouter initialEntries={[`/admin/owner-archive/${patientId}`]}>
      <Routes>
        <Route
          path="/admin/owner-archive/:patientId"
          element={<OwnerHealthArchive />}
        />
      </Routes>
    </MemoryRouter>
  );

describe('OwnerHealthArchive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOwnerSubjects.mockResolvedValue({
      subjects: [
        {
          id: 22,
          first_name: '小明',
          last_name: '王',
          owner_user_id: 2,
          access_basis: 'owner_global_read',
          permission_level: 'owner_global_read',
        },
      ],
      total_count: 1,
      disclosure: '管理员查看会被记录',
    });
    mocks.getVitals.mockResolvedValue([]);
    mocks.getCatalog.mockResolvedValue({ items: [], total: 0 });
    mocks.getTrend.mockResolvedValue({ data_points: [] });
    mocks.getSourceDocuments.mockResolvedValue([
      {
        id: 41,
        patient_id: 22,
        display_name: '年度体检报告',
        original_filename: 'report.pdf',
        document_type: 'checkup',
        report_date: '2026-06-18',
        facility: '市第一医院',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        sha256: 'abc',
        storage_backend: 'local',
        status: 'active',
        created_at: '2026-06-18T09:00:00Z',
        updated_at: '2026-06-18T09:00:00Z',
      },
    ]);
    mocks.downloadSourceDocument.mockResolvedValue(
      new Blob(['synthetic report'], { type: 'application/pdf' })
    );
    mocks.previewSourceDocument.mockResolvedValue(
      new Blob(['synthetic report'], { type: 'application/pdf' })
    );
    mocks.authorizeOwnerDashboardHandoff.mockResolvedValue({
      status: 'authorized',
    });
  });

  it('loads an explicitly audited read-only archive', async () => {
    renderPage();

    expect(await screen.findByTestId('subject-label')).toHaveTextContent(
      '小明王'
    );
    expect(screen.getByTestId('access-notice')).toHaveTextContent(
      '管理员只读查看'
    );
    expect(screen.getByTestId('access-notice')).toHaveTextContent('已记录');
    expect(screen.getByTestId('can-upload')).toHaveTextContent('false');
    expect(screen.getByTestId('can-export')).toHaveTextContent('true');
    expect(screen.getByTestId('can-download')).toHaveTextContent('true');
    expect(screen.getByTestId('can-preview')).toHaveTextContent('true');
    expect(screen.getByTestId('can-share')).toHaveTextContent('true');
    expect(screen.getByTestId('can-copy-for-ai')).toHaveTextContent('false');

    await waitFor(() => {
      expect(mocks.getVitals).toHaveBeenCalledWith(
        expect.objectContaining({
          patient_id: 22,
          owner_access: 'global_read',
          owner_access_reason: '查看家庭健康档案',
        })
      );
    });
    expect(mocks.getCatalog).toHaveBeenCalledWith(
      22,
      expect.objectContaining({
        ownerAccess: 'global_read',
        ownerAccessReason: '查看家庭健康档案',
      }),
      expect.any(AbortSignal)
    );
    expect(mocks.getSourceDocuments).toHaveBeenCalledWith(
      22,
      expect.any(AbortSignal),
      false,
      {
        capability: 'global_read',
        reason: '查看家庭健康档案',
      }
    );

    fireEvent.click(screen.getByRole('button', { name: '下载测试原件' }));
    await waitFor(() => {
      expect(mocks.downloadSourceDocument).toHaveBeenCalledWith(41, {
        capability: 'global_read',
        reason: '下载家庭报告原件',
      });
    });
    expect(mocks.downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      'report.pdf'
    );

    fireEvent.click(screen.getByRole('button', { name: '预览测试原件' }));
    await waitFor(() => {
      expect(mocks.previewSourceDocument).toHaveBeenCalledWith(41, {
        capability: 'global_read',
        reason: '预览家庭报告原件',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '准备测试导出' }));
    await waitFor(() => {
      expect(mocks.authorizeOwnerDashboardHandoff).toHaveBeenCalledWith(22, {
        capability: 'global_read',
        reason: '导出家庭健康面板摘要',
        handoffKind: 'csv',
        scope: 'recent-five-years',
        includeReports: true,
        metricCount: 2,
        reportCount: 1,
      });
    });
  });

  it('fails closed when the route subject is not in the owner directory', async () => {
    renderPage('999');

    expect(
      await screen.findByText('未找到可只读查看的成员档案。')
    ).toBeInTheDocument();
    expect(mocks.getVitals).not.toHaveBeenCalled();
  });
});
