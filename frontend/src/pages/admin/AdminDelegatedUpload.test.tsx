import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setEnabled: vi.fn(),
  listSubjects: vi.fn(),
  listUploadBatches: vi.fn(),
  createUploadBatch: vi.fn(),
  uploadSourceDocument: vi.fn(),
  completeUploadBatch: vi.fn(),
  getUploadBatch: vi.fn(),
  cancelUploadBatch: vi.fn(),
  withdrawSourceDocument: vi.fn(),
}));

vi.mock('../../components/admin/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid="admin-layout">{children}</div>
  ),
}));

vi.mock('../../features/householdHealth/HouseholdReportUploadModal', () => ({
  default: ({
    subjectLabel,
    operatorContext,
    serverBatchMode,
  }: {
    subjectLabel: string;
    operatorContext?: { label: string; mode: string };
    serverBatchMode?: boolean;
  }) => (
    <div role="dialog" aria-label="代上传测试弹窗">
      <span>{subjectLabel}</span>
      <span>{operatorContext?.label}</span>
      <span>{operatorContext?.mode}</span>
      <span>{serverBatchMode ? '服务器批次' : '非服务器批次'}</span>
    </div>
  ),
}));

vi.mock('../../services/api/adminDelegatedUploadApi', () => ({
  default: mocks,
}));

import AdminDelegatedUpload from './AdminDelegatedUpload';

describe('AdminDelegatedUpload', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getSettings.mockResolvedValue({
      enabled: false,
      capability: 'delegated_upload',
      disclosure: '管理员代上传默认关闭；启用和每次使用都会记录',
    });
    mocks.listSubjects.mockResolvedValue({
      subjects: [
        {
          patient_id: 17,
          display_name: '成员甲',
          account_id: 27,
          username: 'member-a',
          account_active: true,
        },
      ],
    });
    mocks.listUploadBatches.mockResolvedValue([]);
    mocks.setEnabled.mockResolvedValue({
      enabled: true,
      capability: 'delegated_upload',
      disclosure: '管理员代上传默认关闭；启用和每次使用都会记录',
    });
  });

  it('keeps target selection and upload unavailable while disabled', async () => {
    render(
      <MantineProvider>
        <AdminDelegatedUpload />
      </MantineProvider>
    );

    expect(await screen.findByText('管理员代上传')).toBeInTheDocument();
    expect(screen.getByText('当前已关闭')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '为该成员上传报告' })
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('选择目标成员')).not.toBeInTheDocument();
  });

  it('requires an explicit reason and continuously shows actor and target', async () => {
    render(
      <MantineProvider>
        <AdminDelegatedUpload />
      </MantineProvider>
    );

    await screen.findByText('当前已关闭');
    fireEvent.click(screen.getByRole('button', { name: '启用代上传' }));
    expect(mocks.setEnabled).not.toHaveBeenCalled();
    expect(screen.getByText('请先填写本次启用原因。')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('启用或关闭原因'), {
      target: { value: '特殊情况下协助成员留存原件' },
    });
    fireEvent.click(screen.getByRole('button', { name: '启用代上传' }));

    await waitFor(() =>
      expect(mocks.setEnabled).toHaveBeenCalledWith(
        true,
        '特殊情况下协助成员留存原件'
      )
    );
    expect(await screen.findByText('当前已启用')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('选择目标成员'), {
      target: { value: '17' },
    });
    fireEvent.change(screen.getByLabelText('本次代上传原因'), {
      target: { value: '协助成员保存体检报告' },
    });

    expect(screen.getByText('实际操作者：系统管理员')).toBeInTheDocument();
    expect(screen.getByText('目标档案：成员甲')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '为该成员上传报告' }));
    expect(
      await screen.findByRole('dialog', { name: '代上传测试弹窗' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('管理员代上传（不会冒充成员）')
    ).toBeInTheDocument();
    expect(screen.getByText('delegated')).toBeInTheDocument();
    expect(screen.getByText('服务器批次')).toBeInTheDocument();
  });
});
