/* eslint-disable i18next/no-literal-string -- development-only synthetic visual fixture */
import type { HealthSourceUploadBatch } from '../../services/api/healthImportApi';
import adminDelegatedUploadApi from '../../services/api/adminDelegatedUploadApi';
import AdminDelegatedUpload from '../admin/AdminDelegatedUpload';

const syntheticBatch: HealthSourceUploadBatch = {
  id: 20260727,
  patient_id: 17,
  created_by_user_id: 1,
  idempotency_key: 'synthetic-browser-review',
  manifest_sha256: 'synthetic',
  document_type: 'checkup',
  report_date: '2026-07-20',
  facility: '示例体检中心',
  status: 'completed',
  expected_file_count: 2,
  expected_total_bytes: 2400000,
  created_at: '2026-07-27T10:00:00Z',
  completed_at: '2026-07-27T10:02:00Z',
  updated_at: '2026-07-27T10:02:00Z',
  items: [
    {
      id: 1,
      batch_id: 20260727,
      client_item_id: 'synthetic-1',
      sequence: 1,
      original_filename: '年度体检报告-第1页.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 1200000,
      status: 'uploaded',
      source_document_id: 301,
      near_duplicate_candidates: [],
      partial_overlap_candidates: [],
      attempt_count: 1,
      created_at: '2026-07-27T10:00:00Z',
      updated_at: '2026-07-27T10:01:00Z',
    },
    {
      id: 2,
      batch_id: 20260727,
      client_item_id: 'synthetic-2',
      sequence: 2,
      original_filename: '年度体检报告-第2页.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 1200000,
      status: 'duplicate',
      duplicate_source_document_id: 288,
      near_duplicate_candidates: [],
      partial_overlap_candidates: [],
      attempt_count: 1,
      created_at: '2026-07-27T10:00:00Z',
      updated_at: '2026-07-27T10:01:30Z',
    },
  ],
};

let enabled = false;

const prototypeApi: typeof adminDelegatedUploadApi = {
  getSettings: async () => ({
    enabled,
    capability: 'delegated_upload',
    disclosure: '管理员代上传默认关闭；启用和每次使用都会记录',
  }),
  setEnabled: async nextEnabled => {
    enabled = nextEnabled;
    return {
      enabled,
      capability: 'delegated_upload',
      disclosure: '管理员代上传默认关闭；启用和每次使用都会记录',
    };
  },
  listSubjects: async () => ({
    subjects: [
      {
        patient_id: 17,
        display_name: '成员甲',
        account_id: 27,
        username: 'member-a',
        account_active: true,
      },
      {
        patient_id: 18,
        display_name: '成员乙',
        account_id: 28,
        username: 'member-b',
        account_active: true,
      },
    ],
  }),
  createUploadBatch: async () => syntheticBatch,
  listUploadBatches: async patientId =>
    patientId === syntheticBatch.patient_id ? [syntheticBatch] : [],
  getUploadBatch: async () => syntheticBatch,
  completeUploadBatch: async () => syntheticBatch,
  cancelUploadBatch: async () => ({
    ...syntheticBatch,
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
  }),
  uploadSourceDocument: async () => ({}),
  withdrawSourceDocument: async sourceDocumentId => ({
    document: {
      id: sourceDocumentId,
      patient_id: syntheticBatch.patient_id,
      display_name: '年度体检报告',
      original_filename: '年度体检报告-第1页.jpg',
      document_type: 'checkup',
      mime_type: 'image/jpeg',
      size_bytes: 1200000,
      sha256: 'synthetic',
      storage_backend: 'local',
      status: 'archived',
      created_at: '2026-07-27T10:00:00Z',
      updated_at: '2026-07-27T10:03:00Z',
    },
    dependencies: {
      source_document_id: sourceDocumentId,
      import_batches_total: 0,
      import_batches_open: 0,
      import_batches_committed: 0,
      formal_lab_components: 0,
      health_background_entries: 0,
      health_coverage_statements: 0,
      duplicate_documents: 0,
      has_derived_data: false,
    },
  }),
};

const AdminDelegatedUploadPrototype = () => (
  <main className="admin-delegated-upload-prototype">
    <AdminDelegatedUpload api={prototypeApi} standalone />
  </main>
);

export default AdminDelegatedUploadPrototype;
