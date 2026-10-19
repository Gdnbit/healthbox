import { apiService } from './index';

export type AccountInvitationStatus =
  | 'pending'
  | 'activated'
  | 'declined'
  | 'cancelled'
  | 'expired';

export type AccountGender = 'female' | 'male' | 'other' | 'prefer_not_to_say';

export interface AccountInvitationMember {
  username: string;
  display_name: string;
}

export interface AccountInvitation {
  id: string;
  recipient_label: string;
  status: AccountInvitationStatus;
  expires_at: string;
  created_at: string;
  activated_at: string | null;
  declined_at: string | null;
  cancelled_at: string | null;
  activated_member: AccountInvitationMember | null;
}

export interface AccountInvitationList {
  contract_version: 'household-account-invitation@1.0.0';
  items: AccountInvitation[];
  total: number;
}

export interface AccountInvitationCreated {
  contract_version: 'household-account-invitation@1.0.0';
  invitation: AccountInvitation;
  activation_path: string;
}

export interface PublicPrivacyNoticeSection {
  key: string;
  title: string;
  body: string;
}

export interface PublicPrivacyNotice {
  notice_version: string;
  locale: string;
  kicker: string;
  title: string;
  summary: string;
  sections: PublicPrivacyNoticeSection[];
  scope: Record<string, unknown>;
  external_processing_consent_included: boolean;
  external_processing_title: string;
  external_processing_body: string;
  confirmation_text: string;
  accept_label: string;
  decline_label: string;
  version_label: string;
}

export interface AccountInvitationInspection {
  contract_version: 'household-account-invitation@1.0.0';
  valid: true;
  expires_at: string;
  privacy_notice: PublicPrivacyNotice;
}

export interface AccountInvitationActivationInput {
  token: string;
  username: string;
  display_name: string;
  birth_date: string;
  gender: AccountGender;
  password: string;
  privacy_notice_version: string;
  privacy_notice_accepted: true;
}

export interface AccountInvitationActivationResult {
  contract_version: 'household-account-invitation@1.0.0';
  status: 'activated';
  username: string;
  display_name: string;
  login_path: '/login';
}

class AccountInvitationApi {
  listInvitations(signal?: AbortSignal): Promise<AccountInvitationList> {
    return apiService.get('/admin/account-invitations', { signal });
  }

  createInvitation(input: {
    recipient_label: string;
    expires_in_hours: 24 | 72 | 168;
  }): Promise<AccountInvitationCreated> {
    return apiService.post('/admin/account-invitations', input);
  }

  cancelInvitation(
    publicId: string,
    reason: string
  ): Promise<AccountInvitation> {
    return apiService.post(`/admin/account-invitations/${publicId}/cancel`, {
      reason,
    });
  }

  inspectInvitation(token: string): Promise<AccountInvitationInspection> {
    return apiService.post('/account-invitations/inspect', { token });
  }

  activateInvitation(
    input: AccountInvitationActivationInput
  ): Promise<AccountInvitationActivationResult> {
    return apiService.post('/account-invitations/activate', input);
  }

  async declineInvitation(token: string): Promise<void> {
    await apiService.post('/account-invitations/decline', { token });
  }
}

export const accountInvitationApi = new AccountInvitationApi();
export default accountInvitationApi;
