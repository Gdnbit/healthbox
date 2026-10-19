import { afterEach, describe, expect, it, vi } from 'vitest';
import adminDelegatedUploadApi from '../adminDelegatedUploadApi';
import { apiService } from '../index';

describe('administrator delegated-upload API', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the capability toggle under the administrator endpoint', async () => {
    const getSpy = vi.spyOn(apiService, 'get').mockResolvedValue({
      enabled: false,
      capability: 'delegated_upload',
      disclosure: '管理员代上传默认关闭；启用和每次使用都会记录',
    });
    const putSpy = vi.spyOn(apiService, 'put').mockResolvedValue({
      enabled: true,
      capability: 'delegated_upload',
      disclosure: '管理员代上传默认关闭；启用和每次使用都会记录',
    });

    await adminDelegatedUploadApi.getSettings();
    await adminDelegatedUploadApi.setEnabled(
      true,
      '特殊情况下协助成员留存原件'
    );

    expect(getSpy).toHaveBeenCalledWith('/admin/delegated-upload/settings', {});
    expect(putSpy).toHaveBeenCalledWith('/admin/delegated-upload/settings', {
      enabled: true,
      reason: '特殊情况下协助成员留存原件',
    });
  });

  it('sends explicit capability and reason on every delegated operation', async () => {
    const getSpy = vi.spyOn(apiService, 'get').mockResolvedValue([]);
    const postSpy = vi.spyOn(apiService, 'post').mockResolvedValue({});
    const reason = '协助成员保存体检报告';
    const file = new File(['synthetic'], 'synthetic.pdf', {
      type: 'application/pdf',
    });

    await adminDelegatedUploadApi.listUploadBatches(17, reason);
    await adminDelegatedUploadApi.createUploadBatch(
      17,
      {
        idempotency_key: 'synthetic-key',
        document_type: 'checkup',
        documents: [],
      },
      reason
    );
    await adminDelegatedUploadApi.uploadSourceDocument(
      17,
      {
        file,
        documentType: 'checkup',
      },
      reason
    );
    await adminDelegatedUploadApi.withdrawSourceDocument(
      42,
      reason,
      '成员确认上传错误'
    );

    const params = {
      delegated_upload: 'delegated_upload',
      delegated_upload_reason: reason,
    };
    expect(getSpy).toHaveBeenCalledWith(
      '/health-imports/patients/17/source-upload-batches',
      {
        params: {
          ...params,
          unfinished_only: false,
          limit: 50,
        },
        signal: undefined,
      }
    );
    expect(postSpy).toHaveBeenCalledWith(
      '/health-imports/patients/17/source-upload-batches',
      {
        idempotency_key: 'synthetic-key',
        document_type: 'checkup',
        documents: [],
      },
      { params }
    );

    const uploadCall = postSpy.mock.calls[1];
    expect(uploadCall[0]).toBe('/health-imports/source-documents');
    expect(uploadCall[1]).toBeInstanceOf(FormData);
    expect((uploadCall[1] as FormData).get('patient_id')).toBe('17');
    expect((uploadCall[1] as FormData).get('delegated_upload')).toBe(
      'delegated_upload'
    );
    expect((uploadCall[1] as FormData).get('delegated_upload_reason')).toBe(
      reason
    );
    expect(postSpy).toHaveBeenNthCalledWith(
      3,
      '/health-imports/source-documents/42/withdraw',
      { reason: '成员确认上传错误' },
      { params }
    );
  });
});
