from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

HealthCoverageAbsenceReason = Literal["not-performed", "not-applicable", "unknown"]
HealthCoverageVerification = Literal["needs_review", "confirmed", "questionable"]
HealthCoverageStatus = Literal["active", "superseded", "voided"]


class HealthCoverageContent(BaseModel):
    exam_date: date
    metric_key: str = Field(min_length=1, max_length=255)
    metric_name: str = Field(min_length=1, max_length=255)
    metric_code: Optional[str] = Field(default=None, max_length=100)
    absence_reason: HealthCoverageAbsenceReason
    verification_status: HealthCoverageVerification = "needs_review"
    note: Optional[str] = Field(default=None, max_length=2000)
    source_document_id: Optional[int] = Field(default=None, ge=1)
    source_page: Optional[int] = Field(default=None, ge=1)
    source_locator: Optional[str] = Field(default=None, max_length=255)

    @field_validator("exam_date")
    @classmethod
    def reject_future_date(cls, value: date) -> date:
        if value > date.today():
            raise ValueError("Coverage statement date cannot be in the future")
        return value

    @field_validator("metric_key", "metric_name")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Value cannot be empty")
        return value

    @field_validator("metric_code", "note", "source_locator")
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


class HealthCoverageCreate(HealthCoverageContent):
    change_note: Optional[str] = Field(default=None, max_length=1000)


class HealthCoverageRevision(HealthCoverageContent):
    expected_version: int = Field(ge=1)
    change_note: str = Field(min_length=1, max_length=1000)

    @field_validator("change_note")
    @classmethod
    def strip_change_note(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Value cannot be empty")
        return value


class HealthCoverageVoidRequest(BaseModel):
    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=1000)

    @field_validator("reason")
    @classmethod
    def strip_reason(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Value cannot be empty")
        return value


class HealthCoverageResponse(HealthCoverageContent):
    id: int
    patient_id: int
    created_by_user_id: int
    record_key: str
    version_number: int
    supersedes_statement_id: Optional[int] = None
    absence_reason_system: str
    status: HealthCoverageStatus
    is_current: bool
    change_note: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
