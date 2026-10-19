import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isOwner: true,
  patient: {
    id: 7,
    first_name: '王',
    last_name: '芳',
    owner_user_id: 1,
  },
  list: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  cancel: vi.fn(),
  download: vi.fn(),
  downloadBlob: vi.fn(),
}));

vi.mock('../hooks/useGlobalData', () => ({
  useCurrentPatient: () => ({
    patient: mocks.patient,
    loading: false,
    error: null,
  }),
}));

vi.mock('../hooks/usePatientPermissions', () => ({
  usePatientPermissions: () => ({ isOwner: mocks.isOwner }),
}));

vi.mock('../services/api/healthArchiveExportApi', () => ({
  default: {
    list: mocks.list,
    create: mocks.create,
    get: mocks.get,
    cancel: mocks.cancel,
    download: mocks.download,
  },
}));

vi.mock('../utils/downloadUtils', () => ({
  downloadBlob: mocks.downloadBlob,
}));

const readyArchive = {
  id: 31,
  patient_id: 7,
  schema_version: 'household-health-archive/1.0',
  status: 'ready',
  attempt_count: 1,
  archive_filename: 'family-health-archive-20260727-abcdef.zip',
  archive_size_bytes: 2048,
  archive_sha256: 'a'.repeat(64),
  original_count: 2,
  manifest_summary: {
    original_count: 2,
    structured_record_count: 16,
    zip_crc_verified: true,
  },
  error_code: null,
  started_at: '2026-07-27T08:00:00Z',
  completed_at: '2026-07-27T08:00:01Z',
  expires_at: '2026-07-28T08:00:01Z',
  cancelled_at: null,
  downloaded_at: null,
  created_at: '2026-07-27T08:00:00Z',
  updated_at: '2026-07-27T08:00:01Z',
  can_download: true,
};

const renderPage = async () => {
  const { default: HealthArchiveExportPage } =
    await import('./HealthArchiveExportPage');
  return render(
    <MemoryRouter>
      <HealthArchiveExportPage />
    </MemoryRouter>
  );
};

describe('HealthArchiveExportPage', () => {
  beforeEach(() => {
    mocks.isOwner = true;
    mocks.patient = {
      id: 7,
      first_name: '王',
      last_name: '芳',
      owner_user_id: 1,
    };
    mocks.list.mockReset().mockResolvedValue({ items: [], total: 0 });
    mocks.create.mockReset().mockResolvedValue(readyArchive);
    mocks.get.mockReset().mockResolvedValue(readyArchive);
    mocks.cancel.mockReset();
    mocks.download.mockReset().mockResolvedValue({
      blob: new Blob(['synthetic archive'], { type: 'application/zip' }),
      filename: readyArchive.archive_filename,
    });
    mocks.downloadBlob.mockReset();
  });

  it('explains the complete scope and generates a self-owned archive', async () => {
    await renderPage();

    expect(
      screen.getByRole('heading', { name: '完整档案导出' })
    ).toBeInTheDocument();
    expect(screen.getByText('王芳')).toBeInTheDocument();
    expect(screen.getByText('结构化健康数据')).toBeInTheDocument();
    expect(screen.getByText('全部留存报告原件')).toBeInTheDocument();
    expect(screen.getByText('清单与完整性校验')).toBeInTheDocument();
    expect(screen.getByText(/不会包含账号密码/)).toBeInTheDocument();

    fireEvent.click(
      await screen.findByRole('button', { name: '生成完整档案' })
    );
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0][0]).toBe(7);
    expect(mocks.create.mock.calls[0][1]).toMatch(/^health-archive-/);
    expect(
      await screen.findByRole('button', { name: '下载完整档案' })
    ).toBeInTheDocument();
  });

  it('downloads the verified ZIP and shows integrity context', async () => {
    mocks.list.mockResolvedValue({ items: [readyArchive], total: 1 });
    await renderPage();

    expect(await screen.findByText('归档已完成并通过校验')).toBeInTheDocument();
    expect(screen.getByText('2 份报告原件')).toBeInTheDocument();
    expect(screen.getByText('16 条结构化记录')).toBeInTheDocument();
    expect(screen.getByText(/aaaaaaaaaaaa/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '下载完整档案' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith(31));
    expect(mocks.downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      readyArchive.archive_filename
    );
  });

  it('does not expose archive generation for a shared subject', async () => {
    mocks.isOwner = false;
    await renderPage();

    expect(screen.getByText('这里只能导出你自己的档案')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '生成完整档案' })
    ).not.toBeInTheDocument();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
