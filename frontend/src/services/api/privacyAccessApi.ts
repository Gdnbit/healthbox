import { apiService } from './index';

export type PrivacyAccessActorKind =
  | 'self'
  | 'member'
  | 'administrator'
  | 'system';

export interface PrivacyAccessViewer {
  display_name: string;
  scope: 'structured_dashboard';
  scope_label: string;
}

export interface PrivacyAccessEvent {
  actor: {
    kind: PrivacyAccessActorKind;
    label: string;
  };
  action: string;
  action_label: string;
  resource: {
    kind: string;
    label: string;
  };
  authorization: {
    basis: string;
    label: string;
  };
  result: string;
  occurred_at: string;
}

export interface PrivacyAccessRecord {
  subject: {
    display_name: string;
  };
  visibility: {
    administrator: {
      label: string;
      can_read_all_server_data: boolean;
    };
    reciprocal_viewers: PrivacyAccessViewer[];
    not_shared_by_default: string[];
  };
  events: PrivacyAccessEvent[];
  total: number;
  offset: number;
  limit: number;
  generated_at: string;
  history_notice: string;
}

interface PrivacyAccessQuery {
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

class PrivacyAccessApi {
  getMine({
    limit = 20,
    offset = 0,
    signal,
  }: PrivacyAccessQuery = {}): Promise<PrivacyAccessRecord> {
    return apiService.get(
      `/privacy-access/me?limit=${limit}&offset=${offset}`,
      { signal }
    );
  }
}

export const privacyAccessApi = new PrivacyAccessApi();
export default privacyAccessApi;
