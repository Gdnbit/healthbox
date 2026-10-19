import { apiService } from './index';

export interface HealthSourceDocument {
  id: number;
  patient_id: number;
  primary_file_id?: number | null;
  display_name: string;
  original_filename: string;
  document_type: string;
  report_date?: string | null;
  facility?: string | null;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  storage_backend: string;
  status: string;
  withdrawn_at?: string | null;
  withdrawn_by_user_id?: number | null;
  withdrawal_reason?: string | null;
  withdrawal_previous_status?: string | null;
  duplicate_of_source_document_id?: number | null;
  created_at: string;
  updated_at: string;
}

export interface HealthSourceDocumentDependencies {
  source_document_id: number;
  import_batches_total: number;
  import_batches_open: number;
  import_batches_committed: number;
  formal_lab_components: number;
  health_background_entries: number;
  health_coverage_statements: number;
  duplicate_documents: number;
  has_derived_data: boolean;
}

export interface HealthSourceDocumentLifecycle {
  document: HealthSourceDocument;
  dependencies: HealthSourceDocumentDependencies;
}

export type HealthSourceSimilarityType = 'near_duplicate' | 'partial_overlap';
export type HealthSourceSimilarityReviewStatus =
  | 'pending'
  | 'confirmed'
  | 'dismissed';

