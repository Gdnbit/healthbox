import { apiService } from './index';

export type HealthBackgroundCategory =
  | 'general'
  | 'medical_history'
  | 'lifestyle'
  | 'family_history'
  | 'social_context'
  | 'other';
export type HealthBackgroundVerification =
  | 'needs_review'
  | 'confirmed'
  | 'questionable';

export interface HealthBackgroundContent {
  category: HealthBackgroundCategory;
  title: string;
  narrative: string;
  effective_date?: string | null;
  verification_status: HealthBackgroundVerification;
  source_document_id?: number | null;
  source_page?: number | null;
  source_locator?: string | null;
}

export interface HealthBackgroundEntry extends HealthBackgroundContent {
  id: number;
  patient_id: number;
  created_by_user_id: number;
  record_key: string;
  version_number: number;
  supersedes_entry_id?: number | null;
  status: 'active' | 'superseded' | 'voided';
  is_current: boolean;
  change_note?: string | null;
  created_at: string;
}

export interface OwnerHealthReadAccess {
  capability: 'global_read';
  reason: string;
}

export interface OwnerHealthRecordAction {
  capability: 'owner_record_revise' | 'owner_record_void';
  reason: string;
}

class HealthBackgroundApi {
  list(
    patientId: number,
    includeHistory = false,
    signal?: AbortSignal,
    ownerAccess?: OwnerHealthReadAccess
  ): Promise<HealthBackgroundEntry[]> {
    const params: Record<string, string | boolean> = {
      include_history: includeHistory,
      include_voided: includeHistory,
    };
    if (ownerAccess) {
      params.owner_access = ownerAccess.capability;
      params.owner_access_reason = ownerAccess.reason;
    }
    return apiService.get(`/health-background/patients/${patientId}`, {
      params,
      signal,
    });
  }

  create(
    patientId: number,
    input: HealthBackgroundContent & { change_note?: string | null }
  ): Promise<HealthBackgroundEntry> {
    return apiService.post(`/health-background/patients/${patientId}`, input);
  }

  revise(
    entryId: number,
    input: HealthBackgroundContent & {
      expected_version: number;
      change_note: string;
    },
    adminAction?: OwnerHealthRecordAction
  ): Promise<HealthBackgroundEntry> {
    return apiService.post(
      `/health-background/entries/${entryId}/revise`,
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
    entryId: number,
    expectedVersion: number,
    reason: string,
    adminAction?: OwnerHealthRecordAction
  ): Promise<HealthBackgroundEntry> {
    return apiService.post(
      `/health-background/entries/${entryId}/void`,
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

export const healthBackgroundApi = new HealthBackgroundApi();
export default healthBackgroundApi;
