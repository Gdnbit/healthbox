"""Persisted, sole-administrator controls for the read-only health AI adapter."""

from __future__ import annotations

import hashlib
import hmac
import json
import re
from dataclasses import dataclass, replace
from datetime import datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.utils.datetime_utils import get_utc_now
from app.crud.system_setting import system_setting
from app.models.activity_log import ActivityLog
from app.models.user import SystemSetting, User
from app.schemas.health_ai import HealthAiProcessingMode, HealthAiProviderOutput
from app.services.health_ai_provider import (
    DYNAMIC_TEST_PROVIDER_NAME,
    HealthAiProviderError,
    HealthAiRuntime,
    build_health_ai_runtime,
    validated_health_ai_base_url,
    validated_health_ai_model_id,
)
from app.services.health_ai_service import (
    AI_TEMPLATE_VERSION,
    HealthAiError,
    prepare_health_ai_provider_output,
    validate_health_ai_provider_grounding,
    validate_health_ai_provider_safety,
)
from app.services.owner_access_service import (
    OwnerAccessError,
    ensure_sole_active_administrator,
)

HEALTH_AI_ADMIN_SETTING_KEY = "health_ai_admin_configuration_v1"
HEALTH_AI_CONFIGURATION_CAPABILITY = "health_ai_configuration"
HEALTH_AI_VERIFICATION_CONTRACT_VERSION = "health-ai-provider-verification@3"


@dataclass(frozen=True)
class AdminHealthAiError(Exception):
    code: str
    message: str
    status_code: int = 400

    def __str__(self) -> str:
        return self.message


@dataclass(frozen=True)
class HealthAiAdminConfiguration:
    revision: int = 0
    mode: HealthAiProcessingMode = "off"
    base_url: str = ""
    model: str = ""
    verified_revision: int = 0
    verified_at: str | None = None
    verified_secret_fingerprint: str | None = None
    valid: bool = True

    def persisted_value(self) -> str:
        return json.dumps(
            {
                "revision": self.revision,
                "mode": self.mode,
                "base_url": self.base_url,
                "model": self.model,
                "verified_revision": self.verified_revision,
                "verified_at": self.verified_at,
                "verified_secret_fingerprint": self.verified_secret_fingerprint,
            },
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )


def _normalize_reason(reason: str) -> str:
    normalized = reason.strip()
    if (
        len(normalized) < 3
        or len(normalized) > 200
        or "\n" in normalized
        or "\r" in normalized
        or "\x00" in normalized
    ):
        raise AdminHealthAiError(
            "invalid_health_ai_configuration_reason",
            "Configuration reason must contain 3 to 200 single-line characters",
            422,
        )
    return normalized


def _provider_secret_fingerprint() -> str:
    """Bind verification to the server-side API secret without storing it."""
    return hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        (
            "health-ai-provider-secret\0"
            + HEALTH_AI_VERIFICATION_CONTRACT_VERSION
            + "\0"
            + AI_TEMPLATE_VERSION
            + "\0"
            + settings.HEALTH_AI_API_KEY
        ).encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _configuration_identity(
    configuration: HealthAiAdminConfiguration,
) -> tuple[int, HealthAiProcessingMode, str, str]:
    return (
        configuration.revision,
        configuration.mode,
        configuration.base_url,
        configuration.model,
    )


def _ensure_sole_administrator(db: Session, actor: User) -> None:
    try:
        ensure_sole_active_administrator(db, actor)
    except OwnerAccessError as error:
        raise AdminHealthAiError(
            error.code,
            error.message,
            error.status_code,
        ) from error


