import { fireEvent, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import render from '../test-utils/render';
import privacyAccessApi from '../services/api/privacyAccessApi';
import PrivacyAccessPage from './PrivacyAccessPage';
import { SYNTHETIC_PRIVACY_ACCESS_PREVIEW } from './PrivacyAccessPage';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => mockNavigate,
}));

vi.mock('../services/api/privacyAccessApi', () => ({
  default: {
    getMine: vi.fn(),
  },
}));

const accessRecord = {
  subject: { display_name: '林晓' },
  visibility: {
    administrator: {
      label: '系统管理员',
      can_read_all_server_data: true,
    },
    reciprocal_viewers: [
      {
        display_name: '王芳',
        scope: 'structured_dashboard' as const,
        scope_label: '结构化指标与趋势',
      },
    ],
    not_shared_by_default: [
      '报告原件',
      '报告文字描述',
      '编辑权限',
      '导出权限',
      'AI 分析权限',
    ],
  },
  events: [
    {
      actor: { kind: 'member' as const, label: '王芳' },
      action: 'viewed',
      action_label: '查看',
      resource: { kind: 'dashboard', label: '结构化面板' },
      authorization: {
        basis: 'archive_circle',
        label: '相互可见关系',
      },
      result: 'allowed',
      occurred_at: '2026-07-28T08:30:00Z',
    },
    {
      actor: { kind: 'administrator' as const, label: '系统管理员' },
      action: 'updated',
      action_label: '修改',
      resource: { kind: 'formal_metric', label: '结构化指标' },
      authorization: {
        basis: 'owner_global_read',
        label: '管理员全局读取',
      },
      result: 'completed',
      occurred_at: '2026-07-27T08:30:00Z',
    },
  ],
  total: 2,
  offset: 0,
  limit: 20,
  generated_at: '2026-07-28T09:00:00Z',
  history_notice:
    '这里只显示系统现有审计记录能够确认的访问和操作；早期未记录的行为不会被补写。',
};

describe('PrivacyAccessPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(privacyAccessApi.getMine).mockResolvedValue(accessRecord);
  });

  it('renders the synthetic standalone prototype without calling the API', async () => {
    render(
      <PrivacyAccessPage previewRecord={SYNTHETIC_PRIVACY_ACCESS_PREVIEW} />
    );

    expect(screen.getByText('林晓（虚构）的档案')).toBeInTheDocument();
    expect(screen.getByText('王芳（虚构）')).toBeInTheDocument();
    expect(privacyAccessApi.getMine).not.toHaveBeenCalled();
  });

  it('explains current visibility without exposing internal group metadata', async () => {
    render(<PrivacyAccessPage />);

    expect(
      await screen.findByText('谁可以查看我的档案')
    ).toBeInTheDocument();
    expect(screen.getByText('系统管理员')).toBeInTheDocument();
    expect(screen.getByText('王芳')).toBeInTheDocument();
    expect(screen.getByText('结构化指标与趋势')).toBeInTheDocument();
    expect(screen.getByText('默认不会共享')).toBeInTheDocument();
    expect(screen.getByText('报告原件')).toBeInTheDocument();
    expect(screen.queryByText(/组名|组 ID|内部组/)).not.toBeInTheDocument();
  });

  it('shows a plain-language access history with no technical identifiers', async () => {
    render(<PrivacyAccessPage />);

    expect(await screen.findByText('最近访问记录')).toBeInTheDocument();
    expect(screen.getByText('王芳查看了结构化面板')).toBeInTheDocument();
    expect(screen.getByText('系统管理员修改了结构化指标')).toBeInTheDocument();
    expect(screen.getByText('相互可见关系')).toBeInTheDocument();
    expect(screen.getByText('管理员全局读取')).toBeInTheDocument();
    expect(screen.getByText(accessRecord.history_notice)).toBeInTheDocument();
    expect(
      screen.queryByText(/user_id|patient_id|IP|entity_id/)
    ).not.toBeInTheDocument();
  });

  it('returns to the household health home', async () => {
    render(<PrivacyAccessPage />);

    fireEvent.click(
      await screen.findByRole('button', { name: '返回家庭健康首页' })
    );
    expect(mockNavigate).toHaveBeenCalledWith('/family-health');
  });

  it('offers a retry when the access record cannot be loaded', async () => {
    vi.mocked(privacyAccessApi.getMine)
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce(accessRecord);
    render(<PrivacyAccessPage />);

    expect(await screen.findByText('暂时无法读取访问记录')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));

    await waitFor(() => {
      expect(privacyAccessApi.getMine).toHaveBeenCalledTimes(2);
      expect(screen.getByText('最近访问记录')).toBeInTheDocument();
    });
  });
});
