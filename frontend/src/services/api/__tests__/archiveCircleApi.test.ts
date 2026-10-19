import { afterEach, describe, expect, it, vi } from 'vitest';
import archiveCircleApi from '../archiveCircleApi';
import { apiService } from '../index';

describe('archive circle API', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the sanitized ordinary-member endpoints', async () => {
    const getSpy = vi.spyOn(apiService, 'get').mockResolvedValue({
      subjects: [],
      scope_notice: '共享档案仅包含结构化指标与趋势',
    });
    const putSpy = vi.spyOn(apiService, 'put').mockResolvedValue({
      patient_id: 17,
      pinned_metric_ids: ['vital:blood_pressure'],
      ranges_by_metric_id: { 'vital:blood_pressure': '2y' },
      updated_at: '2026-07-28T03:00:00Z',
    });
    const signal = new AbortController().signal;

    await archiveCircleApi.listSubjects(signal);
    await archiveCircleApi.getDashboard(17, signal);
    await archiveCircleApi.getDashboardPreferences(17, signal);
    await archiveCircleApi.updateDashboardPreferences(17, {
      pinned_metric_ids: ['vital:blood_pressure'],
      ranges_by_metric_id: { 'vital:blood_pressure': '2y' },
    });

    expect(getSpy).toHaveBeenNthCalledWith(1, '/archive-access/subjects', {
      signal,
    });
    expect(getSpy).toHaveBeenNthCalledWith(
      2,
      '/archive-access/subjects/17/dashboard',
      { signal }
    );
    expect(getSpy).toHaveBeenNthCalledWith(
      3,
      '/archive-access/subjects/17/dashboard-preferences',
      { signal }
    );
    expect(putSpy).toHaveBeenCalledWith(
      '/archive-access/subjects/17/dashboard-preferences',
      {
        pinned_metric_ids: ['vital:blood_pressure'],
        ranges_by_metric_id: { 'vital:blood_pressure': '2y' },
      }
    );
  });

  it('keeps hidden group mutations under administrator endpoints', async () => {
    const postSpy = vi.spyOn(apiService, 'post').mockResolvedValue({
      status: 'ok',
      circle_id: 3,
      patient_id: 17,
    });
    const patchSpy = vi.spyOn(apiService, 'patch').mockResolvedValue({
      status: 'ok',
      circle_id: 3,
      patient_id: 17,
    });
    const deleteSpy = vi.spyOn(apiService, 'delete').mockResolvedValue({
      status: 'ok',
      circle_id: 3,
      patient_id: 17,
    });

    await archiveCircleApi.addMember(3, 17);
    await archiveCircleApi.setMembershipStatus(3, 17, 'paused');
    await archiveCircleApi.moveMember(17, 3, 4);
    await archiveCircleApi.removeMember(4, 17);

    expect(postSpy).toHaveBeenNthCalledWith(
      1,
      '/admin/archive-circles/3/members',
      { patient_id: 17 }
    );
    expect(patchSpy).toHaveBeenCalledWith(
      '/admin/archive-circles/3/members/17',
      { status: 'paused' }
    );
    expect(postSpy).toHaveBeenNthCalledWith(
      2,
      '/admin/archive-circles/move-member',
      {
        patient_id: 17,
        source_circle_id: 3,
        target_circle_id: 4,
      }
    );
    expect(deleteSpy).toHaveBeenCalledWith(
      '/admin/archive-circles/4/members/17'
    );
  });
});
