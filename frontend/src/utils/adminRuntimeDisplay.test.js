import { describe, expect, test } from 'vitest';
import {
  formatAdminActivity,
  formatSystemStatus,
  formatSystemUptime,
} from './adminRuntimeDisplay';

describe('admin runtime display localization', () => {
  test('localizes backend status and uptime values', () => {
    expect(formatSystemStatus('healthy', 'zh')).toBe('健康');
    expect(formatSystemUptime('1 minutes', 'zh-CN')).toBe('1 分钟');
    expect(formatSystemUptime('5 days', 'zh')).toBe('5 天');
  });

  test('localizes current household audit descriptions and badges', () => {
    expect(
      formatAdminActivity(
        {
          description: 'Versioned household privacy notice decision recorded',
          model_name: 'User',
          action: 'updated',
        },
        'zh'
      )
    ).toEqual({
      description: '已记录家庭健康档案隐私说明决定',
      modelName: '用户',
      action: '更新',
    });
    expect(
      formatAdminActivity(
        {
          description: 'User logged in: 123',
          model_name: 'User',
          action: 'login',
        },
        'zh-CN'
      ).description
    ).toBe('用户登录：123');
    expect(
      formatAdminActivity(
        {
          description: 'Password changed for user: 123',
          model_name: 'User',
          action: 'updated',
        },
        'zh'
      ).description
    ).toBe('用户密码已修改：123');
  });

  test('preserves unknown backend values instead of hiding them', () => {
    expect(formatSystemStatus('custom-state', 'zh')).toBe('custom-state');
    expect(formatSystemUptime('since restart', 'zh')).toBe('since restart');
    expect(
      formatAdminActivity(
        {
          description: 'Custom event',
          model_name: 'CustomModel',
          action: 'custom',
        },
        'zh'
      )
    ).toEqual({
      description: 'Custom event',
      modelName: 'CustomModel',
      action: 'custom',
    });
  });

  test('leaves backend values unchanged outside the Chinese-first interface', () => {
    expect(formatSystemStatus('healthy', 'en')).toBe('healthy');
    expect(formatSystemUptime('5 days', 'en')).toBe('5 days');
  });
});
