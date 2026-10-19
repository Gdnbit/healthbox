"""Sanitized member-facing privacy access transparency DTOs."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class PrivacyAccessSubjectResponse(BaseModel):
    display_name: str


class PrivacyAccessAdministratorResponse(BaseModel):
    label: str = "系统管理员"
    can_read_all_server_data: bool = True


class PrivacyAccessViewerResponse(BaseModel):
    display_name: str
    scope: Literal["structured_dashboard"] = "structured_dashboard"
    scope_label: str = "结构化指标与趋势"


class PrivacyAccessVisibilityResponse(BaseModel):
    administrator: PrivacyAccessAdministratorResponse
    reciprocal_viewers: list[PrivacyAccessViewerResponse]
    not_shared_by_default: list[str]


class PrivacyAccessActorResponse(BaseModel):
    kind: Literal["self", "member", "administrator", "system"]
    label: str


class PrivacyAccessAuthorizationResponse(BaseModel):
    basis: str
    label: str


class PrivacyAccessResourceResponse(BaseModel):
    kind: str
    label: str


class PrivacyAccessEventResponse(BaseModel):
    actor: PrivacyAccessActorResponse
    action: str
    action_label: str
    resource: PrivacyAccessResourceResponse
    authorization: PrivacyAccessAuthorizationResponse
    result: str
    occurred_at: datetime


class PrivacyAccessResponse(BaseModel):
    subject: PrivacyAccessSubjectResponse
    visibility: PrivacyAccessVisibilityResponse
    events: list[PrivacyAccessEventResponse]
    total: int
    offset: int
    limit: int
    generated_at: datetime
    history_notice: str
