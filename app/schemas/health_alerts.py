from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

RuleType = Literal["threshold", "overdue"]
ThresholdOperator = Literal["gt", "gte", "lt", "lte"]


class HealthAlertRuleInput(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    rule_type: RuleType
    test_name: str = Field(min_length=1, max_length=255)
    unit: Optional[str] = Field(default=None, max_length=100)
    operator: Optional[ThresholdOperator] = None
    threshold_value: Optional[float] = None
    overdue_days: Optional[int] = Field(default=None, ge=1, le=3650)
    enabled: bool = True

    @field_validator("name", "test_name")
    @classmethod
    def strip_required_text(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Value cannot be empty")
        return value

    @field_validator("unit")
    @classmethod
    def strip_optional_text(cls, value):
        if value is None:
            return None
        value = value.strip()
        return value or None

    @model_validator(mode="after")
    def validate_rule_shape(self):
        if self.rule_type == "threshold":
            if self.operator is None or self.threshold_value is None or not self.unit:
                raise ValueError(
                    "Threshold rules require operator, threshold_value and unit"
                )
            if self.overdue_days is not None:
                raise ValueError("Threshold rules cannot set overdue_days")
        else:
            if self.overdue_days is None:
                raise ValueError("Overdue rules require overdue_days")
            if self.operator is not None or self.threshold_value is not None:
                raise ValueError("Overdue rules cannot set a threshold")
        return self


class HealthAlertRuleResponse(HealthAlertRuleInput):
    id: int
    patient_id: int
    created_by_user_id: int
    version: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class HealthAlertEvidence(BaseModel):
    component_id: int
    lab_result_id: int
    observed_date: Optional[str] = None
    test_name: str
    result_type: str
    numeric_value: Optional[float] = None
    qualitative_value: Optional[str] = None
    textual_value: Optional[str] = None
    unit: Optional[str] = None
    status: Optional[str] = None
    threshold_operator: Optional[str] = None
    threshold_value: Optional[float] = None
    overdue_days: Optional[int] = None
    elapsed_days: Optional[int] = None


class HealthAlertSource(BaseModel):
    lab_result_id: int
    source_document_id: Optional[int] = None
    source_page: Optional[int] = None
    source_locator: Optional[str] = None
    import_batch_id: Optional[int] = None


class EvaluatedHealthAlert(BaseModel):
    alert_id: str
    alert_type: Literal["source_status", "threshold", "overdue"]
    severity: Literal["critical", "warning", "info"]
    title: str
    explanation: str
    rule_id: str
    rule_version: int
    rule_description: str
    evidence: HealthAlertEvidence
    source: HealthAlertSource
    calculated_at: datetime
    limitations: str
    muted_until: Optional[datetime] = None


class HealthAlertEvaluationResponse(BaseModel):
    patient_id: int
    calculated_at: datetime
    active_count: int
    muted_count: int
    alerts: list[EvaluatedHealthAlert]


class HealthAlertMuteRequest(BaseModel):
    muted_until: datetime
    reason: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("muted_until")
    @classmethod
    def normalize_utc(cls, value):
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    @field_validator("reason")
    @classmethod
    def strip_reason(cls, value):
        if value is None:
            return None
        value = value.strip()
        return value or None


class HealthAlertMuteResponse(BaseModel):
    alert_id: str
    muted_until: datetime