def _parse_configuration(raw: str | None) -> HealthAiAdminConfiguration:
    if raw is None:
        return HealthAiAdminConfiguration()
    try:
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise TypeError("configuration must be an object")
        required_fields = {"revision", "mode", "base_url", "model"}
        optional_fields = {
            "verified_revision",
            "verified_at",
            "verified_secret_fingerprint",
        }
        if not required_fields.issubset(value) or set(value) - (
            required_fields | optional_fields
        ):
            raise ValueError("configuration fields are invalid")
        revision = value["revision"]
        mode = value["mode"]
        base_url = value["base_url"]
        model = value["model"]
        verified_revision = value.get("verified_revision", 0)
        verified_at = value.get("verified_at")
        verified_secret_fingerprint = value.get("verified_secret_fingerprint")
        if (
            isinstance(revision, bool)
            or not isinstance(revision, int)
            or revision < 1
            or mode not in {"off", "test", "local"}
            or not isinstance(base_url, str)
            or not isinstance(model, str)
            or isinstance(verified_revision, bool)
            or not isinstance(verified_revision, int)
            or verified_revision not in {0, revision}
            or (verified_at is not None and not isinstance(verified_at, str))
            or (verified_revision == 0 and verified_at is not None)
            or (verified_revision == revision and not verified_at)
            or (
                verified_secret_fingerprint is not None
                and (
                    not isinstance(verified_secret_fingerprint, str)
                    or re.fullmatch(r"[0-9a-f]{64}", verified_secret_fingerprint)
                    is None
                )
            )
            or (verified_revision == 0 and verified_secret_fingerprint is not None)
            or (
                mode == "local"
                and verified_revision == revision
                and verified_secret_fingerprint is None
            )
        ):
            raise ValueError("configuration values are invalid")
        if verified_at is not None:
            parsed_verified_at = datetime.fromisoformat(
                verified_at.replace("Z", "+00:00")
            )
            if parsed_verified_at.tzinfo is None:
                raise ValueError("verified_at must include a timezone")
        return HealthAiAdminConfiguration(
            revision=revision,
            mode=mode,
            base_url=base_url,
            model=model,
            verified_revision=verified_revision,
            verified_at=verified_at,
            verified_secret_fingerprint=verified_secret_fingerprint,
        )
    except (TypeError, ValueError, json.JSONDecodeError):
        return HealthAiAdminConfiguration(valid=False)


def _load_health_ai_configuration_with_raw(
    db: Session,
    *,
    for_update: bool = False,
) -> tuple[HealthAiAdminConfiguration, str | None]:
    query = db.query(SystemSetting).filter(
        SystemSetting.key == HEALTH_AI_ADMIN_SETTING_KEY
    )
    if for_update:
        query = query.with_for_update().populate_existing()
    row = query.first()
    raw = row.value if row is not None else None
    return _parse_configuration(raw), raw


def load_health_ai_configuration(
    db: Session,
    *,
    for_update: bool = False,
) -> HealthAiAdminConfiguration:
    configuration, _raw = _load_health_ai_configuration_with_raw(
        db,
        for_update=for_update,
    )
    return configuration


def build_persisted_health_ai_runtime(
    db: Session,
    *,
    require_verified: bool = True,
) -> HealthAiRuntime:
    configuration = load_health_ai_configuration(db)
    if not configuration.valid:
        return HealthAiRuntime(
            enabled=False,
            available=False,
            provider_name="disabled",
            model=None,
            processing_location="家庭服务器",
            reason_code="configuration_invalid",
            provider=None,
            processing_mode="off",
        )
    if configuration.mode == "off":
        return HealthAiRuntime(
            enabled=False,
            available=False,
            provider_name="disabled",
            model=None,
            processing_location="家庭服务器",
            reason_code="not_configured",
            provider=None,
            processing_mode="off",
        )
    if configuration.mode == "test":
        return build_health_ai_runtime(
            enabled=True,
            provider_name=DYNAMIC_TEST_PROVIDER_NAME,
            base_url="",
            model="",
        )
    runtime = build_health_ai_runtime(
        enabled=settings.HEALTH_AI_ENABLED,
        provider_name="local_openai_compatible",
        base_url=configuration.base_url,
        model=configuration.model,
    )
    if (
        require_verified
        and runtime.available
        and (
            configuration.verified_revision != configuration.revision
            or configuration.verified_secret_fingerprint
            != _provider_secret_fingerprint()
        )
    ):
        return replace(
            runtime,
            available=False,
            reason_code="connection_test_required",
            provider=None,
        )
    return runtime


def _settings_response(
    configuration: HealthAiAdminConfiguration,
    runtime: HealthAiRuntime,
) -> dict:
    effective_mode: HealthAiProcessingMode = (
        runtime.processing_mode if runtime.available else "off"
    )
    return {
        "selected_mode": configuration.mode if configuration.valid else "off",
        "effective_mode": effective_mode,
        "available": runtime.available,
        "reason_code": runtime.reason_code,
        "configuration_revision": configuration.revision,
        "verified_revision": configuration.verified_revision,
        "last_tested_at": configuration.verified_at,
        "connection_test_required": bool(
            configuration.valid
            and configuration.mode == "local"
            and (
                configuration.verified_revision != configuration.revision
                or configuration.verified_secret_fingerprint
                != _provider_secret_fingerprint()
            )
        ),
        "base_url": configuration.base_url if configuration.valid else "",
        "model": configuration.model if configuration.valid else "",
        "provider": runtime.provider_name,
        "api_key_configured": bool(settings.HEALTH_AI_API_KEY),
        "local_runtime_allowed": bool(settings.HEALTH_AI_ENABLED),
        "test_provider_allowed": bool(
            settings.HEALTH_AI_TEST_PROVIDER_ALLOWED
            and settings.INSTANCE_DATA_CLASS == "synthetic"
        ),
        "instance_data_class": settings.INSTANCE_DATA_CLASS,
        "processing_location": runtime.processing_location,
        "disclosure": (
            "AI 只读取本次明确选择的正式结构化记录，不能修改健康档案；"
            "API 密钥只由服务器 Secret 提供，页面不会接收或回显密钥。"
        ),
    }


