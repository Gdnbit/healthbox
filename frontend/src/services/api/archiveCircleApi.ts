import { apiService } from './index';
import type { HouseholdHealthTrendRange } from '../../features/householdHealth/householdHealthTrend';

export type ArchiveSubjectScope = 'owner' | 'structured_dashboard';
export type ArchiveCircleStatus = 'active' | 'paused' | 'archived';
export type ArchiveCircleMembershipStatus = 'active' | 'paused' | 'removed';

export interface ArchiveSubject {
  patient_id: number;
  display_name: string;
  scope: ArchiveSubjectScope;
  available: boolean;
  relationship_changed_at: string | null;
}

export interface ArchiveSubjectList {
  subjects: ArchiveSubject[];
  scope_notice: string;
}

export interface StructuredDashboardPoint {
  id: string;
  date: string;
  value: number;
  secondary_value: number | null;
  status: string | null;
  reference_min: number | null;
  reference_max: number | null;
  reference_text: string | null;
}

export interface StructuredDashboardMetric {
  id: string;
  kind: 'vital' | 'lab';
  label: string;
  unit: string;
  points: StructuredDashboardPoint[];
  latest_status: string | null;
}

export interface StructuredDashboard {
  subject: ArchiveSubject;
  metrics: StructuredDashboardMetric[];
  loaded_at: string;
}

export interface ArchiveDashboardPreferencesInput {
  pinned_metric_ids: string[];
  ranges_by_metric_id: Record<string, HouseholdHealthTrendRange>;
}

export interface ArchiveDashboardPreferences extends ArchiveDashboardPreferencesInput {
  patient_id: number;
  updated_at: string | null;
}

export interface ArchiveCircleMember {
  patient_id: number;
  display_name: string;
  account_id: number;
  username: string;
  account_active: boolean;
  status: ArchiveCircleMembershipStatus;
  scope: 'structured_dashboard';
  joined_at: string;
  paused_at: string | null;
  removed_at: string | null;
  updated_at: string;
}

export interface ArchiveCircle {
  id: number;
  name: string;
  description: string | null;
  status: ArchiveCircleStatus;
  created_at: string;
  updated_at: string;
  members: ArchiveCircleMember[];
}

export interface ArchiveAdminSubject {
  patient_id: number;
  display_name: string;
  account_id: number;
  username: string;
  account_active: boolean;
}

export interface ArchiveCircleMutation {
  status: 'ok';
  circle_id: number;
  patient_id: number | null;
}

class ArchiveCircleApi {
  listSubjects(signal?: AbortSignal): Promise<ArchiveSubjectList> {
    return apiService.get('/archive-access/subjects', { signal });
  }

  getDashboard(
    patientId: number,
    signal?: AbortSignal
  ): Promise<StructuredDashboard> {
    return apiService.get(`/archive-access/subjects/${patientId}/dashboard`, {
      signal,
    });
  }

  getDashboardPreferences(
    patientId: number,
    signal?: AbortSignal
  ): Promise<ArchiveDashboardPreferences> {
    return apiService.get(
      `/archive-access/subjects/${patientId}/dashboard-preferences`,
      { signal }
    );
  }

  updateDashboardPreferences(
    patientId: number,
    input: ArchiveDashboardPreferencesInput
  ): Promise<ArchiveDashboardPreferences> {
    return apiService.put(
      `/archive-access/subjects/${patientId}/dashboard-preferences`,
      input
    );
  }

  listCircles(signal?: AbortSignal): Promise<{ circles: ArchiveCircle[] }> {
    return apiService.get('/admin/archive-circles', { signal });
  }

  getCircle(circleId: number, signal?: AbortSignal): Promise<ArchiveCircle> {
    return apiService.get(`/admin/archive-circles/${circleId}`, { signal });
  }

  listAdminSubjects(
    signal?: AbortSignal
  ): Promise<{ subjects: ArchiveAdminSubject[] }> {
    return apiService.get('/admin/archive-circles/eligible-subjects', {
      signal,
    });
  }

  createCircle(
    name: string,
    description?: string | null
  ): Promise<ArchiveCircleMutation> {
    return apiService.post('/admin/archive-circles', {
      name,
      description: description || null,
    });
  }

  setCircleStatus(
    circleId: number,
    status: ArchiveCircleStatus
  ): Promise<ArchiveCircleMutation> {
    return apiService.patch(`/admin/archive-circles/${circleId}`, { status });
  }

  addMember(
    circleId: number,
    patientId: number
  ): Promise<ArchiveCircleMutation> {
    return apiService.post(`/admin/archive-circles/${circleId}/members`, {
      patient_id: patientId,
    });
  }

  setMembershipStatus(
    circleId: number,
    patientId: number,
    status: Extract<ArchiveCircleMembershipStatus, 'active' | 'paused'>
  ): Promise<ArchiveCircleMutation> {
    return apiService.patch(
      `/admin/archive-circles/${circleId}/members/${patientId}`,
      { status }
    );
  }

  removeMember(
    circleId: number,
    patientId: number
  ): Promise<ArchiveCircleMutation> {
    return apiService.delete(
      `/admin/archive-circles/${circleId}/members/${patientId}`
    );
  }

  moveMember(
    patientId: number,
    sourceCircleId: number,
    targetCircleId: number
  ): Promise<ArchiveCircleMutation> {
    return apiService.post('/admin/archive-circles/move-member', {
      patient_id: patientId,
      source_circle_id: sourceCircleId,
      target_circle_id: targetCircleId,
    });
  }
}

export const archiveCircleApi = new ArchiveCircleApi();
export default archiveCircleApi;
