import type {
  HealthSourceDocumentLifecycle,
  HealthSourceUploadBatch,
  HealthSourceUploadManifestItem,
  SourceDocumentUpload,
  SourceDocumentUploadOptions,
} from './healthImportApi';
import { apiService } from './index';

export interface AdminDelegatedUploadSettings {
  enabled: boolean;
  capability: 'delegated_upload';
  disclosure: string;
}

export interface AdminDelegatedUploadSubject {
  patient_id: number;
  display_name: string;
  account_id: number;
  username: string;
  account_active: boolean;
}

const capabilityParams = (reason: string) => ({
  delegated_upload: 'delegated_upload',
  delegated_upload_reason: reason.trim(),
});

class AdminDelegatedUploadApi {
  getSettings(signal?: AbortSignal): Promise<AdminDelegatedUploadSettings> {
    return apiService.get('/admin/delegated-upload/settings', {
      ...(signal ? { signal } : {}),
    });
  }

  setEnabled(
    enabled: boolean,
    reason: string
  ): Promise<AdminDelegatedUploadSettings> {
    return apiService.put('/admin/delegated-upload/settings', {
      enabled,
      reason: reason.trim(),
    });
  }

  listSubjects(
    signal?: AbortSignal
  ): Promise<{ subjects: AdminDelegatedUploadSubject[] }> {
    return apiService.get('/admin/archive-circles/eligible-subjects', {
      ...(signal ? { signal } : {}),
    });
  }

  createUploadBatch(
    patientId: number,
    input: {
      idempotency_key: string;
      document_type: string;
      report_date?: string;
      facility?: string;
      documents: HealthSourceUploadManifestItem[];
    },
    reason: string
  ): Promise<HealthSourceUploadBatch> {
    return apiService.post(
      `/health-imports/patients/${patientId}/source-upload-batches`,
      input,
      { params: capabilityParams(reason) }
    );
  }

  listUploadBatches(
    patientId: number,
    reason: string,
    signal?: AbortSignal
  ): Promise<HealthSourceUploadBatch[]> {
    return apiService.get(
      `/health-imports/patients/${patientId}/source-upload-batches`,
      {
        params: {
          ...capabilityParams(reason),
          unfinished_only: false,
          limit: 50,
        },
        signal,
      }
    );
  }

  getUploadBatch(
    batchId: number,
    reason: string,
    signal?: AbortSignal
  ): Promise<HealthSourceUploadBatch> {
    return apiService.get(`/health-imports/source-upload-batches/${batchId}`, {
      params: capabilityParams(reason),
      signal,
    });
  }

  completeUploadBatch(
    batchId: number,
    reason: string
  ): Promise<HealthSourceUploadBatch> {
    return apiService.post(
      `/health-imports/source-upload-batches/${batchId}/complete`,
      {},
      { params: capabilityParams(reason) }
    );
  }

  cancelUploadBatch(
    batchId: number,
    reason: string
  ): Promise<HealthSourceUploadBatch> {
    return apiService.post(
      `/health-imports/source-upload-batches/${batchId}/cancel`,
      {},
      { params: capabilityParams(reason) }
    );
  }

  uploadSourceDocument(
    patientId: number,
    input: SourceDocumentUpload,
    reason: string,
    options: SourceDocumentUploadOptions = {}
  ): Promise<unknown> {
    const formData = new FormData();
    formData.append('patient_id', String(patientId));
    formData.append('file', input.file);
    formData.append('document_type', input.documentType);
    formData.append('delegated_upload', 'delegated_upload');
    formData.append('delegated_upload_reason', reason.trim());
    if (input.displayName?.trim()) {
      formData.append('display_name', input.displayName.trim());
    }
    if (input.reportDate) formData.append('report_date', input.reportDate);
    if (input.facility?.trim()) {
      formData.append('facility', input.facility.trim());
    }
    if (input.allowDuplicate) formData.append('allow_duplicate', 'true');
    if (input.sourceUploadBatchId) {
      formData.append(
        'source_upload_batch_id',
        String(input.sourceUploadBatchId)
      );
    }
    if (input.sourceUploadItemId) {
      formData.append(
        'source_upload_item_id',
        String(input.sourceUploadItemId)
      );
    }
    return apiService.post('/health-imports/source-documents', formData, {
      signal: options.signal,
      onUploadProgress: options.onProgress,
    });
  }

  withdrawSourceDocument(
    sourceDocumentId: number,
    reason: string,
    withdrawalReason: string
  ): Promise<HealthSourceDocumentLifecycle> {
    return apiService.post(
      `/health-imports/source-documents/${sourceDocumentId}/withdraw`,
      { reason: withdrawalReason.trim() || null },
      { params: capabilityParams(reason) }
    );
  }
}

export const adminDelegatedUploadApi = new AdminDelegatedUploadApi();
export default adminDelegatedUploadApi;
