import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AdminHealthAiSettings,
  AdminHealthAiTestResponse,
} from '../../services/api/adminHealthAiApi';
import AdminHealthAiSettingsPage from './AdminHealthAiSettings';

vi.mock('../../components/admin/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid="admin-layout">{children}</div>
  ),
}));

vi.mock('../../services/logger', () => ({
  default: {
    error: vi.fn(),
  },
}));

const buildSettings = (
  overrides: Partial<AdminHealthAiSettings> = {}
): AdminHealthAiSettings => ({
  selected_mode: 'off',
  effective_mode: 'off',
  available: false,
  reason_code: 'not_configured',
  configuration_revision: 3,
  verified_revision: 0,
  last_tested_at: null,
  connection_test_required: false,
  base_url: '',
  model: '',
  provider: 'disabled',
  api_key_configured: false,
  local_runtime_allowed: true,
  test_provider_allowed: true,
  instance_data_class: 'synthetic',
  processing_location: '家庭服务器处理',
  disclosure: 'AI 不能修改正式健康档案。',
  ...overrides,
});

const buildTestResponse = (): AdminHealthAiTestResponse => ({
  status: 'passed',
  configuration_revision: 3,
  verified_revision: 0,
  tested_at: '2026-07-29T01:00:00+00:00',
  provider: 'dynamic_test',
  model: 'deterministic-test',
  processing_location: '家庭服务器处理',
  test_mode: true,
  processing_mode: 'test',
  disclosure: '虚构数据动态测试·非模型回答',
  output: {
    answer_items: [
      {
        text: '空腹血糖从 5.1 变化为 5.4 mmol/L。',
        citation_ids: ['R1', 'R2'],
      },
    ],
    general_explanations: [],
    limitations: ['仅使用固定虚构记录。'],
    next_steps: [],
  },
});

