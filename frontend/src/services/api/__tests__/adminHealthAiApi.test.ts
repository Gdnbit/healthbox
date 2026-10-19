import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiService } from '../index';
import adminHealthAiApi from '../adminHealthAiApi';

vi.mock('../index', () => ({
  apiService: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
  },
}));

describe('adminHealthAiApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the sole-admin non-secret configuration', async () => {
    vi.mocked(apiService.get).mockResolvedValue({ selected_mode: 'off' });

    await adminHealthAiApi.getSettings();

    expect(apiService.get).toHaveBeenCalledWith(
      '/admin/health-ai/settings',
      {}
    );
  });

  it('updates mode by revision without accepting an API key field', async () => {
    vi.mocked(apiService.put).mockResolvedValue({ selected_mode: 'local' });

    await adminHealthAiApi.updateSettings({
      expected_revision: 4,
      mode: 'local',
      base_url: 'http://127.0.0.1:11434/v1',
      model: 'small-local-model',
      reason: '  切换轻量模型  ',
    });

    expect(apiService.put).toHaveBeenCalledWith('/admin/health-ai/settings', {
      expected_revision: 4,
      mode: 'local',
      base_url: 'http://127.0.0.1:11434/v1',
      model: 'small-local-model',
      reason: '切换轻量模型',
    });
    expect(JSON.stringify(vi.mocked(apiService.put).mock.calls)).not.toContain(
      'api_key'
    );
  });

  it('runs a synthetic connection test by revision and reason only', async () => {
    vi.mocked(apiService.post).mockResolvedValue({
      settings: { selected_mode: 'test' },
      output: { status: 'answered' },
    });

    await adminHealthAiApi.testConnection({
      expected_revision: 5,
      reason: '  验证虚构数据链路  ',
    });

    expect(apiService.post).toHaveBeenCalledWith(
      '/admin/health-ai/test-connection',
      {
        expected_revision: 5,
        reason: '验证虚构数据链路',
      }
    );
  });
});
