import { apiService } from './index';

export type HealthAiQuestionId =
  | 'recent_changes'
  | 'visit_questions'
  | 'term_or_custom'
  | 'custom'
  | 'screening_schedule';
export type HealthAiRange = '1y' | '3y' | '5y' | 'all';
export type HealthAiProcessingMode = 'off' | 'test' | 'local';

export interface HealthAiCapability {
  available: boolean;
  provider: string;
  model: string | null;
  processing_location: string;
  reason_code: string | null;
  test_mode: boolean;
  processing_mode: HealthAiProcessingMode;
  local_handoff_available: boolean;
  supported_question_ids: string[];
  screening_question_available: boolean;
}

export interface HealthAiQuestionInput {
  question_id: HealthAiQuestionId;
  question: string;
  range: HealthAiRange;
  record_ids: string[];
}

export interface HealthAiAnswerItem {
  text: string;
  citation_ids: string[];
}

export interface HealthAiCitation {
  citation_id: string;
  record_id: string;
  metric_id: string;
  label: string;
  date: string;
  value: number;
  secondary_value: number | null;
  unit: string;
  status: string | null;
  available: boolean;
}

export interface HealthAiQuestionResponse {
  status: 'answered';
  answer_id: number;
  request_id: string;
  patient_id: number;
  question_id: string;
  question: string;
  generated_at: string;
  scope: {
    range: HealthAiRange;
    record_count: number;
    metric_count: number;
    data_cutoff: string;
    includes_originals: false;
    includes_narrative_background: false;
    includes_guidance: false;
    includes_screening_state: false;
  };
  processing: {
    provider: string;
    model: string;
    processing_location: string;
    test_mode: boolean;
    processing_mode: HealthAiProcessingMode;
    template_version: string;
  };
  answer_items: HealthAiAnswerItem[];
  general_explanations: string[];
  citations: HealthAiCitation[];
  limitations: string[];
  next_steps: string[];
  disclaimer: string;
}

export interface HealthAiAnswerSummary {
  answer_id: number;
  request_id: string;
  patient_id: number;
  question_id: string;
  question: string;
  range: HealthAiRange;
  generated_at: string;
  data_cutoff: string;
  provider: string;
  model: string;
  test_mode: boolean;
  record_count: number;
}

export interface HealthAiAnswerList {
  items: HealthAiAnswerSummary[];
  total: number;
  limit: number;
  offset: number;
}

class HealthAiApi {
  getCapabilities(
    patientId: number,
    signal?: AbortSignal
  ): Promise<HealthAiCapability> {
    return apiService.get(`/health-ai/subjects/${patientId}/capabilities`, {
      signal,
    });
  }

  askQuestion(
    patientId: number,
    input: HealthAiQuestionInput,
    idempotencyKey: string
  ): Promise<HealthAiQuestionResponse> {
    return apiService.post(`/health-ai/subjects/${patientId}/questions`, input, {
      headers: {
        'Idempotency-Key': idempotencyKey,
      },
    });
  }

  listAnswers(
    patientId: number,
    options: { limit?: number; offset?: number; signal?: AbortSignal } = {}
  ): Promise<HealthAiAnswerList> {
    return apiService.get(`/health-ai/subjects/${patientId}/answers`, {
      params: {
        limit: options.limit ?? 20,
        offset: options.offset ?? 0,
      },
      signal: options.signal,
    });
  }

  getAnswer(
    patientId: number,
    answerId: number,
    signal?: AbortSignal
  ): Promise<HealthAiQuestionResponse> {
    return apiService.get(
      `/health-ai/subjects/${patientId}/answers/${answerId}`,
      { signal }
    );
  }

  deleteAnswer(
    patientId: number,
    answerId: number
  ): Promise<{ status: 'deleted'; answer_id: number }> {
    return apiService.delete(
      `/health-ai/subjects/${patientId}/answers/${answerId}`
    );
  }
}

export const healthAiApi = new HealthAiApi();
export default healthAiApi;
