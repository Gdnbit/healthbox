"""API contracts for complete health archive export jobs."""

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

HealthArchiveExportStatus = Literal[
    "queued",
    "running",
    "ready",
    "failed",
    "cancelled",
    "expired",
]


class HealthArchiveExportCreate(BaseModel):
    patient_id: int = Field(gt=0)
    idempotency_key: str = Field(min_length=8, max_length=64)

    @field_validator("idempotency_key")
    @classmethod
    def validate_idempotency_key(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized or any(character.isspace() for character in normalized):
            raise ValueError("Idempotency key cannot contain whitespace")
        return normalized


class HealthArchiveExportResponse(BaseModel):
    id: int
    patient_id: int
    schema_version: str
    status: HealthArchiveExportStatus
    attempt_count: int
    archive_filename: str
    archive_size_bytes: Optional[int] = None
    archive_sha256: Optional[str] = None
    original_count: int
    manifest_summary: dict
    error_code: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    downloaded_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    can_download: bool = False

    model_config = ConfigDict(from_attributes=True)


class HealthArchiveExportListResponse(BaseModel):
    items: list[HealthArchiveExportResponse]
    total: int = Field(ge=0)
