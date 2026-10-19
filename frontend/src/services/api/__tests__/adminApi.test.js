// Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import adminApiService from '../adminApi';
import BaseApiService from '../baseApi';

describe('adminApiService.getModelRecords', () => {
  let getSpy;

  beforeEach(() => {
    getSpy = vi.spyOn(BaseApiService.prototype, 'get').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      per_page: 25,
      total_pages: 0,
    });
  });

  afterEach(() => {
    getSpy.mockRestore();
  });

  it('forwards page, per_page, and search inside an options.params object', async () => {
    await adminApiService.getModelRecords('user', {
      page: 2,
      per_page: 50,
      search: 'foo',
    });

    expect(getSpy).toHaveBeenCalledWith('/models/user/', {
      params: { page: 2, per_page: 50, search: 'foo' },
    });
  });

  it('omits search from params when it is falsy', async () => {
    await adminApiService.getModelRecords('medication', {
      page: 1,
      per_page: 25,
      search: null,
    });

    expect(getSpy).toHaveBeenCalledWith('/models/medication/', {
      params: { page: 1, per_page: 25 },
    });
  });

  it('uses defaults (page=1, per_page=25, no search) when no params are provided', async () => {
    await adminApiService.getModelRecords('user');

    expect(getSpy).toHaveBeenCalledWith('/models/user/', {
      params: { page: 1, per_page: 25 },
    });
  });
});

describe('adminApiService owner operations', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the dedicated member-access reset endpoint', async () => {
    const postSpy = vi
      .spyOn(BaseApiService.prototype, 'post')
      .mockResolvedValue({ result: 'issued' });
    const input = {
      confirm_username: 'member_one',
      reason: '成员忘记密码',
    };

    await adminApiService.resetMemberAccess(7, input);

    expect(postSpy).toHaveBeenCalledWith(
      '/user-management/users/7/reset-access',
      input
    );
  });

  it('loads the minimal sole-owner subject directory', async () => {
    const getSpy = vi
      .spyOn(BaseApiService.prototype, 'get')
      .mockResolvedValue({ subjects: [] });

    await adminApiService.getOwnerSubjects();

    expect(getSpy).toHaveBeenCalledWith('/owner-access/subjects');
  });

  it('requests an explicit value-free owner dashboard handoff authorization', async () => {
    const getSpy = vi
      .spyOn(BaseApiService.prototype, 'get')
      .mockResolvedValue({ status: 'authorized' });

    await adminApiService.authorizeOwnerDashboardHandoff(22, {
      capability: 'global_read',
      reason: '导出家庭健康面板摘要',
      handoffKind: 'csv',
      scope: 'recent-five-years',
      includeReports: true,
      metricCount: 2,
      reportCount: 1,
    });

    expect(getSpy).toHaveBeenCalledWith(
      '/owner-access/patients/22/dashboard-handoff',
      {
        params: {
          owner_access: 'global_read',
          owner_access_reason: '导出家庭健康面板摘要',
          handoff_kind: 'csv',
          scope: 'recent-five-years',
          include_reports: true,
          metric_count: 2,
          report_count: 1,
        },
      }
    );
  });
});
