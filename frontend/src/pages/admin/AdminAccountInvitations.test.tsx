import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listInvitations: vi.fn(),
  createInvitation: vi.fn(),
  cancelInvitation: vi.fn(),
}));

vi.mock('../../components/admin/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid="admin-layout">{children}</div>
  ),
}));

vi.mock('../../services/api/accountInvitationApi', () => ({
  default: mocks,
}));

import AdminAccountInvitations from './AdminAccountInvitations';

const pendingInvitation = {
  id: 'synthetic-invitation-id',
  recipient_label: '虚构家人甲',
  status: 'pending',
  expires_at: '2026-07-31T12:00:00Z',
  created_at: '2026-07-28T12:00:00Z',
  activated_at: null,
  declined_at: null,
  cancelled_at: null,
  activated_member: null,
};

describe('AdminAccountInvitations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listInvitations.mockResolvedValue({
      contract_version: 'household-account-invitation@1.0.0',
      items: [pendingInvitation],
      total: 1,
    });
    mocks.createInvitation.mockResolvedValue({
      contract_version: 'household-account-invitation@1.0.0',
      invitation: {
        ...pendingInvitation,
        id: 'new-synthetic-invitation-id',
        recipient_label: '虚构朋友乙',
      },
      activation_path:
        '/activate#token=synthetic-single-display-invitation-token',
    });
    mocks.cancelInvitation.mockResolvedValue({
      ...pendingInvitation,
      status: 'cancelled',
      cancelled_at: '2026-07-28T13:00:00Z',
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('creates a link once and keeps group assignment outside this flow', async () => {
    render(
      <MantineProvider>
        <AdminAccountInvitations />
      </MantineProvider>
    );

    expect(await screen.findByText('成员邀请')).toBeInTheDocument();
    expect(screen.getByText('仅系统管理员可见')).toBeInTheDocument();
    expect(
      screen.getByText(/激活只会创建成员自己的账号和健康档案/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/加入分组/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('成员备注'), {
      target: { value: '虚构朋友乙' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成邀请链接' }));

    await waitFor(() => {
      expect(mocks.createInvitation).toHaveBeenCalledWith({
        recipient_label: '虚构朋友乙',
        expires_in_hours: 72,
      });
    });
    expect(await screen.findByText('链接只在本次显示')).toBeInTheDocument();
    const linkInput = screen.getByLabelText('新生成的激活链接');
    expect((linkInput as HTMLInputElement).value).toContain(
      '/activate#token=synthetic-single-display-invitation-token'
    );

    fireEvent.click(screen.getByRole('button', { name: '复制链接' }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining(
          '/activate#token=synthetic-single-display-invitation-token'
        )
      );
    });
  });

  it('lists status without a reusable secret and requires a cancellation reason', async () => {
    render(
      <MantineProvider>
        <AdminAccountInvitations />
      </MantineProvider>
    );

    expect(await screen.findByText('虚构家人甲')).toBeInTheDocument();
    expect(screen.getByText('等待激活')).toBeInTheDocument();
    expect(
      screen.queryByText('synthetic-single-display-invitation-token')
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '撤销邀请' }));
    expect(await screen.findByText('确认撤销这份邀请？')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: '确认撤销' });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('撤销原因'), {
      target: { value: '成员暂时不需要使用' },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(mocks.cancelInvitation).toHaveBeenCalledWith(
        'synthetic-invitation-id',
        '成员暂时不需要使用'
      );
    });
  });
});
