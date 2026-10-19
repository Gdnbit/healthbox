import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listCircles: vi.fn(),
  listAdminSubjects: vi.fn(),
  createCircle: vi.fn(),
  setCircleStatus: vi.fn(),
  addMember: vi.fn(),
  setMembershipStatus: vi.fn(),
  removeMember: vi.fn(),
  moveMember: vi.fn(),
}));

vi.mock('../../components/admin/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid="admin-layout">{children}</div>
  ),
}));

vi.mock('../../services/api/archiveCircleApi', () => ({
  default: mocks,
}));

import ArchiveCircleManagement from './ArchiveCircleManagement';

const circle = {
  id: 3,
  name: '家人',
  description: '合成测试组',
  status: 'active',
  created_at: '2026-07-27T09:00:00Z',
  updated_at: '2026-07-27T09:00:00Z',
  members: [
    {
      patient_id: 17,
      display_name: '成员甲',
      account_id: 27,
      username: 'member-a',
      account_active: true,
      status: 'active',
      scope: 'structured_dashboard',
      joined_at: '2026-07-27T09:00:00Z',
      paused_at: null,
      removed_at: null,
      updated_at: '2026-07-27T09:00:00Z',
    },
  ],
};

describe('ArchiveCircleManagement', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.listCircles.mockResolvedValue({ circles: [circle] });
    mocks.listAdminSubjects.mockResolvedValue({
      subjects: [
        {
          patient_id: 17,
          display_name: '成员甲',
          account_id: 27,
          username: 'member-a',
          account_active: true,
        },
        {
          patient_id: 18,
          display_name: '成员乙',
          account_id: 28,
          username: 'member-b',
          account_active: true,
        },
      ],
    });
    mocks.createCircle.mockResolvedValue({
      status: 'ok',
      circle_id: 4,
      patient_id: null,
    });
    mocks.setMembershipStatus.mockResolvedValue({
      status: 'ok',
      circle_id: 3,
      patient_id: 17,
    });
  });

  it('shows hidden group management and performs audited mutations', async () => {
    render(
      <MantineProvider>
        <ArchiveCircleManagement />
      </MantineProvider>
    );

    expect(await screen.findByText('家人')).toBeInTheDocument();
    expect(screen.getByText('仅系统管理员可见')).toBeInTheDocument();
    expect(
      screen.getByText(/普通成员只会看到“可查看的档案”/)
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('例如：家人'), {
      target: { value: '朋友甲组' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建内部组' }));
    await waitFor(() =>
      expect(mocks.createCircle).toHaveBeenCalledWith('朋友甲组', null)
    );

    fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    await waitFor(() =>
      expect(mocks.setMembershipStatus).toHaveBeenCalledWith(3, 17, 'paused')
    );
  });
});