describe('AdminHealthAiSettingsPage', () => {
  const getSettings = vi.fn();
  const updateSettings = vi.fn();
  const testConnection = vi.fn();
  const api = { getSettings, updateSettings, testConnection };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows server-secret status but never renders an API key input', async () => {
    getSettings.mockResolvedValue(buildSettings());

    render(
      <MantineProvider>
        <AdminHealthAiSettingsPage api={api} standalone />
      </MantineProvider>
    );

    expect(
      await screen.findByRole('heading', { name: 'AI 服务' })
    ).toBeInTheDocument();
    expect(screen.getByText('服务器密钥')).toBeInTheDocument();
    expect(screen.getByText('已关闭')).toBeInTheDocument();
    expect(screen.getByText(/本页面不接收也不回显密钥/)).toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: /api key/i })
    ).not.toBeInTheDocument();
  });

  it('saves a local provider by optimistic revision and reason', async () => {
    const current = buildSettings();
    const saved = buildSettings({
      selected_mode: 'local',
      effective_mode: 'off',
      available: false,
      reason_code: 'connection_test_required',
      configuration_revision: 4,
      verified_revision: 0,
      connection_test_required: true,
      base_url: 'http://127.0.0.1:11434/v1',
      model: 'small-local-model',
      provider: 'local_openai_compatible',
    });
    getSettings.mockResolvedValue(current);
    updateSettings.mockResolvedValue(saved);

    render(
      <MantineProvider>
        <AdminHealthAiSettingsPage api={api} standalone />
      </MantineProvider>
    );

    await screen.findByRole('heading', { name: 'AI 服务' });
    fireEvent.change(screen.getByRole('combobox', { name: /运行模式/ }), {
      target: { value: 'local' },
    });
    fireEvent.change(
      screen.getByRole('textbox', {
        name: /OpenAI-compatible 服务地址/,
      }),
      {
        target: { value: 'http://127.0.0.1:11434/v1' },
      }
    );
    fireEvent.change(screen.getByRole('textbox', { name: /模型 ID/ }), {
      target: { value: 'small-local-model' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /本次操作原因/ }), {
      target: { value: '切换轻量模型' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith({
        expected_revision: 3,
        mode: 'local',
        base_url: 'http://127.0.0.1:11434/v1',
        model: 'small-local-model',
        reason: '切换轻量模型',
      });
    });
    expect(await screen.findByText('修订 4')).toBeInTheDocument();
    expect(screen.getByText('待虚构数据连接测试')).toBeInTheDocument();
  });

  it('fills only the local Ollama address without endorsing an unverified model', async () => {
    getSettings.mockResolvedValue(buildSettings());

    render(
      <MantineProvider>
        <AdminHealthAiSettingsPage api={api} standalone />
      </MantineProvider>
    );

    await screen.findByRole('heading', { name: 'AI 服务' });
    fireEvent.change(screen.getByRole('combobox', { name: /运行模式/ }), {
      target: { value: 'local' },
    });
    fireEvent.click(screen.getByRole('button', { name: '填入本机地址' }));

    expect(
      screen.getByRole('textbox', {
        name: /OpenAI-compatible 服务地址/,
      })
    ).toHaveValue('http://host.docker.internal:11434/v1');
    expect(screen.getByRole('textbox', { name: /模型 ID/ })).toHaveValue('');
    expect(
      screen.getByText(/0.6B 和 1.7B 均未通过当前逐记录绑定门禁/)
    ).toBeInTheDocument();
    expect(updateSettings).not.toHaveBeenCalled();
    expect(testConnection).not.toHaveBeenCalled();
  });

  it('tests the saved synthetic mode without member data or secret fields', async () => {
    const current = buildSettings({
      selected_mode: 'test',
      effective_mode: 'test',
      available: true,
      reason_code: null,
      provider: 'dynamic_test',
    });
    getSettings.mockResolvedValue(current);
    testConnection.mockResolvedValue(buildTestResponse());

    render(
      <MantineProvider>
        <AdminHealthAiSettingsPage api={api} standalone />
      </MantineProvider>
    );

    await screen.findByRole('heading', { name: 'AI 服务' });
    expect(screen.getByText('已通过配置门禁')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: /本次操作原因/ }), {
      target: { value: '验证虚构数据链路' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '使用虚构数据动态测试当前配置' })
    );

    await waitFor(() => {
      expect(testConnection).toHaveBeenCalledWith({
        expected_revision: 3,
        reason: '验证虚构数据链路',
      });
    });
    expect(
      await screen.findByRole('heading', {
        name: '虚构数据动态测试·非模型回答',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText('空腹血糖从 5.1 变化为 5.4 mmol/L。')
    ).toBeInTheDocument();
    expect(JSON.stringify(testConnection.mock.calls)).not.toContain('api_key');
    expect(JSON.stringify(testConnection.mock.calls)).not.toContain(
      'patient_id'
    );
  });

  it('keeps a successful test result when the following status refresh fails', async () => {
    const current = buildSettings({
      selected_mode: 'test',
      effective_mode: 'test',
      available: true,
      reason_code: null,
      provider: 'dynamic_test',
    });
    getSettings
      .mockResolvedValueOnce(current)
      .mockRejectedValueOnce(new Error('refresh unavailable'));
    testConnection.mockResolvedValue(buildTestResponse());

    render(
      <MantineProvider>
        <AdminHealthAiSettingsPage api={api} standalone />
      </MantineProvider>
    );

    await screen.findByRole('heading', { name: 'AI 服务' });
    fireEvent.change(screen.getByRole('textbox', { name: /本次操作原因/ }), {
      target: { value: '验证刷新失败语义' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '使用虚构数据动态测试当前配置' })
    );

    expect(
      await screen.findByRole('heading', {
        name: '虚构数据动态测试·非模型回答',
      })
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/测试已通过，但状态刷新失败，请手动刷新/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/连接测试没有通过/)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /本次操作原因/ })).toHaveValue(
      ''
    );
  });

  it('shows a specific Chinese message when the saved revision is stale', async () => {
    getSettings.mockResolvedValue(buildSettings());
    updateSettings.mockRejectedValue(
      Object.assign(new Error('The AI configuration changed'), {
        code: 'health_ai_configuration_revision_conflict',
      })
    );

    render(
      <MantineProvider>
        <AdminHealthAiSettingsPage api={api} standalone />
      </MantineProvider>
    );

    await screen.findByRole('heading', { name: 'AI 服务' });
    fireEvent.change(screen.getByRole('combobox', { name: /运行模式/ }), {
      target: { value: 'test' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /本次操作原因/ }), {
      target: { value: '验证冲突提示' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    expect(
      await screen.findByText('配置已在其他会话中更新，请刷新状态后再重试。')
    ).toBeInTheDocument();
  });

  it('explains a disabled synthetic-test gate without exposing backend prose', async () => {
    const current = buildSettings({
      selected_mode: 'test',
      effective_mode: 'test',
      available: true,
      reason_code: null,
      provider: 'dynamic_test',
    });
    getSettings.mockResolvedValue(current);
    testConnection.mockRejectedValue(
      Object.assign(new Error('The selected AI runtime is not available'), {
        code: 'test_provider_not_allowed',
      })
    );

    render(
      <MantineProvider>
        <AdminHealthAiSettingsPage api={api} standalone />
      </MantineProvider>
    );

    await screen.findByRole('heading', { name: 'AI 服务' });
    fireEvent.change(screen.getByRole('textbox', { name: /本次操作原因/ }), {
      target: { value: '验证门禁提示' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '使用虚构数据动态测试当前配置' })
    );

    expect(
      await screen.findByText(
        /服务器尚未开启虚构数据测试门禁。 系统未读取成员数据/
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/The selected AI runtime is not available/)
    ).not.toBeInTheDocument();
  });
});
