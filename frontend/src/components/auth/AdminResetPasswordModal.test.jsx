import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const resetMemberAccess = vi.fn();

vi.mock('../../services/api/adminApi', () => ({
  adminApiService: {
    resetMemberAccess: (...args) => resetMemberAccess(...args),
  },
}));

vi.mock('../../services/logger', () => ({
  default: {
    error: vi.fn(),
  },
}));

import AdminResetPasswordModal from './AdminResetPasswordModal';

const renderModal = () =>
  render(
    <MantineProvider>
      <AdminResetPasswordModal
        isOpen
        onClose={vi.fn()}
        userId={7}
        username="member_one"
      />
    </MantineProvider>
  );

describe('AdminResetPasswordModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMemberAccess.mockResolvedValue({
      target_user_id: 7,
      target_username: 'member_one',
      temporary_password: 'Temporary-Example-789',
      expires_at: '2026-07-27T13:00:00Z',
      must_change_password: true,
      sessions_revoked: true,
      result: 'success',
    });
  });

  it('never accepts an administrator-selected password', async () => {
    renderModal();

    expect(screen.queryByLabelText('New Password')).not.toBeInTheDocument();
    const issueButton = screen.getByTestId('model-edit-issue-reset');
    expect(issueButton).toBeDisabled();

    fireEvent.change(screen.getByTestId('model-edit-reset-confirm'), {
      target: { value: 'member_one' },
    });
    fireEvent.change(screen.getByTestId('model-edit-reset-reason'), {
      target: { value: '成员忘记密码' },
    });
    fireEvent.click(issueButton);

    await waitFor(() => {
      expect(resetMemberAccess).toHaveBeenCalledWith(7, {
        confirm_username: 'member_one',
        reason: '成员忘记密码',
      });
    });
    expect(
      await screen.findByTestId('model-edit-temporary-password')
    ).toHaveTextContent('Temporary-Example-789');
    expect(
      screen.getByText(/cannot be viewed again|无法再次查看/)
    ).toBeVisible();
  });
});
