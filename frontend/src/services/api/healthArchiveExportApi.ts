import { apiClient } from '../apiClient';

interface ArchiveApiResponse {
  data: unknown;
  headers: Headers;
}

interface ArchiveApiClient {
  get(
    _url: string,
    _config?: Record<string, unknown>
  ): Promise<ArchiveApiResponse>;
  post(
    _url: string,
    _data?: unknown,
    _config?: Record<string, unknown>
  ): Promise<ArchiveApiResponse>;
}

// apiClient is implemented in JavaScript and its default `data = null`
// parameter is inferred too narrowly when consumed from TypeScript.
const archiveApiClient = apiClient as unknown as ArchiveApiClient;

export type HealthArchiveExportStatus =
  | 'queued'
  | 'running'
  | 'ready'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface HealthArchiveExport {
  id: number;
  patient_id: number;
  schema_version: string;
  status: HealthArchiveExportStatus;
  attempt_count: number;
  archive_filename: string;
  archive_size_bytes?: number | null;
  archive_sha256?: string | null;
  original_count: number;
  manifest_summary: {
    schema_version?: string;
    required_entry_count?: number;
    original_count?: number;
    structured_section_count?: number;
    structured_record_count?: number;
    zip_crc_verified?: boolean;
  };
  error_code?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  expires_at?: string | null;
  cancelled_at?: string | null;
  downloaded_at?: string | null;
  created_at: string;
  updated_at: string;
  can_download: boolean;
}

export interface HealthArchiveExportList {
  items: HealthArchiveExport[];
  total: number;
}

const filenameFromDisposition = (
  disposition: string | null,
  fallback: string
): string => {
  if (!disposition) return fallback;
  const encoded = disposition.match(/filename\*=utf-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return fallback;
    }
  }
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1]?.trim();
  return plain || fallback;
};

const healthArchiveExportApi = {
  async create(
    patientId: number,
    idempotencyKey: string
  ): Promise<HealthArchiveExport> {
    const response = await archiveApiClient.post('/export/archives', {
      patient_id: patientId,
      idempotency_key: idempotencyKey,
    });
    return response.data as HealthArchiveExport;
  },

  async list(patientId: number, limit = 10): Promise<HealthArchiveExportList> {
    const response = await archiveApiClient.get('/export/archives', {
      params: { patient_id: patientId, limit },
    });
    return response.data as HealthArchiveExportList;
  },

  async get(exportId: number): Promise<HealthArchiveExport> {
    const response = await archiveApiClient.get(`/export/archives/${exportId}`);
    return response.data as HealthArchiveExport;
  },

  async cancel(exportId: number): Promise<HealthArchiveExport> {
    const response = await archiveApiClient.post(
      `/export/archives/${exportId}/cancel`
    );
    return response.data as HealthArchiveExport;
  },

  async download(exportId: number): Promise<{ blob: Blob; filename: string }> {
    const response = await archiveApiClient.get(
      `/export/archives/${exportId}/download`,
      { responseType: 'blob' }
    );
    const fallback = `family-health-archive-${exportId}.zip`;
    return {
      blob: response.data as Blob,
      filename: filenameFromDisposition(
        response.headers.get('content-disposition'),
        fallback
      ),
    };
  },
};

export default healthArchiveExportApi;
