import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  inspectInvitation: vi.fn(),
  activateInvitation: vi.fn(),
  declineInvitation: vi.fn(),
  consumeInvitationToken: vi.fn(),
}));

vi.mock('../../services/api/accountInvitationApi', () => ({
  default: mocks,
}));

vi.mock('../../services/accountInvitationTokenVault', () => ({
  consumeInvitationToken: mocks.consumeInvitationToken,
}));

import AccountInvitationActivation from './AccountInvitationActivation';

const notice = {
  notice_version: 'household-privacy-notice@1.0.0',
  locale: 'zh-CN',
  kicker: '受邀成员激活说明',
  title: 'HealthBox · 健康档案盒服务使用与隐私说明',
  summary: '请先了解这套HealthBox · 健康档案盒如何保存、使用和共享资料。',
  sections: [
    {
      key: 'sole_admin_global_read',
      title: '唯一管理员可以读取服务器中的全部健康资料',
      body: '管理员查看和维护会按能力留痕。',
    },
    {
      key: 'reciprocal_structured_dashboard',
      title: '管理员可以配置组内双向查看结构化面板',
      body: '普通成员不需要管理或了解组名。',
    },
    {
      key: 'external_processing_separate',
      title: '外部 OCR、模型或存储需要另行明确确认',
      body: '本次确认不包含任何外部处理。',
    },
  ],
  scope: {},
  external_processing_consent_included: false,
  external_processing_title: '本次确认不包含外部处理',
  external_processing_body: '外部处理仍保持关闭。',
  confirmation_text: '我已阅读并理解以上说明，自愿继续使用。',
  accept_label: '同意并创建我的账号',
  decline_label: '暂不加入',
  version_label: '版本',
};

describe('AccountInvitationActivation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumeInvitationToken.mockReturnValue('synthetic-invitation-token');
    mocks.inspectInvitation.mockResolvedValue({
      contract_version: 'household-account-invitation@1.0.0',
      valid: true,
      expires_at: '2026-07-31T12:00:00Z',
      privacy_notice: notice,
    });
    mocks.activateInvitation.mockResolvedValue({
      contract_version: 'household-account-invitation@1.0.0',
      status: 'activated',
      username: 'member01',
      display_name: '虚构成员甲',
      login_path: '/login',
    });
    mocks.declineInvitation.mockResolvedValue(null);
  });

  it('shows the complete Chinese disclosure before the profile form', async () => {
    render(
      <MantineProvider>
        <AccountInvitationActivation />
      </MantineProvider>
    );

    expect(
      await screen.findByRole('heading', { name: '创建你的 HealthBox 账号' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('唯一管理员可以读取服务器中的全部健康资料')
    ).toBeInTheDocument();
    expect(
      screen.getByText('管理员可以配置组内双向查看结构化面板')
    ).toBeInTheDocument();
    expect(
      screen.getByText('外部 OCR、模型或存储需要另行明确确认')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建账号' })).toBeDisabled();
  });

  it('activates one ordinary account only after explicit confirmation', async () => {
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem');
    render(
      <MantineProvider>
        <AccountInvitationActivation />
      </MantineProvider>
    );

    await screen.findByLabelText('显示名');
    fireEvent.change(screen.getByLabelText('显示名'), {
      target: { value: '虚构成员甲' },
    });
    fireEvent.change(screen.getByLabelText('登录用户名'), {
      target: { value: 'member01' },
    });
    fireEvent.change(screen.getByLabelText('出生日期'), {
      target: { value: '1990-01-01' },
    });
    fireEvent.change(screen.getByLabelText('性别'), {
      target: { value: 'prefer_not_to_say' },
    });
    fireEvent.change(screen.getByLabelText('设置密码'), {
      target: { value: 'SyntheticMemberPassword9' },
    });
    fireEvent.change(screen.getByLabelText('再次输入密码'), {
      target: { value: 'SyntheticMemberPassword9' },
    });
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: '我已阅读并理解以上说明，自愿继续使用。',
      })
    );

    const submit = screen.getByRole('button', { name: '创建账号' });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => {
      expect(mocks.activateInvitation).toHaveBeenCalledWith({
        token: 'synthetic-invitation-token',
        username: 'member01',
        display_name: '虚构成员甲',
        birth_date: '1990-01-01',
        gender: 'prefer_not_to_say',
        password: 'SyntheticMemberPassword9',
        privacy_notice_version: 'household-privacy-notice@1.0.0',
        privacy_notice_accepted: true,
      });
    });
    expect(await screen.findByText('账号已经创建')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '前往登录' })).toHaveAttribute(
      'href',
      '/login'
    );
    expect(storageSpy).not.toHaveBeenCalled();
    storageSpy.mockRestore();
  });

  it('shows one generic unavailable state when no token can be consumed', async () => {
    mocks.consumeInvitationToken.mockReturnValue(null);

    render(
      <MantineProvider>
        <AccountInvitationActivation />
      </MantineProvider>
    );

    expect(await screen.findByText('这个邀请链接无法使用')).toBeInTheDocument();
    expect(mocks.inspectInvitation).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: '返回登录' })).toHaveAttribute(
      'href',
      '/login'
    );
  });

  it('allows the token holder to decline without creating an account', async () => {
    render(
      <MantineProvider>
        <AccountInvitationActivation />
      </MantineProvider>
    );

    fireEvent.click(await screen.findByRole('button', { name: '暂不加入' }));
    expect(await screen.findByText('确定暂不加入吗？')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认暂不加入' }));

    await waitFor(() => {
      expect(mocks.declineInvitation).toHaveBeenCalledWith(
        'synthetic-invitation-token'
      );
      expect(mocks.activateInvitation).not.toHaveBeenCalled();
    });
    expect(await screen.findByText('已选择暂不加入')).toBeInTheDocument();
  });
});
