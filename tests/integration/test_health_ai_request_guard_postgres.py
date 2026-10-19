"""PostgreSQL-only concurrency proof for the durable health AI request guard.

This test is deliberately skipped unless a dedicated, loopback-only smoke
database URL is supplied. It must never be pointed at a normal development or
production database.
"""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, delete, func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.models.health_ai import HealthAiRequest
from app.models.patient import Patient
from app.models.user import User
from app.services.health_ai_request_guard import (
    HealthAiRequestGuard,
    HealthAiRequestGuardError,
    build_health_ai_request_sha256,
)

POSTGRES_URL_ENV = "FAMILY_HEALTH_AI_GUARD_POSTGRES_URL"
EXPECTED_DATABASE = "family_health_ai_smoke_guard_test"
EXPECTED_HOST_PORT = 55439
EXPECTED_MIGRATION_HEAD = "health_ai_request_guard_v1"

pytestmark = [pytest.mark.integration, pytest.mark.database]


@dataclass(frozen=True)
class _Attempt:
    disposition: str
    ledger_id: int | None = None
    request_id: str | None = None
    error_code: str | None = None


def _dedicated_postgres_url() -> str:
    raw_url = os.getenv(POSTGRES_URL_ENV)
    if not raw_url:
        pytest.skip(f"{POSTGRES_URL_ENV} is not set")

    parsed = make_url(raw_url)
    safety_errors = []
    if not parsed.drivername.startswith("postgresql"):
        safety_errors.append("driver must be PostgreSQL")
    if parsed.host not in {"127.0.0.1", "localhost"}:
        safety_errors.append("host must be loopback")
    if parsed.port != EXPECTED_HOST_PORT:
        safety_errors.append(f"host port must be {EXPECTED_HOST_PORT}")
    if parsed.database != EXPECTED_DATABASE:
        safety_errors.append(f"database must be {EXPECTED_DATABASE}")
    if not (parsed.username or "").startswith("family_health_ai_smoke"):
        safety_errors.append("username must use the family_health_ai_smoke prefix")
    if safety_errors:
        pytest.fail(f"Refusing unsafe {POSTGRES_URL_ENV}: " + "; ".join(safety_errors))
    return raw_url


def _request_sha256(user_id: int, patient_id: int, marker: str) -> str:
    return build_health_ai_request_sha256(
        requested_by_user_id=user_id,
        patient_id=patient_id,
        canonical_question_id="recent_changes",
        canonical_question_text="最近有哪些变化？",
        range_id="all",
        record_ids=[f"synthetic:{marker}:2", f"synthetic:{marker}:1"],
        template_version="household-ai-answer@1.0.0",
    )


def _concurrent_admissions(
    session_factory,
    *,
    requested_by_user_id: int,
    patient_id: int,
    request_sha256: str,
    idempotency_keys: tuple[str, str],
) -> list[_Attempt]:
    barrier = Barrier(len(idempotency_keys))

    def attempt(idempotency_key: str) -> _Attempt:
        session = session_factory()
        try:
            barrier.wait(timeout=10)
            admission = HealthAiRequestGuard(session).admit(
                requested_by_user_id=requested_by_user_id,
                patient_id=patient_id,
                idempotency_key=idempotency_key,
                request_sha256=request_sha256,
            )
            return _Attempt(
                disposition=admission.disposition,
                ledger_id=admission.ledger_id,
                request_id=admission.request_id,
            )
        except HealthAiRequestGuardError as exc:
            return _Attempt(disposition="rejected", error_code=exc.code)
        finally:
            session.rollback()
            session.close()

    with ThreadPoolExecutor(
        max_workers=len(idempotency_keys),
        thread_name_prefix="family-health-ai-smoke-guard",
    ) as executor:
        futures = [
            executor.submit(attempt, idempotency_key)
            for idempotency_key in idempotency_keys
        ]
        return [future.result(timeout=20) for future in futures]


