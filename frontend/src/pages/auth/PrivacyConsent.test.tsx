import { fireEvent, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import render from '../../test-utils/render';
import { authService } from '../../services/auth/simpleAuthService';
import PrivacyConsent from './PrivacyConsent';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => mockNavigate,
}));

vi.mock('../../services/auth/simpleAuthService', () => ({
  authService: {
    getPrivacyConsent: vi.fn(),
    submitPrivacyConsent: vi.fn(),
  },
}));

const notice = {
  notice_version: 'household-privacy-notice@1.0.0',
  locale: 'zh-CN',
  kicker: '受邀成员激活说明',
  title: '家庭健康档案服务使用与隐私说明',
  summary: '请先了解这套家庭健康档案如何保存、使用和共享资料。',
  required: true,
  accepted: false,
  latest_decision: null,
  external_processing_consent_included: false,
  external_processing_title: '本次确认不包含外部处理',
  external_processing_body:
    '外部 OCR、模型或存储仍保持关闭；将来如需启用，会显示单独的说明和确认。',
  confirmation_text: '我已阅读并理解以上说明，自愿继续使用。',
  accept_label: '同意并进入家庭健康档案',
  decline_label: '暂不同意并退出',
  version_label: '版本',
  sections: [
    {
      key: 'sole_admin_global_read',
      title: '唯一管理员可读取全部资料',
      body: '实例所有者可以读取服务器中的全部健康资料，相关访问会留痕。',
    },
    {
      key: 'reciprocal_structured_dashboard',
      title: '组内双向查看结构化面板',
      body: '管理员可配置哪些成员彼此查看结构化指标和趋势。',
    },
    {
      key: 'external_processing_separate',
      title: '外部处理需要另行确认',
      body: '本次同意不包含外部 OCR、模型或存储服务。',
    },
  ],
};

describe('PrivacyConsent', () => {
  const logout = vi.fn().mockResolvedValue(undefined);
  const clearPrivacyConsentRequired = vi.fn();
  const authContextValue = {
    isAuthenticated: true,
    isLoading: false,
    user: { id: 1, username: 'member' },
    logout,
    clearPrivacyConsentRequired,
    privacyConsentRequired: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authService.getPrivacyConsent).mockResolvedValue(notice);
  });

  test('shows the versioned administrator, sharing and external-processing disclosures', async () => {
    render(<PrivacyConsent />, { authContextValue });

    expect(
      await screen.findByText('家庭健康档案服务使用与隐私说明')
    ).toBeInTheDocument();
    expect(screen.getByText('唯一管理员可读取全部资料')).toBeInTheDocument();
    expect(screen.getByText('组内双向查看结构化面板')).toBeInTheDocument();
    expect(screen.getByText('外部处理需要另行确认')).toBeInTheDocument();
    expect(
      screen.getByText('版本：household-privacy-notice@1.0.0')
    ).toBeInTheDocument();
  });

  test('requires an explicit checkbox before acceptance', async () => {
    render(<PrivacyConsent />, { authContextValue });

    const acceptButton = await screen.findByRole('button', {
      name: '同意并进入家庭健康档案',
    });
    expect(acceptButton).toBeDisabled();

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: '我已阅读并理解以上说明，自愿继续使用。',
      })
    );
    expect(acceptButton).toBeEnabled();
  });

  test('accepts the exact displayed version and enters the family health page', async () => {
    vi.mocked(authService.submitPrivacyConsent).mockResolvedValue({
      privacy_consent_required: false,
    });
    render(<PrivacyConsent />, { authContextValue });

    fireEvent.click(
      await screen.findByRole('checkbox', {
        name: '我已阅读并理解以上说明，自愿继续使用。',
      })
    );
    fireEvent.click(
      screen.getByRole('button', { name: '同意并进入家庭健康档案' })
    );

    await waitFor(() => {
      expect(authService.submitPrivacyConsent).toHaveBeenCalledWith({
        noticeVersion: notice.notice_version,
        decision: 'accepted',
      });
      expect(clearPrivacyConsentRequired).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/family-health', {
        replace: true,
      });
    });
  });

  test('records decline and closes the restricted session', async () => {
    vi.mocked(authService.submitPrivacyConsent).mockResolvedValue({
      privacy_consent_required: true,
    });
    render(<PrivacyConsent />, { authContextValue });

    fireEvent.click(
      await screen.findByRole('button', { name: '暂不同意并退出' })
    );

    await waitFor(() => {
      expect(authService.submitPrivacyConsent).toHaveBeenCalledWith({
        noticeVersion: notice.notice_version,
        decision: 'declined',
      });
      expect(logout).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
    });
  });
});
