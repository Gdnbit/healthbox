from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

HealthBackgroundCategory = Literal[
    "general",
    "medical_history",
    "lifestyle",
    "family_history",
    "social_context",
    "other",
]
HealthBackgroundVerification = Literal["needs_review", "confirmed", "questionable"]
HealthBackgroundStatus = Literal["active", "superseded", "voided"]


class HealthBackgroundContent(BaseModel):
    category: HealthBackgroundCategory
    title: str = Field(min_length=1, max_length=255)
    narrative: str = Field(min_length=1, max_length=10000)
    effective_date: Optional[date] = None
    verification_status: HealthBackgroundVerification = "needs_review"
    source_document_id: Optional[int] = Field(default=None, ge=1)
    source_page: Optional[int] = Field(default=None, ge=1)
    source_locator: Optional[str] = Field(default=None, max_length=255)

    @field_validator("title", "narrative")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Value cannot be empty")
        return value

    @field_validator("source_locator")
    @classmethod
    def strip_optional_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return value.strip() or None

    @model_validator(mode="after")
    def validate_source_location(self):
        if self.source_document_id is None and (
            self.source_page is not None or self.source_locator is not None
        ):
            raise ValueError("Source page/location requires a source document")
        return self


class HealthBackgroundCreate(HealthBackgroundContent):
    change_note: Optional[str] = Field(default=None, max_length=1000)


class HealthBackgroundRevision(HealthBackgroundContent):
    expected_version: int = Field(ge=1)
    change_note: str = Field(min_length=1, max_length=1000)

    @field_validator("change_note")
    @classmethod
    def strip_change_note(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Value cannot be empty")
        return value


class HealthBackgroundVoidRequest(BaseModel):
    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=1000)

    @field_validator("reason")
    @classmethod
    def strip_reason(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Value cannot be empty")
        return value


class HealthBackgroundResponse(HealthBackgroundContent):
    id: int
    patient_id: int
    created_by_user_id: int
    record_key: str
    version_number: int
    supersedes_entry_id: Optional[int] = None
    status: HealthBackgroundStatus
    is_current: bool
    change_note: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