def test_postgres_guard_serializes_idempotency_concurrency_and_window_budget(
    monkeypatch,
):
    """Two real PostgreSQL sessions cannot admit duplicate or excess workers."""
    engine = create_engine(
        _dedicated_postgres_url(),
        pool_pre_ping=True,
        connect_args={
            "application_name": "family-health-ai-smoke-guard-test",
            "connect_timeout": 5,
        },
    )
    session_factory = sessionmaker(
        bind=engine,
        autocommit=False,
        autoflush=False,
        expire_on_commit=False,
    )
    marker = uuid4().hex
    setup_session = session_factory()
    user_id = None
    patient_id = None

    try:
        migration_head = setup_session.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one()
        assert migration_head == EXPECTED_MIGRATION_HEAD

        user = User(
            username=f"family_health_ai_smoke_{marker}",
            email=f"family-health-ai-smoke-{marker}@example.invalid",
            password_hash="synthetic-not-a-login-secret",
            full_name="Synthetic Guard User",
            role="user",
            auth_method="local",
            must_change_password=False,
            auth_version=1,
            is_active=True,
        )
        setup_session.add(user)
        setup_session.flush()
        patient = Patient(
            user_id=user.id,
            owner_user_id=user.id,
            is_self_record=True,
            privacy_level="owner",
            is_externally_accessible=False,
            first_name="Synthetic",
            last_name="Guard",
            birth_date=date(1990, 1, 1),
            gender="O",
        )
        setup_session.add(patient)
        setup_session.commit()
        user_id = user.id
        patient_id = patient.id

        monkeypatch.setattr(settings, "HEALTH_AI_RATE_LIMIT_REQUESTS", 10)
        monkeypatch.setattr(settings, "HEALTH_AI_RATE_LIMIT_WINDOW_SECONDS", 600)
        monkeypatch.setattr(settings, "HEALTH_AI_TIMEOUT_SECONDS", 45)
        monkeypatch.setattr(settings, "HEALTH_AI_LEASE_GRACE_SECONDS", 30)
        monkeypatch.setattr(settings, "HEALTH_AI_MAX_LEASE_SECONDS", 150)

        same_key_results = _concurrent_admissions(
            session_factory,
            requested_by_user_id=user_id,
            patient_id=patient_id,
            request_sha256=_request_sha256(user_id, patient_id, "same-key"),
            idempotency_keys=(
                f"synthetic-same-key-{marker}",
                f"synthetic-same-key-{marker}",
            ),
        )
        assert [result.disposition for result in same_key_results].count(
            "admitted"
        ) == 1
        assert [result.error_code for result in same_key_results].count(
            "health_ai_request_in_progress"
        ) == 1
        assert (
            setup_session.scalar(
                select(func.count())
                .select_from(HealthAiRequest)
                .where(HealthAiRequest.requested_by_user_id == user_id)
            )
            == 1
        )

        setup_session.execute(
            delete(HealthAiRequest).where(
                HealthAiRequest.requested_by_user_id == user_id
            )
        )
        setup_session.commit()

        different_key_results = _concurrent_admissions(
            session_factory,
            requested_by_user_id=user_id,
            patient_id=patient_id,
            request_sha256=_request_sha256(user_id, patient_id, "different-key"),
            idempotency_keys=(
                f"synthetic-different-a-{marker}",
                f"synthetic-different-b-{marker}",
            ),
        )
        admitted = [
            result
            for result in different_key_results
            if result.disposition == "admitted"
        ]
        assert len(admitted) == 1
        assert [result.error_code for result in different_key_results].count(
            "health_ai_concurrency_limit_exceeded"
        ) == 1
        assert (
            setup_session.scalar(
                select(func.count())
                .select_from(HealthAiRequest)
                .where(HealthAiRequest.requested_by_user_id == user_id)
            )
            == 1
        )

        terminal_session = session_factory()
        try:
            HealthAiRequestGuard(terminal_session).finalize_failed(
                ledger_id=admitted[0].ledger_id,
                request_id=admitted[0].request_id,
                error_code="health_ai_provider_error",
                http_status=502,
            )
        finally:
            terminal_session.close()

        monkeypatch.setattr(settings, "HEALTH_AI_RATE_LIMIT_REQUESTS", 1)
        exhausted_results = _concurrent_admissions(
            session_factory,
            requested_by_user_id=user_id,
            patient_id=patient_id,
            request_sha256=_request_sha256(user_id, patient_id, "window-exhausted"),
            idempotency_keys=(
                f"synthetic-exhausted-a-{marker}",
                f"synthetic-exhausted-b-{marker}",
            ),
        )
        assert [result.error_code for result in exhausted_results] == [
            "health_ai_rate_limit_exceeded",
            "health_ai_rate_limit_exceeded",
        ]
        assert (
            setup_session.scalar(
                select(func.count())
                .select_from(HealthAiRequest)
                .where(HealthAiRequest.requested_by_user_id == user_id)
            )
            == 1
        )
    finally:
        setup_session.rollback()
        if user_id is not None:
            setup_session.execute(
                delete(HealthAiRequest).where(
                    HealthAiRequest.requested_by_user_id == user_id
                )
            )
        if patient_id is not None:
            setup_session.execute(delete(Patient).where(Patient.id == patient_id))
        if user_id is not None:
            setup_session.execute(delete(User).where(User.id == user_id))
        setup_session.commit()
        setup_session.close()
        engine.dispose()
