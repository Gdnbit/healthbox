import { afterEach, describe, expect, it, vi } from 'vitest';
import healthImportApi from '../healthImportApi';
import { apiService } from '../index';
import { labTestComponentApi } from '../labTestComponentApi';

describe('owner global-read API parameters', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds explicit owner access to source-document metadata reads', async () => {
    const getSpy = vi.spyOn(apiService, 'get').mockResolvedValue([]);
    const signal = new AbortController().signal;

    await healthImportApi.listSourceDocuments(22, signal, false, {
      capability: 'global_read',
      reason: '查看家庭健康档案',
    });

    expect(getSpy).toHaveBeenCalledWith(
      '/health-imports/patients/22/source-documents',
      {
        signal,
        params: {
          include_archived: false,
          owner_access: 'global_read',
          owner_access_reason: '查看家庭健康档案',
        },
      }
    );
  });

  it('downloads a retained original as a blob with explicit owner access', async () => {
    const blob = new Blob(['synthetic report'], { type: 'application/pdf' });
    const getSpy = vi.spyOn(apiService, 'get').mockResolvedValue(blob);
    const signal = new AbortController().signal;

    await healthImportApi.downloadSourceDocument(
      41,
      {
        capability: 'global_read',
        reason: '下载家庭报告原件',
      },
      signal
    );

    expect(getSpy).toHaveBeenCalledWith(
      '/health-imports/source-documents/41/download',
      {
        responseType: 'blob',
        signal,
        params: {
          owner_access: 'global_read',
          owner_access_reason: '下载家庭报告原件',
        },
      }
    );
  });

  it('previews a retained original as a blob with explicit owner access', async () => {
    const blob = new Blob(['synthetic report'], { type: 'application/pdf' });
    const getSpy = vi.spyOn(apiService, 'get').mockResolvedValue(blob);
    const signal = new AbortController().signal;

    await healthImportApi.previewSourceDocument(
      41,
      {
        capability: 'global_read',
        reason: '预览家庭报告原件',
      },
      signal
    );

    expect(getSpy).toHaveBeenCalledWith(
      '/health-imports/source-documents/41/preview',
      {
        responseType: 'blob',
        signal,
        params: {
          owner_access: 'global_read',
          owner_access_reason: '预览家庭报告原件',
        },
      }
    );
  });

  it('adds explicit owner access to lab catalog and trend reads', async () => {
    const getSpy = vi
      .spyOn(apiService, 'get')
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({ data_points: [] });

    await labTestComponentApi.getComponentCatalog(22, {
      limit: 100,
      ownerAccess: 'global_read',
      ownerAccessReason: '查看家庭健康档案',
    });
    await labTestComponentApi.getTrendsByPatientAndTest(22, '血糖', {
      limit: 100,
      ownerAccess: 'global_read',
      ownerAccessReason: '查看家庭健康档案',
    });

    expect(getSpy).toHaveBeenNthCalledWith(
      1,
      '/lab-test-components/patient/22/component-catalog',
      {
        params: {
          limit: 100,
          owner_access: 'global_read',
          owner_access_reason: '查看家庭健康档案',
        },
        signal: undefined,
      }
    );
    expect(getSpy).toHaveBeenNthCalledWith(
      2,
      '/lab-test-components/patient/22/trends',
      {
        params: {
          limit: 100,
          owner_access: 'global_read',
          owner_access_reason: '查看家庭健康档案',
          test_name: '血糖',
        },
        signal: undefined,
      }
    );
  });
});
