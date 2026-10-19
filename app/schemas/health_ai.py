"""Contracts for the owner-only, read-only household health AI adapter."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

HealthAiQuestionId = Literal[
    "recent_changes",
    "visit_questions",
    "term_or_custom",
    "custom",
    "screening_schedule",
]
HealthAiRange = Literal["1y", "3y", "5y", "all"]
HealthAiProcessingMode = Literal["off", "test", "local"]


class StrictHealthAiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HealthAiQuestionRequest(StrictHealthAiModel):
    question_id: HealthAiQuestionId
    question: str = Field(min_length=1, max_length=1000)
    range: HealthAiRange
    record_ids: list[str] = Field(min_length=1, max_length=200)

    @field_validator("question")
    @classmethod
    def validate_question(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized or "\x00" in value:
            raise ValueError("question must contain readable text")
        return normalized

    @field_validator("record_ids")
    @classmethod
    def validate_record_ids(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(not value or len(value) > 160 for value in normalized):
            raise ValueError("record ids must contain 1 to 160 characters")
        if len(set(normalized)) != len(normalized):
            raise ValueError("record ids must be unique")
        return normalized


class HealthAiCapabilityResponse(BaseModel):
    available: bool
    provider: str
    model: str | None
    processing_mode: HealthAiProcessingMode
    test_mode: bool = False
    processing_location: str
    reason_code: str | None
    local_handoff_available: bool = True
    supported_question_ids: list[str]
    screening_question_available: bool = False


class HealthAiProviderAnswerItem(StrictHealthAiModel):
    text: str = Field(min_length=1, max_length=800)
    citation_ids: list[str] = Field(min_length=1, max_length=25)

    @field_validator("text")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return " ".join(value.split())

    @field_validator("citation_ids")
    @classmethod
    def validate_citations(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(not value or len(value) > 16 for value in normalized):
            raise ValueError("citation ids are invalid")
        if len(set(normalized)) != len(normalized):
            raise ValueError("citation ids must be unique")
        return normalized


class HealthAiProviderOutput(StrictHealthAiModel):
    answer_items: list[HealthAiProviderAnswerItem] = Field(
        min_length=1,
        max_length=8,
    )
    general_explanations: list[str] = Field(default_factory=list, max_length=6)
    limitations: list[str] = Field(default_factory=list, max_length=8)
    next_steps: list[str] = Field(default_factory=list, max_length=6)

    @field_validator(
        "general_explanations",
        "limitations",
        "next_steps",
    )
    @classmethod
    def validate_text_items(cls, values: list[str]) -> list[str]:
        normalized = [" ".join(value.split()) for value in values]
        if any(not value or len(value) > 600 for value in normalized):
            raise ValueError("answer section items must contain 1 to 600 characters")
        return normalized


class HealthAiProviderRecord(StrictHealthAiModel):
    citation_id: str = Field(min_length=2, max_length=16)
    record_id: str = Field(min_length=1, max_length=160)
    metric_id: str = Field(min_length=1, max_length=240)
    label: str = Field(min_length=1, max_length=120)
    date: str = Field(min_length=10, max_length=10)
    value: float = Field(allow_inf_nan=False)
    secondary_value: float | None = Field(default=None, allow_inf_nan=False)
    unit: str = Field(max_length=40)
    status: str | None = Field(default=None, max_length=40)

    @field_validator("date")
    @classmethod
    def validate_record_date(cls, value: str) -> str:
        try:
            date.fromisoformat(value)
        except ValueError as error:
            raise ValueError("record date must use ISO YYYY-MM-DD") from error
        return value


class HealthAiProviderInput(StrictHealthAiModel):
    contract: str = Field(min_length=1, max_length=80)
    question_id: HealthAiQuestionId
    question: str = Field(min_length=1, max_length=1000)
    range: HealthAiRange
    data_cutoff: str = Field(min_length=10, max_length=10)
    records: list[HealthAiProviderRecord] = Field(min_length=1, max_length=200)
    excluded: list[str] = Field(min_length=1, max_length=30)

    @field_validator("data_cutoff")
    @classmethod
    def validate_data_cutoff(cls, value: str) -> str:
        try:
            date.fromisoformat(value)
        except ValueError as error:
            raise ValueError("data cutoff must use ISO YYYY-MM-DD") from error
        return value


class HealthAiScopeResponse(BaseModel):
    range: HealthAiRange
    record_count: int
    metric_count: int
    data_cutoff: str
    includes_originals: bool = False
    includes_narrative_background: bool = False
    includes_guidance: bool = False
    includes_screening_state: bool = False


class HealthAiProcessingResponse(BaseModel):
    provider: str
    model: str
    processing_mode: HealthAiProcessingMode
    test_mode: bool = False
    processing_location: str
    template_version: str


class HealthAiCitationResponse(BaseModel):
    citation_id: str
    record_id: str
    metric_id: str
    label: str
    date: str
    value: float
    secondary_value: float | None
    unit: str
    status: str | None
    available: bool = True


class HealthAiQuestionResponse(BaseModel):
    status: Literal["answered"] = "answered"
    answer_id: int
    request_id: str
    patient_id: int
    question_id: str
    question: str
    generated_at: str
    scope: HealthAiScopeResponse
    processing: HealthAiProcessingResponse
    answer_items: list[HealthAiProviderAnswerItem]
    general_explanations: list[str]
    citations: list[HealthAiCitationResponse]
    limitations: list[str]
    next_steps: list[str]
    disclaimer: str


class HealthAiAnswerSummaryResponse(BaseModel):
    answer_id: int
    request_id: str
    patient_id: int
    question_id: str
    question: str
    range: HealthAiRange
    generated_at: str
    data_cutoff: str
    model: str
    record_count: int
    provider: str
    test_mode: bool = False


class HealthAiAnswerListResponse(BaseModel):
    items: list[HealthAiAnswerSummaryResponse]
    total: int
    limit: int
    offset: int


class HealthAiAnswerDeleteResponse(BaseModel):
    status: Literal["deleted"] = "deleted"
    answer_id: int