export interface HealthSourceSimilarityRelation {
  id: number;
  patient_id: number;
  source_document_id: number;
  source_display_name: string;
  related_source_document_id: number;
  related_display_name: string;
  relation_type: HealthSourceSimilarityType;
  confidence: number;
  algorithm_version: string;
  evidence: {
    matched_region_ratio: number;
    source_unique_ratio: number;
    related_unique_ratio: number;
    orientation: string;
    explanation_code: string;
    band_offset?: number | null;
  };
  review_status: HealthSourceSimilarityReviewStatus;
  reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type HealthImportDecision =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'duplicate';

export interface HealthImportItem {
  id: number;
  batch_id: number;
  sequence: number;
  observed_date?: string | null;
  test_name: string;
  canonical_test_name?: string | null;
  test_code?: string | null;
  result_type: 'quantitative' | 'qualitative' | 'textual';
  numeric_value?: number | null;
  qualitative_value?: string | null;
  textual_value?: string | null;
  unit?: string | null;
  ref_range_min?: number | null;
  ref_range_max?: number | null;
  ref_range_text?: string | null;
  result_status?: string | null;
  category?: string | null;
  source_page?: number | null;
  source_locator?: string | null;
  raw_text?: string | null;
  confidence?: number | null;
  decision: HealthImportDecision;
  duplicate_of_component_id?: number | null;
  duplicate_reason?: string | null;
  duplicate_override_reason?: string | null;
  review_notes?: string | null;
  validation_issues: string[];
  created_lab_result_id?: number | null;
  created_component_id?: number | null;
}

export interface HealthImportCandidate {
  observed_date?: string | null;
  test_name: string;
  canonical_test_name?: string | null;
  test_code?: string | null;
  result_type: 'quantitative' | 'qualitative' | 'textual';
  numeric_value?: number | null;
  qualitative_value?:
    | 'positive'
    | 'negative'
    | 'detected'
    | 'undetected'
    | null;
  textual_value?: string | null;
  unit?: string | null;
  ref_range_min?: number | null;
  ref_range_max?: number | null;
  ref_range_text?: string | null;
  result_status?:
    | 'normal'
    | 'abnormal'
    | 'critical'
    | 'high'
    | 'low'
    | 'borderline'
    | null;
  category?: string | null;
  source_page?: number | null;
  source_locator?: string | null;
  raw_text?: string | null;
  confidence?: number | null;
}

export interface HealthImportBatch {
  id: number;
  patient_id: number;
  source_document_id: number;
  idempotency_key: string;
  parser_name: string;
  parser_version?: string | null;
  status: 'pending_review' | 'reviewed' | 'committed' | 'rolled_back';
  summary: {
    total: number;
    pending: number;
    accepted: number;
    rejected: number;
    duplicate: number;
    quality_issue_count: number;
  };
  items: HealthImportItem[];
  created_at: string;
  reviewed_at?: string | null;
  committed_at?: string | null;
  rolled_back_at?: string | null;
  subject_mismatch_warning?: {
    code: 'subject_mismatch_suspected';
    observed_name: string;
    confidence: number;
    assessment_version: string;
    evidence: {
      label?: string;
      extraction_method?: string;
      match_method?: string;
      candidate_count?: number;
    };
    confirmation_required: boolean;
    confirmed_at?: string | null;
  } | null;
}

export interface HealthImportCommitInput {
  subject_mismatch_confirmation?: {
    acknowledged: true;
    target_patient_id: number;
    observed_name: string;
    assessment_version: string;
  };
}

export interface HealthFormalMetricRevisionResult {
  result_type: 'quantitative' | 'qualitative' | 'textual';
  numeric_value?: number | null;
  qualitative_value?: string | null;
  textual_value?: string | null;
  unit?: string | null;
  ref_range_min?: number | null;
  ref_range_max?: number | null;
  ref_range_text?: string | null;
  result_status?: string | null;
}

export interface HealthFormalMetricRevisionRequest {
  expected_current_revision_id: number;
  idempotency_key: string;
  reason: string;
  result: HealthFormalMetricRevisionResult;
}

export interface HealthFormalMetricRevision extends HealthFormalMetricRevisionResult {
  id: number;
  component_id: number;
  patient_id: number;
  version: number;
  action: 'created' | 'revised';
  supersedes_revision_id?: number | null;
  reason?: string | null;
  created_by_user_id: number;
  created_at: string;
}

export interface HealthFormalMetricRevisionHistory {
  contract_version: 'household-formal-metric-revision@1.0.0';
  component_id: number;
  patient_id: number;
  lab_result_id: number;
  test_name: string;
  canonical_test_name?: string | null;
  test_code?: string | null;
  observed_date?: string | null;
  source_document_id?: number | null;
  source_page?: number | null;
  source_locator?: string | null;
  import_batch_id: number;
  current_revision_id: number;
  revisions: HealthFormalMetricRevision[];
}

export type HealthSourceParseTaskStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface HealthSourceParseTask {
  id: number;
  patient_id: number;
  source_document_id: number;
  created_by_user_id: number;
  import_batch_id?: number | null;
  idempotency_key: string;
  parser_name: string;
  parser_version: string;
  status: HealthSourceParseTaskStatus;
  attempt_count: number;
  summary: {
    candidate_count?: number;
    low_confidence_count?: number;
    unparsed_count?: number;
    ignored_line_count?: number;
    page_count?: number;
    character_count?: number;
    extraction_method?: string;
    extraction_confidence?: number;
    formal_write_count?: number;
  };
  error_code?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type HealthParserCapabilityStatus = 'ready' | 'partial' | 'unavailable';

export interface HealthParserCapability {
  status: HealthParserCapabilityStatus;
  reason_codes: string[];
}

export interface HealthParserReadiness {
  parser_name: string;
  parser_version: string;
  status: HealthParserCapabilityStatus;
  capabilities: Record<string, HealthParserCapability>;
  supported_ocr_languages: string[];
  reason_codes: string[];
  worker: {
    status: 'running' | 'fallback';
    poll_seconds: number;
    max_tasks_per_cycle: number;
    last_cycle_at?: string | null;
    last_cycle_processed: number;
    last_recovered_count: number;
  };
  checked_at: string;
}

export interface SourceDocumentUpload {
  file: File;
  displayName?: string;
  documentType: string;
  reportDate?: string;
  facility?: string;
  allowDuplicate?: boolean;
  sourceUploadBatchId?: number;
  sourceUploadItemId?: number;
}

export interface SourceDocumentUploadProgress {
  loaded: number;
  total: number;
  percent?: number;
}

export interface SourceDocumentUploadOptions {
  signal?: AbortSignal;
  onProgress?: (_progress: SourceDocumentUploadProgress) => void;
}

export type HealthSourceUploadItemStatus =
  | 'pending'
  | 'uploaded'
  | 'duplicate'
  | 'failed'
  | 'cancelled';

export interface HealthSourceUploadManifestItem {
  client_item_id: string;
  sequence: number;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  client_sha256?: string;
}

export interface HealthSourceUploadItem {
  id: number;
  batch_id: number;
  client_item_id: string;
  sequence: number;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  client_sha256?: string | null;
  actual_sha256?: string | null;
  status: HealthSourceUploadItemStatus;
  source_document_id?: number | null;
  duplicate_source_document_id?: number | null;
  attempt_count: number;
  last_error_code?: string | null;
  near_duplicate_candidates: HealthSourceSimilarityRelation[];
  partial_overlap_candidates: HealthSourceSimilarityRelation[];
  created_at: string;
  updated_at: string;
}

export interface HealthSourceUploadBatch {
  id: number;
  patient_id: number;
  created_by_user_id: number;
  idempotency_key: string;
  manifest_sha256: string;
  document_type: string;
  report_date?: string | null;
  facility?: string | null;
  status: 'open' | 'completed' | 'partial' | 'cancelled';
  expected_file_count: number;
  expected_total_bytes: number;
  created_at: string;
  completed_at?: string | null;
  cancelled_at?: string | null;
  updated_at: string;
  items: HealthSourceUploadItem[];
}

export interface HealthCsvPreviewError {
  row_number: number;
  field?: string | null;
  code: string;
  message: string;
}

export interface HealthCsvPreviewRow {
  row_number: number;
  candidate: HealthImportCandidate;
  validation_issues: string[];
}

export interface HealthCsvPreview {
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  skipped_blank_rows: number;
  encoding: string;
  delimiter: string;
  rows: HealthCsvPreviewRow[];
  errors: HealthCsvPreviewError[];
}

export interface OwnerSourceLifecycleAction {
  capability: 'owner_source_withdraw' | 'owner_source_restore';
  reason: string;
}

class HealthImportApi {
  listSourceDocuments(
    patientId: number,
    signal?: AbortSignal,
    includeArchived = false,
    ownerAccess?: {
      capability: 'global_read';
      reason: string;
    }
  ): Promise<HealthSourceDocument[]> {
    const params: Record<string, string | boolean> = {
      include_archived: includeArchived,
    };
    if (ownerAccess) {
      params.owner_access = ownerAccess.capability;
      params.owner_access_reason = ownerAccess.reason;
    }
    return apiService.get(
      `/health-imports/patients/${patientId}/source-documents`,
      { signal, params }
    );
  }

  downloadSourceDocument(
    sourceDocumentId: number,
    ownerAccess?: {
      capability: 'global_read';
      reason: string;
    },
    signal?: AbortSignal
  ): Promise<Blob> {
    const params: Record<string, string> = {};
    if (ownerAccess) {
      params.owner_access = ownerAccess.capability;
      params.owner_access_reason = ownerAccess.reason;
    }
    return apiService.get(
      `/health-imports/source-documents/${sourceDocumentId}/download`,
      {
        responseType: 'blob',
        signal,
        params,
      }
    );
  }

  previewSourceDocument(
    sourceDocumentId: number,
    ownerAccess?: {
      capability: 'global_read';
      reason: string;
    },
    signal?: AbortSignal
  ): Promise<Blob> {
    const params: Record<string, string> = {};
    if (ownerAccess) {
      params.owner_access = ownerAccess.capability;
      params.owner_access_reason = ownerAccess.reason;
    }
    return apiService.get(
      `/health-imports/source-documents/${sourceDocumentId}/preview`,
      {
        responseType: 'blob',
        signal,
        params,
      }
    );
  }

  thumbnailSourceDocument(
    sourceDocumentId: number,
    signal?: AbortSignal
  ): Promise<Blob> {
    return apiService.get(
      `/health-imports/source-documents/${sourceDocumentId}/thumbnail`,
      {
        responseType: 'blob',
        signal,
      }
    );
  }

  listSourceSimilarityRelations(
    patientId: number,
    signal?: AbortSignal,
    reviewStatus?: HealthSourceSimilarityReviewStatus
  ): Promise<HealthSourceSimilarityRelation[]> {
    return apiService.get(
      `/health-imports/patients/${patientId}/source-similarity-relations`,
      {
        signal,
        params: {
          review_status: reviewStatus,
          limit: 50,
        },
      }
    );
  }

  reviewSourceSimilarityRelation(
    relationId: number,
    decision: 'confirmed' | 'dismissed'
  ): Promise<HealthSourceSimilarityRelation> {
    return apiService.post(
      `/health-imports/source-similarity-relations/${relationId}/review`,
      { decision }
    );
  }

  getSourceDocumentDependencies(
    sourceDocumentId: number,
    signal?: AbortSignal,
    adminAction?: OwnerSourceLifecycleAction
  ): Promise<HealthSourceDocumentDependencies> {
    return apiService.get(
      `/health-imports/source-documents/${sourceDocumentId}/dependencies`,
      {
        signal,
        params: adminAction
          ? {
              admin_action: adminAction.capability,
              admin_action_reason: adminAction.reason,
            }
          : undefined,
      }
    );
  }

  withdrawSourceDocument(
    sourceDocumentId: number,
    reason?: string,
    adminAction?: OwnerSourceLifecycleAction
  ): Promise<HealthSourceDocumentLifecycle> {
    return apiService.post(
      `/health-imports/source-documents/${sourceDocumentId}/withdraw`,
      { reason: reason?.trim() || null },
      adminAction
        ? {
            params: {
              admin_action: adminAction.capability,
              admin_action_reason: adminAction.reason,
            },
          }
        : undefined
    );
  }

  restoreSourceDocument(
    sourceDocumentId: number,
    adminAction?: OwnerSourceLifecycleAction
  ): Promise<HealthSourceDocumentLifecycle> {
    return apiService.post(
      `/health-imports/source-documents/${sourceDocumentId}/restore`,
      {},
      adminAction
        ? {
            params: {
              admin_action: adminAction.capability,
              admin_action_reason: adminAction.reason,
            },
          }
        : undefined
    );
  }

  uploadSourceDocument(
    patientId: number,
    input: SourceDocumentUpload,
    options: SourceDocumentUploadOptions = {}
  ): Promise<HealthSourceDocument> {
    const formData = new FormData();
    formData.append('patient_id', String(patientId));
    formData.append('file', input.file);
    formData.append('document_type', input.documentType);
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

  createSourceUploadBatch(
    patientId: number,
    input: {
      idempotency_key: string;
      document_type: string;
      report_date?: string;
      facility?: string;
      documents: HealthSourceUploadManifestItem[];
    }
  ): Promise<HealthSourceUploadBatch> {
    return apiService.post(
      `/health-imports/patients/${patientId}/source-upload-batches`,
      input
    );
  }

  listSourceUploadBatches(
    patientId: number,
    signal?: AbortSignal
  ): Promise<HealthSourceUploadBatch[]> {
    return apiService.get(
      `/health-imports/patients/${patientId}/source-upload-batches`,
      {
        signal,
        params: {
          unfinished_only: true,
          limit: 20,
        },
      }
    );
  }

  getSourceUploadBatch(
    batchId: number,
    signal?: AbortSignal
  ): Promise<HealthSourceUploadBatch> {
    return apiService.get(`/health-imports/source-upload-batches/${batchId}`, {
      signal,
    });
  }

  completeSourceUploadBatch(batchId: number): Promise<HealthSourceUploadBatch> {
    return apiService.post(
      `/health-imports/source-upload-batches/${batchId}/complete`,
      {}
    );
  }

  cancelSourceUploadBatch(batchId: number): Promise<HealthSourceUploadBatch> {
    return apiService.post(
      `/health-imports/source-upload-batches/${batchId}/cancel`,
      {}
    );
  }

  listBatches(
    patientId: number,
    signal?: AbortSignal
  ): Promise<HealthImportBatch[]> {
    return apiService.get(`/health-imports/patients/${patientId}/batches`, {
      signal,
    });
  }

  listParseTasks(
    patientId: number,
    signal?: AbortSignal
  ): Promise<HealthSourceParseTask[]> {
    return apiService.get(`/health-imports/patients/${patientId}/parse-tasks`, {
      signal,
    });
  }

  getParserReadiness(
    patientId: number,
    signal?: AbortSignal
  ): Promise<HealthParserReadiness> {
    return apiService.get(
      `/health-imports/patients/${patientId}/parser-readiness`,
      { signal }
    );
  }

  startParseTask(sourceDocumentId: number): Promise<HealthSourceParseTask> {
    return apiService.post(
      `/health-imports/source-documents/${sourceDocumentId}/parse-tasks`,
      {}
    );
  }

  getParseTask(
    taskId: number,
    signal?: AbortSignal
  ): Promise<HealthSourceParseTask> {
    return apiService.get(`/health-imports/parse-tasks/${taskId}`, { signal });
  }

  cancelParseTask(taskId: number): Promise<HealthSourceParseTask> {
    return apiService.post(`/health-imports/parse-tasks/${taskId}/cancel`, {});
  }

  retryParseTask(taskId: number): Promise<HealthSourceParseTask> {
    return apiService.post(`/health-imports/parse-tasks/${taskId}/retry`, {});
  }

  previewCsv(patientId: number, file: File): Promise<HealthCsvPreview> {
    const formData = new FormData();
    formData.append('file', file);
    return apiService.post(
      `/health-imports/patients/${patientId}/csv-preview`,
      formData
    );
  }

  createBatch(
    patientId: number,
    input: {
      source_document_id: number;
      parser_name?: string;
      parser_version?: string;
      idempotency_key?: string;
      candidates: HealthImportCandidate[];
    }
  ): Promise<HealthImportBatch> {
    return apiService.post(
      `/health-imports/patients/${patientId}/batches`,
      input
    );
  }

  getBatch(batchId: number, signal?: AbortSignal): Promise<HealthImportBatch> {
    return apiService.get(`/health-imports/batches/${batchId}`, { signal });
  }

  reviewBatch(
    batchId: number,
    items: Array<{
      item_id: number;
      decision: 'accepted' | 'rejected';
      duplicate_override_reason?: string;
      review_notes?: string;
      candidate?: HealthImportCandidate;
    }>
  ): Promise<HealthImportBatch> {
    return apiService.put(`/health-imports/batches/${batchId}/review`, {
      items,
    });
  }

  commitBatch(batchId: number, input: HealthImportCommitInput = {}) {
    return apiService.post(`/health-imports/batches/${batchId}/commit`, input);
  }

  listFormalMetricRevisions(
    componentId: number,
    signal?: AbortSignal
  ): Promise<HealthFormalMetricRevisionHistory> {
    return apiService.get(
      `/health-imports/components/${componentId}/revisions`,
      { signal }
    );
  }

  reviseFormalMetric(
    componentId: number,
    input: HealthFormalMetricRevisionRequest
  ): Promise<HealthFormalMetricRevisionHistory> {
    return apiService.post(
      `/health-imports/components/${componentId}/revisions`,
      input
    );
  }

  rollbackBatch(batchId: number) {
    return apiService.post(`/health-imports/batches/${batchId}/rollback`, {});
  }
}

export const healthImportApi = new HealthImportApi();
export default healthImportApi;
