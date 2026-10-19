"""Administrator-only contracts for the household health AI runtime."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.health_ai import HealthAiProcessingMode, HealthAiProviderOutput


class StrictAdminHealthAiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AdminHealthAiSettingsUpdate(StrictAdminHealthAiModel):
    expected_revision: int = Field(ge=0)
    mode: HealthAiProcessingMode
    base_url: str = Field(default="", max_length=2048)
    model: str = Field(default="", max_length=160)
    reason: str = Field(min_length=3, max_length=200)

    @field_validator("base_url", "model", "reason")
    @classmethod
    def normalize_inline(cls, value: str) -> str:
        normalized = value.strip()
        if "\n" in normalized or "\r" in normalized or "\x00" in normalized:
            raise ValueError("Value must be a single line")
        return normalized


class AdminHealthAiSettingsResponse(BaseModel):
    selected_mode: HealthAiProcessingMode
    effective_mode: HealthAiProcessingMode
    available: bool
    reason_code: str | None
    configuration_revision: int
    verified_revision: int
    last_tested_at: str | None
    connection_test_required: bool
    base_url: str
    model: str
    provider: str
    api_key_configured: bool
    local_runtime_allowed: bool
    test_provider_allowed: bool
    instance_data_class: str
    processing_location: str
    disclosure: str


class AdminHealthAiTestRequest(StrictAdminHealthAiModel):
    expected_revision: int = Field(ge=0)
    reason: str = Field(min_length=3, max_length=200)

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str) -> str:
        normalized = value.strip()
        if "\n" in normalized or "\r" in normalized or "\x00" in normalized:
            raise ValueError("Reason must be a single line")
        return normalized


class AdminHealthAiTestResponse(BaseModel):
    status: Literal["passed"]
    configuration_revision: int
    verified_revision: int
    tested_at: str
    provider: str
    model: str
    processing_mode: Literal["test", "local"]
    test_mode: bool
    processing_location: str
    disclosure: str
    output: HealthAiProviderOutput
