import { apiService } from './index';

export type HealthAlertRuleType = 'threshold' | 'overdue';
export type HealthAlertOperator = 'gt' | 'gte' | 'lt' | 'lte';

export interface HealthAlertRuleInput {
  name: string;
  rule_type: HealthAlertRuleType;
  test_name: string;
  unit?: string | null;
  operator?: HealthAlertOperator | null;
  threshold_value?: number | null;
  overdue_days?: number | null;
  enabled: boolean;
}

export interface HealthAlertRule extends HealthAlertRuleInput {
  id: number;
  patient_id: number;
  created_by_user_id: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface EvaluatedHealthAlert {
  alert_id: string;
  alert_type: 'source_status' | 'threshold' | 'overdue';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  explanation: string;
  rule_id: string;
  rule_version: number;
  rule_description: string;
  evidence: {
    component_id: number;
    lab_result_id: number;
    observed_date?: string | null;
    test_name: string;
    result_type: string;
    numeric_value?: number | null;
    qualitative_value?: string | null;
    textual_value?: string | null;
    unit?: string | null;
    status?: string | null;
    threshold_operator?: string | null;
    threshold_value?: number | null;
    overdue_days?: number | null;
    elapsed_days?: number | null;
  };
  source: {
    lab_result_id: number;
    source_document_id?: number | null;
    source_page?: number | null;
    source_locator?: string | null;
    import_batch_id?: number | null;
  };
  calculated_at: string;
  limitations: string;
  muted_until?: string | null;
}

export interface HealthAlertEvaluation {
  patient_id: number;
  calculated_at: string;
  active_count: number;
  muted_count: number;
  alerts: EvaluatedHealthAlert[];
}

class HealthAlertApi {
  listRules(
    patientId: number,
    signal?: AbortSignal
  ): Promise<HealthAlertRule[]> {
    return apiService.get(`/health-alerts/patients/${patientId}/rules`, {
      signal,
    });
  }

  createRule(
    patientId: number,
    input: HealthAlertRuleInput
  ): Promise<HealthAlertRule> {
    return apiService.post(`/health-alerts/patients/${patientId}/rules`, input);
  }

  updateRule(
    ruleId: number,
    input: HealthAlertRuleInput
  ): Promise<HealthAlertRule> {
    return apiService.put(`/health-alerts/rules/${ruleId}`, input);
  }

  evaluate(
    patientId: number,
    includeMuted = false,
    signal?: AbortSignal
  ): Promise<HealthAlertEvaluation> {
    return apiService.get(`/health-alerts/patients/${patientId}/alerts`, {
      params: { include_muted: includeMuted },
      signal,
    });
  }

  mute(patientId: number, alertId: string, mutedUntil: string) {
    return apiService.post(
      `/health-alerts/patients/${patientId}/alerts/${alertId}/mute`,
      { muted_until: mutedUntil }
    );
  }

  async unmute(patientId: number, alertId: string): Promise<void> {
    await apiService.delete(
      `/health-alerts/patients/${patientId}/alerts/${alertId}/mute`
    );
  }
}

export const healthAlertApi = new HealthAlertApi();
export default healthAlertApi;
