import { apiService } from './index';

export type AdminHealthAiMode = 'off' | 'test' | 'local';

export interface AdminHealthAiSettings {
  selected_mode: AdminHealthAiMode;
  effective_mode: AdminHealthAiMode;
  available: boolean;
  reason_code: string | null;
  configuration_revision: number;
  verified_revision: number;
  last_tested_at: string | null;
  connection_test_required: boolean;
  base_url: string;
  model: string;
  provider: string;
  api_key_configured: boolean;
  local_runtime_allowed: boolean;
  test_provider_allowed: boolean;
  instance_data_class: string;
  processing_location: string;
  disclosure: string;
}

export interface AdminHealthAiSettingsUpdate {
  expected_revision: number;
  mode: AdminHealthAiMode;
  base_url: string;
  model: string;
  reason: string;
}

export interface AdminHealthAiTestRequest {
  expected_revision: number;
  reason: string;
}

export interface AdminHealthAiTestOutput {
  answer_items: Array<{
    text: string;
    citation_ids: string[];
  }>;
  general_explanations: string[];
  limitations: string[];
  next_steps: string[];
}

export interface AdminHealthAiTestResponse {
  status: 'passed';
  configuration_revision: number;
  verified_revision: number;
  tested_at: string;
  provider: string;
  model: string;
  processing_mode: Exclude<AdminHealthAiMode, 'off'>;
  test_mode: boolean;
  processing_location: string;
  disclosure: string;
  output: AdminHealthAiTestOutput;
}

class AdminHealthAiApi {
  getSettings(signal?: AbortSignal): Promise<AdminHealthAiSettings> {
    return apiService.get('/admin/health-ai/settings', {
      ...(signal ? { signal } : {}),
    });
  }

  updateSettings(
    input: AdminHealthAiSettingsUpdate
  ): Promise<AdminHealthAiSettings> {
    return apiService.put('/admin/health-ai/settings', {
      ...input,
      reason: input.reason.trim(),
    });
  }

  testConnection(
    input: AdminHealthAiTestRequest
  ): Promise<AdminHealthAiTestResponse> {
    return apiService.post('/admin/health-ai/test-connection', {
      ...input,
      reason: input.reason.trim(),
    });
  }
}

export const adminHealthAiApi = new AdminHealthAiApi();
export default adminHealthAiApi;