def get_admin_health_ai_settings(db: Session, actor: User) -> dict:
    _ensure_sole_administrator(db, actor)
    configuration = load_health_ai_configuration(db)
    runtime = build_persisted_health_ai_runtime(db)
    return _settings_response(configuration, runtime)


def update_admin_health_ai_settings(
    db: Session,
    *,
    actor: User,
    expected_revision: int,
    mode: HealthAiProcessingMode,
    base_url: str,
    model: str,
    reason: str,
    ip_address: str | None,
    user_agent: str | None,
) -> dict:
    _ensure_sole_administrator(db, actor)
    normalized_reason = _normalize_reason(reason)
    current, current_raw = _load_health_ai_configuration_with_raw(
        db,
        for_update=True,
    )
    if not current.valid:
        raise AdminHealthAiError(
            "health_ai_configuration_invalid",
            "The stored AI configuration is invalid and was not changed",
            409,
        )
    if current.revision != expected_revision:
        raise AdminHealthAiError(
            "health_ai_configuration_revision_conflict",
            "The AI configuration changed; reload it before saving",
            409,
        )

    normalized_base_url = base_url.strip()
    normalized_model = model.strip()
    if mode == "local":
        validated_url = validated_health_ai_base_url(normalized_base_url)
        validated_model = validated_health_ai_model_id(normalized_model)
        if validated_url is None:
            raise AdminHealthAiError(
                "invalid_local_endpoint",
                "A loopback or host.docker.internal model endpoint is required",
                422,
            )
        if validated_model is None:
            raise AdminHealthAiError(
                "invalid_model_id",
                "A valid lightweight local model identifier is required",
                422,
            )
        normalized_base_url = validated_url
        normalized_model = validated_model
    elif mode == "test":
        if not settings.HEALTH_AI_TEST_PROVIDER_ALLOWED:
            raise AdminHealthAiError(
                "test_provider_not_allowed",
                "The synthetic test provider is not allowed by the server",
                409,
            )
        if settings.INSTANCE_DATA_CLASS != "synthetic":
            raise AdminHealthAiError(
                "synthetic_instance_required",
                "The test provider can only run on a synthetic-data instance",
                409,
            )

    updated = HealthAiAdminConfiguration(
        revision=current.revision + 1,
        mode=mode,
        base_url=normalized_base_url,
        model=normalized_model,
        verified_revision=0,
        verified_at=None,
        verified_secret_fingerprint=None,
    )
    try:
        if current_raw is None:
            # Do not perform a second "find-or-create" query here. If another
            # first-time request inserted the singleton after our empty read,
            # this direct insert must conflict instead of overwriting it.
            db.add(
                SystemSetting(
                    key=HEALTH_AI_ADMIN_SETTING_KEY,
                    value=updated.persisted_value(),
                )
            )
        else:
            updated_count = (
                db.query(SystemSetting)
                .filter(
                    SystemSetting.key == HEALTH_AI_ADMIN_SETTING_KEY,
                    SystemSetting.value == current_raw,
                )
                .update(
                    {SystemSetting.value: updated.persisted_value()},
                    synchronize_session=False,
                )
            )
            if updated_count != 1:
                db.rollback()
                raise AdminHealthAiError(
                    "health_ai_configuration_revision_conflict",
                    "The AI configuration changed; reload it before saving",
                    409,
                )
        # Flush while the optimistic revision check is still in this function.
        # If two first-time requests both observed revision 0, only one insert
        # may win; the other is converted into the same 409 revision contract.
        db.flush()
    except IntegrityError as error:
        db.rollback()
        raise AdminHealthAiError(
            "health_ai_configuration_revision_conflict",
            "The AI configuration changed; reload it before saving",
            409,
        ) from error
    db.add(
        ActivityLog.create_activity(
            action="updated",
            entity_type="health_ai_configuration",
            description="Updated the household health AI runtime configuration",
            user_id=actor.id,
            metadata={
                "actor_user_id": actor.id,
                "capability": HEALTH_AI_CONFIGURATION_CAPABILITY,
                "previous_mode": current.mode,
                "mode": mode,
                "configuration_revision": updated.revision,
                "reason": normalized_reason,
                "result": "completed",
            },
            ip_address=ip_address,
            user_agent=user_agent,
        )
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    runtime = build_persisted_health_ai_runtime(db)
    return _settings_response(updated, runtime)


def _synthetic_test_payload() -> dict:
    return {
        "contract": AI_TEMPLATE_VERSION,
        "question_id": "recent_changes",
        "question": "虚构测试记录最近有哪些变化？",
        "range": "all",
        "data_cutoff": "2026-06-01",
        "records": [
            {
                "citation_id": "R1",
                "record_id": "synthetic:glucose:1",
                "metric_id": "synthetic:glucose",
                "label": "虚构指标甲",
                "date": "2025-06-01",
                "value": 5.1,
                "secondary_value": None,
                "unit": "u",
                "status": "示例状态",
            },
            {
                "citation_id": "R2",
                "record_id": "synthetic:glucose:2",
                "metric_id": "synthetic:glucose",
                "label": "虚构指标甲",
                "date": "2026-06-01",
                "value": 5.4,
                "secondary_value": None,
                "unit": "u",
                "status": "示例状态",
            },
        ],
        "excluded": [
            "direct_identity",
            "original_files",
            "narrative_background",
            "guidance",
            "screening_state",
        ],
    }


def _record_connection_test_failure(
    db: Session,
    *,
    actor: User,
    configuration: HealthAiAdminConfiguration,
    reason: str,
    error_code: str,
    ip_address: str | None,
    user_agent: str | None,
) -> None:
    """Persist a metadata-only failure event without provider output or secrets."""
    db.add(
        ActivityLog.create_activity(
            action="tested",
            entity_type="health_ai_configuration",
            description="Household health AI runtime connection test failed",
            user_id=actor.id,
            metadata={
                "actor_user_id": actor.id,
                "capability": HEALTH_AI_CONFIGURATION_CAPABILITY,
                "mode": configuration.mode,
                "configuration_revision": configuration.revision,
                "verified_revision": configuration.verified_revision,
                "reason": reason,
                "result": "failed",
                "error_code": error_code,
            },
            ip_address=ip_address,
            user_agent=user_agent,
        )
    )
    try:
        db.commit()
    except Exception as error:
        db.rollback()
        raise AdminHealthAiError(
            "health_ai_test_audit_failed",
            "The connection test result could not be audited",
            503,
        ) from error


async def test_admin_health_ai_connection(
    db: Session,
    *,
    actor: User,
    expected_revision: int,
    reason: str,
    ip_address: str | None,
    user_agent: str | None,
) -> dict:
    _ensure_sole_administrator(db, actor)
    normalized_reason = _normalize_reason(reason)
    configuration = load_health_ai_configuration(db)
    if not configuration.valid:
        raise AdminHealthAiError(
            "health_ai_configuration_invalid",
            "The stored AI configuration is invalid",
            409,
        )
    if configuration.revision != expected_revision:
        raise AdminHealthAiError(
            "health_ai_configuration_revision_conflict",
            "The AI configuration changed; reload it before testing",
            409,
        )
    runtime = build_persisted_health_ai_runtime(db, require_verified=False)
    if (
        configuration.mode == "off"
        or not runtime.available
        or runtime.provider is None
        or runtime.model is None
    ):
        error_code = runtime.reason_code or "health_ai_not_configured"
        _record_connection_test_failure(
            db,
            actor=actor,
            configuration=configuration,
            reason=normalized_reason,
            error_code=error_code,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        raise AdminHealthAiError(
            error_code,
            "The selected AI runtime is not available",
            409,
        )
    test_payload = _synthetic_test_payload()
    try:
        output = await runtime.provider.answer(
            system_prompt=(
                "只复述固定虚构记录；无工具；不得诊断、建议治疗或推断风险。"
                "每个引用都必须直接写出对应记录的数值，不得只重复问题。"
            ),
            payload=test_payload,
        )
    except HealthAiProviderError as error:
        _record_connection_test_failure(
            db,
            actor=actor,
            configuration=configuration,
            reason=normalized_reason,
            error_code=error.code,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        raise AdminHealthAiError(
            error.code,
            error.message,
            error.status_code,
        ) from error
    allowed = {"R1", "R2"}
    if any(
        citation_id not in allowed
        for item in output.answer_items
        for citation_id in item.citation_ids
    ):
        _record_connection_test_failure(
            db,
            actor=actor,
            configuration=configuration,
            reason=normalized_reason,
            error_code="health_ai_invalid_model_citation",
            ip_address=ip_address,
            user_agent=user_agent,
        )
        raise AdminHealthAiError(
            "health_ai_invalid_model_citation",
            "The configured provider returned an invalid test citation",
            502,
        )
    try:
        validate_health_ai_provider_safety(output)
        validate_health_ai_provider_grounding(
            output,
            citations=test_payload["records"],
        )
    except HealthAiError as error:
        _record_connection_test_failure(
            db,
            actor=actor,
            configuration=configuration,
            reason=normalized_reason,
            error_code=error.code,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        raise AdminHealthAiError(
            error.code,
            error.message,
            error.status_code,
        ) from error
    output = prepare_health_ai_provider_output(
        output,
        test_mode=runtime.test_mode,
    )

    current, current_raw = _load_health_ai_configuration_with_raw(
        db,
        for_update=True,
    )
    if not current.valid or _configuration_identity(current) != _configuration_identity(
        configuration
    ):
        _record_connection_test_failure(
            db,
            actor=actor,
            configuration=configuration,
            reason=normalized_reason,
            error_code="health_ai_configuration_revision_conflict",
            ip_address=ip_address,
            user_agent=user_agent,
        )
        raise AdminHealthAiError(
            "health_ai_configuration_revision_conflict",
            "The AI configuration changed while it was being tested",
            409,
        )
    configuration = current
    tested_at = get_utc_now().isoformat()
    if configuration.mode == "local":
        configuration = replace(
            configuration,
            verified_revision=configuration.revision,
            verified_at=tested_at,
            verified_secret_fingerprint=_provider_secret_fingerprint(),
        )
    if current_raw is None:
        _record_connection_test_failure(
            db,
            actor=actor,
            configuration=current,
            reason=normalized_reason,
            error_code="health_ai_configuration_revision_conflict",
            ip_address=ip_address,
            user_agent=user_agent,
        )
        raise AdminHealthAiError(
            "health_ai_configuration_revision_conflict",
            "The AI configuration changed while it was being tested",
            409,
        )
    persisted_after_test = (
        configuration.persisted_value()
        if configuration.mode == "local"
        else current_raw
    )
    updated_count = (
        db.query(SystemSetting)
        .filter(
            SystemSetting.key == HEALTH_AI_ADMIN_SETTING_KEY,
            SystemSetting.value == current_raw,
        )
        .update(
            {SystemSetting.value: persisted_after_test},
            synchronize_session=False,
        )
    )
    if updated_count != 1:
        db.rollback()
        _record_connection_test_failure(
            db,
            actor=actor,
            configuration=current,
            reason=normalized_reason,
            error_code="health_ai_configuration_revision_conflict",
            ip_address=ip_address,
            user_agent=user_agent,
        )
        raise AdminHealthAiError(
            "health_ai_configuration_revision_conflict",
            "The AI configuration changed while it was being tested",
            409,
        )

    db.add(
        ActivityLog.create_activity(
            action="tested",
            entity_type="health_ai_configuration",
            description="Tested the household health AI runtime with synthetic data",
            user_id=actor.id,
            metadata={
                "actor_user_id": actor.id,
                "capability": HEALTH_AI_CONFIGURATION_CAPABILITY,
                "mode": configuration.mode,
                "configuration_revision": configuration.revision,
                "verified_revision": configuration.verified_revision,
                "reason": normalized_reason,
                "result": "passed",
            },
            ip_address=ip_address,
            user_agent=user_agent,
        )
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {
        "status": "passed",
        "configuration_revision": configuration.revision,
        "verified_revision": configuration.verified_revision,
        "tested_at": tested_at,
        "provider": runtime.provider_name,
        "model": runtime.model,
        "processing_mode": runtime.processing_mode,
        "test_mode": runtime.test_mode,
        "processing_location": runtime.processing_location,
        "disclosure": (
            "连接测试只使用应用内固定虚构数据，不读取任何成员档案；"
            + (
                "当前结果由确定性测试规则生成，未调用真实大模型。"
                if runtime.test_mode
                else (
                    "已配置模型使用固定虚构数据生成测试回答；只有通过结构、"
                    "引用和只读安全检查的结果才会展示，但仍不证明医学正确性。"
                )
            )
        ),
        "output": HealthAiProviderOutput.model_validate(output).model_dump(),
    }
