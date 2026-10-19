from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import settings
from app.models.health_ai import HealthAiRequest
from app.services.health_ai_request_guard import (
    HealthAiRequestGuard,
    HealthAiRequestGuardError,
    build_health_ai_request_sha256,
    hash_health_ai_idempotency_key,
    validate_health_ai_idempotency_key,
)


def _request_sha256(user_id: int, patient_id: int, record_ids=None) -> str:
    return build_health_ai_request_sha256(
        requested_by_user_id=user_id,
        patient_id=patient_id,
        canonical_question_id="recent_changes",
        canonical_question_text="最近有哪些变化？",
        range_id="all",
        record_ids=record_ids or ["lab:2", "lab:1"],
        template_version="household-ai-answer@1.0.0",
    )


def test_request_guard_validates_key_and_hashes_record_order_stably(
    test_user,
    test_patient,
):
    assert (
        validate_health_ai_idempotency_key("synthetic.guard-key:0001")
        == "synthetic.guard-key:0001"
    )
    with pytest.raises(HealthAiRequestGuardError) as invalid:
        validate_health_ai_idempotency_key("contains space")
    assert invalid.value.code == "health_ai_idempotency_key_invalid"

    forward = _request_sha256(
        test_user.id,
        test_patient.id,
        ["lab:1", "lab:2"],
    )
    reversed_order = _request_sha256(
        test_user.id,
        test_patient.id,
        ["lab:2", "lab:1"],
    )
    assert forward == reversed_order


def test_request_guard_persists_only_hashes_and_replays_terminal_failure(
    db_session,
    test_user,
    test_patient,
):
    guard = HealthAiRequestGuard(db_session)
    raw_key = "synthetic-guard-failure-0001"
    request_sha256 = _request_sha256(test_user.id, test_patient.id)

    assert (
        guard.resolve_existing(
            requested_by_user_id=test_user.id,
            patient_id=test_patient.id,
            idempotency_key=raw_key,
            request_sha256=request_sha256,
        )
        is None
    )
    admission = guard.admit(
        requested_by_user_id=test_user.id,
        patient_id=test_patient.id,
        idempotency_key=raw_key,
        request_sha256=request_sha256,
    )
    assert admission.disposition == "admitted"
    assert db_session.in_transaction() is False

    row = db_session.get(HealthAiRequest, admission.ledger_id)
    assert row.idempotency_key_sha256 == hash_health_ai_idempotency_key(raw_key)
    assert row.idempotency_key_sha256 != raw_key
    assert raw_key not in str(row.__dict__)
    assert "lab:1" not in str(row.__dict__)
    assert "最近有哪些变化" not in str(row.__dict__)

    guard.finalize_failed(
        ledger_id=admission.ledger_id,
        request_id=admission.request_id,
        error_code="health_ai_provider_timeout",
        http_status=504,
    )
    with pytest.raises(HealthAiRequestGuardError) as replay:
        guard.resolve_existing(
            requested_by_user_id=test_user.id,
            patient_id=test_patient.id,
            idempotency_key=raw_key,
            request_sha256=request_sha256,
        )
    assert replay.value.code == "health_ai_provider_timeout"
    assert replay.value.status_code == 504


def test_request_guard_enforces_single_in_progress_and_durable_budget(
    db_session,
    test_user,
    test_patient,
    monkeypatch,
):
    monkeypatch.setattr(settings, "HEALTH_AI_RATE_LIMIT_REQUESTS", 2)
    monkeypatch.setattr(settings, "HEALTH_AI_RATE_LIMIT_WINDOW_SECONDS", 600)
    guard = HealthAiRequestGuard(db_session)
    request_sha256 = _request_sha256(test_user.id, test_patient.id)

    first = guard.admit(
        requested_by_user_id=test_user.id,
        patient_id=test_patient.id,
        idempotency_key="synthetic-guard-budget-0001",
        request_sha256=request_sha256,
    )
    with pytest.raises(HealthAiRequestGuardError) as in_progress:
        guard.resolve_existing(
            requested_by_user_id=test_user.id,
            patient_id=test_patient.id,
            idempotency_key="synthetic-guard-budget-0001",
            request_sha256=request_sha256,
        )
    assert in_progress.value.code == "health_ai_request_in_progress"
    assert int(in_progress.value.headers["Retry-After"]) >= 1

    with pytest.raises(HealthAiRequestGuardError) as concurrent:
        guard.admit(
            requested_by_user_id=test_user.id,
            patient_id=test_patient.id,
            idempotency_key="synthetic-guard-budget-0002",
            request_sha256=request_sha256,
        )
    assert concurrent.value.code == "health_ai_concurrency_limit_exceeded"
    assert concurrent.value.status_code == 429
    guard.finalize_failed(
        ledger_id=first.ledger_id,
        request_id=first.request_id,
        error_code="health_ai_provider_error",
        http_status=502,
    )

    second = guard.admit(
        requested_by_user_id=test_user.id,
        patient_id=test_patient.id,
        idempotency_key="synthetic-guard-budget-0002",
        request_sha256=request_sha256,
    )
    guard.finalize_failed(
        ledger_id=second.ledger_id,
        request_id=second.request_id,
        error_code="health_ai_provider_error",
        http_status=502,
    )
    with pytest.raises(HealthAiRequestGuardError) as limited:
        guard.admit(
            requested_by_user_id=test_user.id,
            patient_id=test_patient.id,
            idempotency_key="synthetic-guard-budget-0003",
            request_sha256=request_sha256,
        )
    assert limited.value.code == "health_ai_rate_limit_exceeded"
    assert limited.value.status_code == 429
    assert limited.value.headers["X-RateLimit-Limit"] == "2"
    assert limited.value.headers["X-RateLimit-Remaining"] == "0"
    assert int(limited.value.headers["Retry-After"]) >= 1


def test_request_guard_abandons_expired_claim_and_rejects_late_worker(
    db_session,
    test_user,
    test_patient,
    monkeypatch,
):
    monkeypatch.setattr(settings, "HEALTH_AI_TIMEOUT_SECONDS", 1)
    monkeypatch.setattr(settings, "HEALTH_AI_LEASE_GRACE_SECONDS", 0)
    monkeypatch.setattr(settings, "HEALTH_AI_MAX_LEASE_SECONDS", 150)
    guard = HealthAiRequestGuard(db_session)
    request_sha256 = _request_sha256(test_user.id, test_patient.id)
    now = datetime(2026, 7, 29, 1, 0, tzinfo=timezone.utc)
    admission = guard.admit(
        requested_by_user_id=test_user.id,
        patient_id=test_patient.id,
        idempotency_key="synthetic-guard-abandoned-0001",
        request_sha256=request_sha256,
        now=now,
    )

    with pytest.raises(HealthAiRequestGuardError) as abandoned:
        guard.resolve_existing(
            requested_by_user_id=test_user.id,
            patient_id=test_patient.id,
            idempotency_key="synthetic-guard-abandoned-0001",
            request_sha256=request_sha256,
            now=now + timedelta(seconds=2),
        )
    assert abandoned.value.code == "health_ai_request_abandoned"
    assert abandoned.value.status_code == 503

    with pytest.raises(HealthAiRequestGuardError) as late:
        guard.finalize_success(
            ledger_id=admission.ledger_id,
            request_id=admission.request_id,
            answer_id=999999,
            now=now + timedelta(seconds=3),
        )
    assert late.value.code == "health_ai_request_abandoned"
    assert db_session.query(HealthAiRequest).one().status == "failed"
