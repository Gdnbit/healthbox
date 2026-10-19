from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class PrivacyNoticeSection(BaseModel):
    key: str
    title: str
    body: str


class CurrentPrivacyNoticeResponse(BaseModel):
    notice_version: str
    locale: str
    kicker: str
    title: str
    summary: str
    required: bool
    accepted: bool
    latest_decision: Literal["accepted", "declined"] | None = None
    latest_decided_at: datetime | None = None
    sections: list[PrivacyNoticeSection]
    external_processing_consent_included: bool = False
    external_processing_title: str
    external_processing_body: str
    confirmation_text: str
    accept_label: str
    decline_label: str
    version_label: str


class PrivacyConsentDecisionRequest(BaseModel):
    notice_version: str = Field(min_length=1, max_length=80)
    decision: Literal["accepted", "declined"]


class PrivacyConsentDecisionResponse(BaseModel):
    id: int
    notice_version: str
    decision: Literal["accepted", "declined"]
    decided_at: datetime
    privacy_consent_required: bool
