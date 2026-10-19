"""Durable idempotency and per-user admission for owner-only health AI.

Callers must complete all non-billable preflight checks before ``admit``.
``admit`` commits the ledger claim so no transaction or user-row lock remains
open while the provider runs. A successful caller then writes the answer and
audit in the same transaction as ``finalize_success``. Provider or persistence
failures are closed with ``finalize_failed`` after rolling back pending work.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal, Sequence
from uuid import uuid4

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.health_ai import HealthAiAnswer, HealthAiRequest
from app.models.user import User

IDEMPOTENCY_KEY_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,64}$")
SAFE_ERROR_CODE_PATTERN = re.compile(r"^health_ai_[a-z0-9_]{1,70}$")
REQUEST_OPERATION = "owner_recent_changes"
ABANDONED_ERROR_CODE = "health_ai_request_abandoned"
ABANDONED_HTTP_STATUS = 503


class HealthAiRequestGuardError(Exception):
    """Stable HTTP-safe rejection raised by the durable request guard."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int,
        *,
        headers: dict[str, str] | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.headers = headers or {}


@dataclass(frozen=True)
class HealthAiRequestAdmission:
    """A new provider claim or a completed answer replay."""

    disposition: Literal["admitted", "replayed"]
    ledger_id: int
    request_id: str
    answer_id: int | None
    lease_expires_at: datetime | None
    rate_limit_limit: int
    rate_limit_remaining: int
    rate_limit_reset: int

    @property
    def is_replay(self) -> bool:
        return self.disposition == "replayed"

    @property
    def response_headers(self) -> dict[str, str]:
        headers = {
            "X-RateLimit-Limit": str(self.rate_limit_limit),
            "X-RateLimit-Remaining": str(self.rate_limit_remaining),
            "X-RateLimit-Reset": str(self.rate_limit_reset),
        }
        if self.is_replay:
            headers["Idempotency-Replayed"] = "true"
        return headers


def validate_health_ai_idempotency_key(value: str | None) -> str:
    """Validate the request header without normalizing distinct keys."""
    if value is None or value == "":
        raise HealthAiRequestGuardError(
            "health_ai_idempotency_key_required",
            "Idempotency-Key is required",
            400,
        )
    if not IDEMPOTENCY_KEY_PATTERN.fullmatch(value):
        raise HealthAiRequestGuardError(
            "health_ai_idempotency_key_invalid",
            "Idempotency-Key must be an 8-64 character ASCII token",
            400,
        )
    return value


def hash_health_ai_idempotency_key(value: str) -> str:
    """Return the only representation of a request key that may be stored."""
    validated = validate_health_ai_idempotency_key(value)
    return hashlib.sha256(validated.encode("ascii")).hexdigest()


