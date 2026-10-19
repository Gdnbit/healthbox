"""Public and administrator DTOs for archive-circle sharing."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

DashboardTrendRange = Literal["auto", "3m", "6m", "1y", "2y", "5y", "all"]


class ArchiveSubjectResponse(BaseModel):
    patient_id: int
    display_name: str
    scope: Literal["owner", "structured_dashboard"]
    available: bool
    relationship_changed_at: datetime | None


class ArchiveSubjectListResponse(BaseModel):
    subjects: list[ArchiveSubjectResponse]
    scope_notice: str = "共享档案仅包含结构化指标与趋势"


class StructuredDashboardPointResponse(BaseModel):
    id: str
    date: str
    value: float
    secondary_value: float | None
    status: str | None
    reference_min: float | None
    reference_max: float | None
    reference_text: str | None


class StructuredDashboardMetricResponse(BaseModel):
    id: str
    kind: Literal["vital", "lab"]
    label: str
    unit: str
    points: list[StructuredDashboardPointResponse]
    latest_status: str | None


class StructuredDashboardResponse(BaseModel):
    subject: ArchiveSubjectResponse
    metrics: list[StructuredDashboardMetricResponse]
    loaded_at: datetime


class DashboardPreferencesUpdateRequest(BaseModel):
    pinned_metric_ids: list[str] = Field(min_length=1, max_length=2)
    ranges_by_metric_id: dict[str, DashboardTrendRange] = Field(
        default_factory=dict,
        max_length=50,
    )

    @field_validator("pinned_metric_ids")
    @classmethod
    def validate_pinned_metric_ids(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(not value or len(value) > 512 for value in normalized):
            raise ValueError("metric ids must contain 1 to 512 characters")
        if len(set(normalized)) != len(normalized):
            raise ValueError("pinned metric ids must be unique")
        return normalized

    @field_validator("ranges_by_metric_id")
    @classmethod
    def validate_range_metric_ids(
        cls,
        values: dict[str, DashboardTrendRange],
    ) -> dict[str, DashboardTrendRange]:
        normalized = {}
        for key, value in values.items():
            metric_id = key.strip()
            if not metric_id or len(metric_id) > 512:
                raise ValueError("range metric ids must contain 1 to 512 characters")
            if metric_id in normalized:
                raise ValueError("range metric ids must be unique")
            normalized[metric_id] = value
        return normalized


class DashboardPreferencesResponse(BaseModel):
    patient_id: int
    pinned_metric_ids: list[str]
    ranges_by_metric_id: dict[str, DashboardTrendRange]
    updated_at: datetime | None


class ArchiveCircleCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=240)


class ArchiveCircleStatusRequest(BaseModel):
    status: Literal["active", "paused", "archived"]


class ArchiveCircleMemberRequest(BaseModel):
    patient_id: int = Field(gt=0)


class ArchiveCircleMembershipStatusRequest(BaseModel):
    status: Literal["active", "paused"]


class ArchiveCircleMoveRequest(BaseModel):
    patient_id: int = Field(gt=0)
    source_circle_id: int = Field(gt=0)
    target_circle_id: int = Field(gt=0)


class ArchiveCircleMemberResponse(BaseModel):
    patient_id: int
    display_name: str
    account_id: int
    username: str
    account_active: bool
    status: Literal["active", "paused", "removed"]
    scope: Literal["structured_dashboard"]
    joined_at: datetime
    paused_at: datetime | None
    removed_at: datetime | None
    updated_at: datetime


class ArchiveCircleResponse(BaseModel):
    id: int
    name: str
    description: str | None
    status: Literal["active", "paused", "archived"]
    created_at: datetime
    updated_at: datetime
    members: list[ArchiveCircleMemberResponse]


class ArchiveCircleListResponse(BaseModel):
    circles: list[ArchiveCircleResponse]


class ArchiveAdminSubjectResponse(BaseModel):
    patient_id: int
    display_name: str
    account_id: int
    username: str
    account_active: bool


class ArchiveAdminSubjectListResponse(BaseModel):
    subjects: list[ArchiveAdminSubjectResponse]


class ArchiveCircleMutationResponse(BaseModel):
    status: Literal["ok"] = "ok"
    circle_id: int
    patient_id: int | None = None

    @field_validator("circle_id")
    @classmethod
    def validate_circle_id(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("circle_id must be positive")
        return value
