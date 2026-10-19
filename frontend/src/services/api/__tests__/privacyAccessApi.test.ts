import { describe, expect, it, vi } from 'vitest';
import { apiService } from '../index';
import privacyAccessApi from '../privacyAccessApi';

describe('privacyAccessApi', () => {
  it('loads only the current account privacy access record', async () => {
    const getSpy = vi.spyOn(apiService, 'get').mockResolvedValue({
      subject: { display_name: '虚构成员' },
      visibility: {
        administrator: {
          label: '系统管理员',
          can_read_all_server_data: true,
        },
        reciprocal_viewers: [],
        not_shared_by_default: [],
      },
      events: [],
      total: 0,
      offset: 0,
      limit: 20,
      generated_at: '2026-07-28T00:00:00Z',
      history_notice: '仅显示现有审计记录。',
    });

    await privacyAccessApi.getMine({ limit: 20, offset: 0 });

    expect(getSpy).toHaveBeenCalledWith(
      '/privacy-access/me?limit=20&offset=0',
      { signal: undefined }
    );
  });
});