def build_health_ai_request_sha256(
    *,
    requested_by_user_id: int,
    patient_id: int,
    canonical_question_id: str,
    canonical_question_text: str,
    range_id: str,
    record_ids: Sequence[str],
    template_version: str,
    operation: str = REQUEST_OPERATION,
) -> str:
    """Hash a deterministic request binding without returning storable content."""
    canonical = {
        "canonical_question_id": canonical_question_id,
        "canonical_question_text": canonical_question_text,
        "operation": operation,
        "patient_id": patient_id,
        "range": range_id,
        "requested_by_user_id": requested_by_user_id,
        "sorted_record_ids": sorted(str(record_id) for record_id in record_ids),
        "template_version": template_version,
    }
    serialized = json.dumps(
        canonical,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


class HealthAiRequestGuard:
    """Serialize per-user admission through the durable user row."""

    def __init__(self, db: Session):
        self.db = db

    def resolve_existing(
        self,
        *,
        requested_by_user_id: int,
        patient_id: int,
        idempotency_key: str,
        request_sha256: str,
        now: datetime | None = None,
    ) -> HealthAiRequestAdmission | None:
        """Resolve a durable replay before runtime and record preflight.

        A missing key binding is read-only and returns ``None``. The caller must
        then perform every non-billable preflight before calling ``admit``,
        which repeats the lookup while holding the per-user admission lock.
        """
        key_sha256 = hash_health_ai_idempotency_key(idempotency_key)
        self._validate_sha256(request_sha256, field_name="request_sha256")
        current_time = _as_utc(now or datetime.now(timezone.utc))
        request_row = (
            self.db.query(HealthAiRequest)
            .filter(
                HealthAiRequest.requested_by_user_id == requested_by_user_id,
                HealthAiRequest.idempotency_key_sha256 == key_sha256,
            )
            .with_for_update()
            .one_or_none()
        )
        if request_row is None:
            self.db.rollback()
            return None
        return self._replay_or_reject(
            request_row,
            patient_id=patient_id,
            request_sha256=request_sha256,
            now=current_time,
            limit=self._rate_limit(),
            window_seconds=self._window_seconds(),
        )

    def admit(
        self,
        *,
        requested_by_user_id: int,
        patient_id: int,
        idempotency_key: str,
        request_sha256: str,
        now: datetime | None = None,
    ) -> HealthAiRequestAdmission:
        """Claim one provider call, or replay/reject a prior durable request.

        This method commits before returning an ``admitted`` result. The caller
        therefore performs the provider wait with no open database transaction.
        """
        key_sha256 = hash_health_ai_idempotency_key(idempotency_key)
        self._validate_sha256(request_sha256, field_name="request_sha256")
        current_time = _as_utc(now or datetime.now(timezone.utc))
        limit = self._rate_limit()
        window_seconds = self._window_seconds()

        owner = (
            self.db.query(User)
            .filter(User.id == requested_by_user_id)
            .with_for_update()
            .one_or_none()
        )
        if owner is None:
            self.db.rollback()
            raise HealthAiRequestGuardError(
                "health_ai_request_owner_not_found",
                "The request owner was not found",
                404,
            )

        existing = (
            self.db.query(HealthAiRequest)
            .filter(
                HealthAiRequest.requested_by_user_id == requested_by_user_id,
                HealthAiRequest.idempotency_key_sha256 == key_sha256,
            )
            .one_or_none()
        )
        if existing is not None:
            return self._replay_or_reject(
                existing,
                patient_id=patient_id,
                request_sha256=request_sha256,
                now=current_time,
                limit=limit,
                window_seconds=window_seconds,
            )

        active = self._close_expired_requests(
            requested_by_user_id=requested_by_user_id,
            now=current_time,
        )
        if active:
            retry_after = min(
                _seconds_until(row.lease_expires_at, current_time) for row in active
            )
            self.db.commit()
            raise HealthAiRequestGuardError(
                "health_ai_concurrency_limit_exceeded",
                "Another health AI request is still being processed",
                429,
                headers={"Retry-After": str(retry_after)},
            )

        count, reset_epoch, retry_after = self._budget_state(
            requested_by_user_id=requested_by_user_id,
            now=current_time,
            window_seconds=window_seconds,
        )
        if count >= limit:
            self.db.commit()
            raise HealthAiRequestGuardError(
                "health_ai_rate_limit_exceeded",
                "The health AI request budget has been reached",
                429,
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(reset_epoch),
                },
            )

        lease_expires_at = current_time + timedelta(seconds=self._lease_seconds())
        request_row = HealthAiRequest(
            requested_by_user_id=requested_by_user_id,
            patient_id=patient_id,
            idempotency_key_sha256=key_sha256,
            request_sha256=request_sha256,
            request_id=str(uuid4()),
            status="in_progress",
            admitted_at=current_time,
            lease_expires_at=lease_expires_at,
            created_at=current_time,
            updated_at=current_time,
        )
        self.db.add(request_row)
        self.db.flush()
        ledger_id = request_row.id
        request_id = request_row.request_id
        remaining = max(0, limit - count - 1)
        if count == 0:
            reset_epoch = _epoch_seconds(
                current_time + timedelta(seconds=window_seconds)
            )
        self.db.commit()

        return HealthAiRequestAdmission(
            disposition="admitted",
            ledger_id=ledger_id,
            request_id=request_id,
            answer_id=None,
            lease_expires_at=lease_expires_at,
            rate_limit_limit=limit,
            rate_limit_remaining=remaining,
            rate_limit_reset=reset_epoch,
        )

    def finalize_success(
        self,
        *,
        ledger_id: int,
        request_id: str,
        answer_id: int,
        now: datetime | None = None,
    ) -> HealthAiRequest:
        """Attach an answer with compare-and-set semantics, without committing.

        The answer and audit must already be pending in this same session. The
        caller commits after this method returns, making all three writes atomic.
        On a stale/terminal claim, pending work is rolled back before rejection.
        """
        current_time = _as_utc(now or datetime.now(timezone.utc))
        with self.db.no_autoflush:
            request_row = (
                self.db.query(HealthAiRequest)
                .filter(HealthAiRequest.id == ledger_id)
                .with_for_update()
                .one_or_none()
            )
        self._assert_matching_claim(
            request_row,
            request_id=request_id,
            now=current_time,
            rollback_pending=True,
        )
        request_row.status = "succeeded"
        request_row.answer_id = answer_id
        request_row.safe_error_code = None
        request_row.safe_http_status = None
        request_row.completed_at = current_time
        request_row.updated_at = current_time
        self.db.flush()
        return request_row

    def finalize_failed(
        self,
        *,
        ledger_id: int,
        request_id: str,
        error_code: str,
        http_status: int,
        now: datetime | None = None,
    ) -> HealthAiRequest:
        """Rollback pending output and durably store only a safe terminal error."""
        self._validate_safe_error(error_code, http_status)
        current_time = _as_utc(now or datetime.now(timezone.utc))
        self.db.rollback()
        request_row = (
            self.db.query(HealthAiRequest)
            .filter(HealthAiRequest.id == ledger_id)
            .with_for_update()
            .one_or_none()
        )
        if request_row is None or request_row.request_id != request_id:
            self.db.rollback()
            raise HealthAiRequestGuardError(
                "health_ai_request_claim_invalid",
                "The health AI request claim is unavailable",
                409,
            )
        if request_row.status == "succeeded":
            self.db.rollback()
            raise HealthAiRequestGuardError(
                "health_ai_request_already_completed",
                "The health AI request has already completed",
                409,
            )
        if request_row.status == "failed":
            self.db.commit()
            return request_row

        if _as_utc(request_row.lease_expires_at) <= current_time:
            error_code = ABANDONED_ERROR_CODE
            http_status = ABANDONED_HTTP_STATUS
        self._set_failed(
            request_row,
            code=error_code,
            http_status=http_status,
            now=current_time,
        )
        self.db.commit()
        return request_row

    def _replay_or_reject(
        self,
        request_row: HealthAiRequest,
        *,
        patient_id: int,
        request_sha256: str,
        now: datetime,
        limit: int,
        window_seconds: int,
    ) -> HealthAiRequestAdmission:
        if (
            request_row.patient_id != patient_id
            or request_row.request_sha256 != request_sha256
        ):
            self.db.rollback()
            raise HealthAiRequestGuardError(
                "health_ai_idempotency_conflict",
                "This Idempotency-Key is already bound to another request",
                409,
            )

        if request_row.status == "in_progress":
            if _as_utc(request_row.lease_expires_at) <= now:
                self._set_failed(
                    request_row,
                    code=ABANDONED_ERROR_CODE,
                    http_status=ABANDONED_HTTP_STATUS,
                    now=now,
                )
                self.db.commit()
                raise HealthAiRequestGuardError(
                    ABANDONED_ERROR_CODE,
                    "The previous health AI request was abandoned",
                    ABANDONED_HTTP_STATUS,
                    headers={"Idempotency-Replayed": "true"},
                )
            retry_after = _seconds_until(request_row.lease_expires_at, now)
            self.db.rollback()
            raise HealthAiRequestGuardError(
                "health_ai_request_in_progress",
                "This health AI request is still being processed",
                409,
                headers={"Retry-After": str(retry_after)},
            )

        if request_row.status == "failed":
            code = request_row.safe_error_code or "health_ai_request_failed"
            status = request_row.safe_http_status or 502
            self.db.rollback()
            raise HealthAiRequestGuardError(
                code,
                "This health AI request previously failed",
                status,
                headers={"Idempotency-Replayed": "true"},
            )

        answer_id = request_row.answer_id
        if answer_id is not None and self.db.get(HealthAiAnswer, answer_id) is None:
            request_row.answer_id = None
            request_row.updated_at = now
            self.db.commit()
            answer_id = None
        if answer_id is None:
            self.db.rollback()
            raise HealthAiRequestGuardError(
                "health_ai_idempotent_result_deleted",
                "The answer for this Idempotency-Key has been deleted",
                410,
                headers={"Idempotency-Replayed": "true"},
            )

        count, reset_epoch, _retry_after = self._budget_state(
            requested_by_user_id=request_row.requested_by_user_id,
            now=now,
            window_seconds=window_seconds,
        )
        ledger_id = request_row.id
        request_id = request_row.request_id
        self.db.commit()
        return HealthAiRequestAdmission(
            disposition="replayed",
            ledger_id=ledger_id,
            request_id=request_id,
            answer_id=answer_id,
            lease_expires_at=None,
            rate_limit_limit=limit,
            rate_limit_remaining=max(0, limit - count),
            rate_limit_reset=reset_epoch,
        )

    def _close_expired_requests(
        self,
        *,
        requested_by_user_id: int,
        now: datetime,
    ) -> list[HealthAiRequest]:
        rows = (
            self.db.query(HealthAiRequest)
            .filter(
                HealthAiRequest.requested_by_user_id == requested_by_user_id,
                HealthAiRequest.status == "in_progress",
            )
            .with_for_update()
            .all()
        )
        active: list[HealthAiRequest] = []
        for row in rows:
            if _as_utc(row.lease_expires_at) <= now:
                self._set_failed(
                    row,
                    code=ABANDONED_ERROR_CODE,
                    http_status=ABANDONED_HTTP_STATUS,
                    now=now,
                )
            else:
                active.append(row)
        self.db.flush()
        return active

    def _budget_state(
        self,
        *,
        requested_by_user_id: int,
        now: datetime,
        window_seconds: int,
    ) -> tuple[int, int, int]:
        window_start = now - timedelta(seconds=window_seconds)
        count = (
            self.db.query(func.count(HealthAiRequest.id))
            .filter(
                HealthAiRequest.requested_by_user_id == requested_by_user_id,
                HealthAiRequest.admitted_at >= window_start,
            )
            .scalar()
            or 0
        )
        oldest = (
            self.db.query(func.min(HealthAiRequest.admitted_at))
            .filter(
                HealthAiRequest.requested_by_user_id == requested_by_user_id,
                HealthAiRequest.admitted_at >= window_start,
            )
            .scalar()
        )
        reset_at = (
            _as_utc(oldest) + timedelta(seconds=window_seconds)
            if oldest is not None
            else now + timedelta(seconds=window_seconds)
        )
        return (
            int(count),
            _epoch_seconds(reset_at),
            _seconds_until(reset_at, now),
        )

    def _assert_matching_claim(
        self,
        request_row: HealthAiRequest | None,
        *,
        request_id: str,
        now: datetime,
        rollback_pending: bool,
    ) -> None:
        if request_row is None or request_row.request_id != request_id:
            if rollback_pending:
                self.db.rollback()
            raise HealthAiRequestGuardError(
                "health_ai_request_claim_invalid",
                "The health AI request claim is unavailable",
                409,
            )
        if request_row.status != "in_progress":
            status = request_row.status
            safe_error_code = request_row.safe_error_code
            safe_http_status = request_row.safe_http_status
            if rollback_pending:
                self.db.rollback()
            raise HealthAiRequestGuardError(
                (
                    "health_ai_request_already_completed"
                    if status == "succeeded"
                    else safe_error_code or "health_ai_request_failed"
                ),
                "The health AI request is no longer active",
                (409 if status == "succeeded" else safe_http_status or 502),
            )
        if _as_utc(request_row.lease_expires_at) <= now:
            ledger_id = request_row.id
            if rollback_pending:
                self.db.rollback()
            self.finalize_failed(
                ledger_id=ledger_id,
                request_id=request_id,
                error_code=ABANDONED_ERROR_CODE,
                http_status=ABANDONED_HTTP_STATUS,
                now=now,
            )
            raise HealthAiRequestGuardError(
                ABANDONED_ERROR_CODE,
                "The health AI request lease expired before completion",
                ABANDONED_HTTP_STATUS,
            )

    @staticmethod
    def _set_failed(
        request_row: HealthAiRequest,
        *,
        code: str,
        http_status: int,
        now: datetime,
    ) -> None:
        request_row.status = "failed"
        request_row.answer_id = None
        request_row.safe_error_code = code
        request_row.safe_http_status = http_status
        request_row.completed_at = now
        request_row.updated_at = now

    @staticmethod
    def _validate_sha256(value: str, *, field_name: str) -> None:
        if not re.fullmatch(r"[0-9a-f]{64}", value):
            raise ValueError(f"{field_name} must be a lowercase SHA-256 digest")

    @staticmethod
    def _validate_safe_error(error_code: str, http_status: int) -> None:
        if not SAFE_ERROR_CODE_PATTERN.fullmatch(error_code):
            raise ValueError("error_code must be a stable health_ai_* identifier")
        if http_status < 400 or http_status > 599:
            raise ValueError("http_status must be between 400 and 599")

    @staticmethod
    def _rate_limit() -> int:
        return max(1, int(settings.HEALTH_AI_RATE_LIMIT_REQUESTS))

    @staticmethod
    def _window_seconds() -> int:
        return max(1, int(settings.HEALTH_AI_RATE_LIMIT_WINDOW_SECONDS))

    @staticmethod
    def _lease_seconds() -> int:
        timeout = max(0.0, float(settings.HEALTH_AI_TIMEOUT_SECONDS))
        grace = max(0, int(settings.HEALTH_AI_LEASE_GRACE_SECONDS))
        maximum = max(1, min(150, int(settings.HEALTH_AI_MAX_LEASE_SECONDS)))
        return max(1, min(maximum, math.ceil(timeout) + grace))


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _seconds_until(later: datetime, now: datetime) -> int:
    delta = (_as_utc(later) - _as_utc(now)).total_seconds()
    return max(1, math.ceil(delta))


def _epoch_seconds(value: datetime) -> int:
    return math.ceil(_as_utc(value).timestamp())
