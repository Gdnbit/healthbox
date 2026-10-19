"""DTOs for administrator-issued household account invitations."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

from app.services.privacy_consent_service import HOUSEHOLD_PRIVACY_NOTICE_VERSION

AccountInvitationStatus = Literal[
    "pending",
    "activated",
    "declined",
    "cancelled",
    "expired",
]
AccountGender = Literal["female", "male", "other", "prefer_not_to_say"]


def _single_line(value: str, *, minimum: int, maximum: int) -> str:
    normalized = value.strip()
    if (
        len(normalized) < minimum
        or len(normalized) > maximum
        or "\n" in normalized
        or "\r" in normalized
    ):
        raise ValueError(
            f"value must contain {minimum} to {maximum} single-line characters"
        )
    return normalized


class AccountInvitationCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recipient_label: str = Field(min_length=2, max_length=100)
    expires_in_hours: Literal[24, 72, 168] = 72

    @field_validator("recipient_label")
    @classmethod
    def validate_recipient_label(cls, value: str) -> str:
        return _single_line(value, minimum=2, maximum=100)


class AccountInvitationCancelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=3, max_length=200)

    @field_validator("reason")
    @classmethod
    def validate_reason(cls, value: str) -> str:
        return _single_line(value, minimum=3, maximum=200)


class AccountInvitationMemberResponse(BaseModel):
    username: str
    display_name: str


class AccountInvitationResponse(BaseModel):
    id: str
    recipient_label: str
    status: AccountInvitationStatus
    expires_at: datetime
    created_at: datetime
    activated_at: datetime | None
    declined_at: datetime | None
    cancelled_at: datetime | None
    activated_member: AccountInvitationMemberResponse | None = None


class AccountInvitationCreatedResponse(BaseModel):
    contract_version: Literal["household-account-invitation@1.0.0"]
    invitation: AccountInvitationResponse
    activation_path: str


class AccountInvitationListResponse(BaseModel):
    contract_version: Literal["household-account-invitation@1.0.0"]
    items: list[AccountInvitationResponse]
    total: int


class AccountInvitationTokenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: SecretStr


class AccountInvitationActivateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: SecretStr
    username: str = Field(min_length=3, max_length=50)
    display_name: str = Field(min_length=2, max_length=100)
    birth_date: date
    gender: AccountGender
    password: SecretStr
    privacy_notice_version: str = Field(
        default=HOUSEHOLD_PRIVACY_NOTICE_VERSION,
        min_length=1,
        max_length=80,
    )
    privacy_notice_accepted: bool

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not normalized.replace("_", "").replace("-", "").isalnum():
            raise ValueError(
                "username may contain only letters, numbers, underscores, and hyphens"
            )
        return normalized

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, value: str) -> str:
        return _single_line(value, minimum=2, maximum=100)


class PublicPrivacyNoticeResponse(BaseModel):
    notice_version: str
    locale: str
    kicker: str
    title: str
    summary: str
    sections: list[dict]
    scope: dict
    external_processing_consent_included: bool
    external_processing_title: str
    external_processing_body: str
    confirmation_text: str
    accept_label: str
    decline_label: str
    version_label: str


class AccountInvitationInspectResponse(BaseModel):
    contract_version: Literal["household-account-invitation@1.0.0"]
    valid: Literal[True] = True
    expires_at: datetime
    privacy_notice: PublicPrivacyNoticeResponse


class AccountInvitationActivateResponse(BaseModel):
    contract_version: Literal["household-account-invitation@1.0.0"]
    status: Literal["activated"]
    username: str
    display_name: str
    login_path: Literal["/login"] = "/login"
