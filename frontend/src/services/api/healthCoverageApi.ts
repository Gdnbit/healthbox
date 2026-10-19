import { apiService } from './index';
import type {
  OwnerHealthReadAccess,
  OwnerHealthRecordAction,
} from './healthBackgroundApi';

export type HealthCoverageAbsenceReason =
  | 'not-performed'
  | 'not-applicable'
  | 'unknown';
export type HealthCoverageVerification =
  | 'needs_review'
  | 'confirmed'
  | 'questionable';

export interface HealthCoverageContent {
  exam_date: string;
  metric_key: string;
  metric_name: string;
  metric_code?: string | null;
  absence_reason: HealthCoverageAbsenceReason;
  verification_status: HealthCoverageVerification;
  note?: string | null;
  source_document_id?: number | null;
  source_page?: number | null;
  source_locator?: string | null;
}

export interface HealthCoverageStatement extends HealthCoverageContent {
  id: number;
  patient_id: number;
  created_by_user_id: number;
  record_key: string;
  version_number: number;
  supersedes_statement_id?: number | null;
  absence_reason_system: string;
  status: 'active' | 'superseded' | 'voided';
  is_current: boolean;
  change_note?: string | null;
  created_at: string;
}

class HealthCoverageApi {
  list(
    patientId: number,
    includeHistory = false,
    signal?: AbortSignal,
    ownerAccess?: OwnerHealthReadAccess
  ): Promise<HealthCoverageStatement[]> {
    const params: Record<string, string | boolean> = {
      include_history: includeHistory,
      include_voided: includeHistory,
    };
    if (ownerAccess) {
      params.owner_access = ownerAccess.capability;
      params.owner_access_reason = ownerAccess.reason;
    }
    return apiService.get(`/health-coverage/patients/${patientId}`, {
      params,
      signal,
    });
  }

  create(
    patientId: number,
    input: HealthCoverageContent & { change_note?: string | null }
  ): Promise<HealthCoverageStatement> {
    return apiService.post(`/health-coverage/patients/${patientId}`, input);
  }

  revise(
    statementId: number,
    input: HealthCoverageContent & {
      expected_version: number;
      change_note: string;
    },
    adminAction?: OwnerHealthRecordAction
  ): Promise<HealthCoverageStatement> {
    return apiService.post(
      `/health-coverage/statements/${statementId}/revise`,
      input,
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

  void(
    statementId: number,
    expectedVersion: number,
    reason: string,
    adminAction?: OwnerHealthRecordAction
  ): Promise<HealthCoverageStatement> {
    return apiService.post(
      `/health-coverage/statements/${statementId}/void`,
      {
        expected_version: expectedVersion,
        reason,
      },
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
}

export const healthCoverageApi = new HealthCoverageApi();
export default healthCoverageApi;
