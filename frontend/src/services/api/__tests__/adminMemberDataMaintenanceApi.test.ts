import { afterEach, describe, expect, it, vi } from 'vitest';
import healthBackgroundApi from '../healthBackgroundApi';
import healthCoverageApi from '../healthCoverageApi';
import healthImportApi from '../healthImportApi';
import { apiService } from '../index';

describe('administrator member-data maintenance API context', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps disclosed global read separate from explicit revision capabilities', async () => {
    const getSpy = vi.spyOn(apiService, 'get').mockResolvedValue([]);
    const postSpy = vi.spyOn(apiService, 'post').mockResolvedValue({});
    const readAccess = {
      capability: 'global_read' as const,
      reason: '维护前查看成员资料',
    };

    await healthBackgroundApi.list(17, true, undefined, readAccess);
    await healthCoverageApi.list(17, false, undefined, readAccess);
    await healthBackgroundApi.revise(
      31,
      {
        category: 'general',
        title: 'Synthetic',
        narrative: 'Synthetic revision',
        verification_status: 'confirmed',
        expected_version: 1,
        change_note: '成员确认需要修订',
      },
      {
        capability: 'owner_record_revise',
        reason: '成员确认需要修订',
      }
    );

    expect(getSpy).toHaveBeenNthCalledWith(
      1,
      '/health-background/patients/17',
      {
        params: {
          include_history: true,
          include_voided: true,
          owner_access: 'global_read',
          owner_access_reason: '维护前查看成员资料',
        },
        signal: undefined,
      }
    );
    expect(getSpy).toHaveBeenNthCalledWith(2, '/health-coverage/patients/17', {
      params: {
        include_history: false,
        include_voided: false,
        owner_access: 'global_read',
        owner_access_reason: '维护前查看成员资料',
      },
      signal: undefined,
    });
    expect(postSpy).toHaveBeenCalledWith(
      '/health-background/entries/31/revise',
      expect.objectContaining({
        expected_version: 1,
        change_note: '成员确认需要修订',
      }),
      {
        params: {
          admin_action: 'owner_record_revise',
          admin_action_reason: '成员确认需要修订',
        },
      }
    );
  });

  it('sends operation-specific source capabilities for inspect and mutation', async () => {
    const getSpy = vi.spyOn(apiService, 'get').mockResolvedValue({});
    const postSpy = vi.spyOn(apiService, 'post').mockResolvedValue({});
    const action = {
      capability: 'owner_source_withdraw' as const,
      reason: '成员确认原件上传错误',
    };

    await healthImportApi.getSourceDocumentDependencies(51, undefined, action);
    await healthImportApi.withdrawSourceDocument(
      51,
      '成员确认原件上传错误',
      action
    );

    const params = {
      admin_action: 'owner_source_withdraw',
      admin_action_reason: '成员确认原件上传错误',
    };
    expect(getSpy).toHaveBeenCalledWith(
      '/health-imports/source-documents/51/dependencies',
      { signal: undefined, params }
    );
    expect(postSpy).toHaveBeenCalledWith(
      '/health-imports/source-documents/51/withdraw',
      { reason: '成员确认原件上传错误' },
      { params }
    );
  });
});
