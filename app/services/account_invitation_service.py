"""Transactional account invitations for invited ordinary household members."""

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.utils.datetime_utils import get_utc_now
from app.core.utils.security import get_password_hash
from app.models.account_invitation import AccountInvitation
from app.models.activity_log import ActionType, ActivityLog, EntityType
from app.models.patient import Patient
from app.models.user import User
from app.services import privacy_consent_service

from app.services.owner_access_service import (  # isort: skip
    OwnerAccessError,
    ensure_sole_active_administrator,
)

ACCOUNT_INVITATION_CONTRACT_VERSION = "household-account-invitation@1.0.0"
ACCOUNT_INVITATION_DEFAULT_TTL_HOURS = 72
ACCOUNT_INVITATION_ALLOWED_TTL_HOURS = (24, 72, 168)
ACCOUNT_INVITATION_MAX_ACCOUNTS = 20
ACCOUNT_INVITATION_GENDERS = {
    "female",
    "male",
    "other",
    "prefer_not_to_say",
}
_KNOWN_WEAK_PASSWORDS = {
    "123",
    "123123",
    "123456",
    "12345678",
    "123456789",
    "1234567890",
    "admin123",
    "password",
    "password123",
    "qwerty123",
}


@dataclass(frozen=True)
class AccountInvitationError(Exception):
    """Stable domain error that never contains secrets or health data."""

    code: str
    message: str
    status_code: int = 400

    def __str__(self) -> str:
        return self.message


@dataclass(frozen=True)
class CreatedAccountInvitation:
    invitation: AccountInvitation
    token: str


@dataclass(frozen=True)
class AccountActivationResult:
    invitation: AccountInvitation
    user: User
    patient: Patient


def hash_invitation_token(token: str) -> str:
    """Return the one-way lookup digest for a random invitation token."""

    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _normalize_single_line(
    value: str,
    *,
    field: str,
    minimum: int,
    maximum: int,
) -> str:
    normalized = (value or "").strip()
    if (
        len(normalized) < minimum
        or len(normalized) > maximum
        or "\n" in normalized
        or "\r" in normalized
    ):
        raise AccountInvitationError(
            f"invalid_{field}",
            f"{field} must contain {minimum} to {maximum} single-line characters",
            422,
        )
    return normalized


def _normalize_username(value: str) -> str:
    normalized = (value or "").strip().lower()
    if (
        len(normalized) < 3
        or len(normalized) > 50
        or not normalized.replace("_", "").replace("-", "").isalnum()
    ):
        raise AccountInvitationError(
            "username_invalid",
            "Username format is invalid",
            422,
        )
    return normalized


def _validate_password(password: str, username: str) -> None:
    encoded = password.encode("utf-8")
    normalized_password = password.casefold()
    normalized_username = username.casefold()
    if (
        len(password) < 10
        or len(encoded) > 72
        or not any(character.isalpha() for character in password)
        or not any(character.isdigit() for character in password)
        or normalized_password in _KNOWN_WEAK_PASSWORDS
        or normalized_username in normalized_password
    ):
        raise AccountInvitationError(
            "password_policy_failed",
            "Password does not meet the invited-member security policy",
            422,
        )


def _validate_birth_date(value: date) -> None:
    if value < date(1900, 1, 1) or value > date.today():
        raise AccountInvitationError(
            "birth_date_invalid",
            "Birth date is outside the supported range",
            422,
        )


class AccountInvitationService:
    """Create, consume, decline, and cancel account invitations."""

    def __init__(self, db: Session):
        self.db = db

    def _ensure_actor(self, actor: User, *, lock: bool = True) -> User:
        try:
            ensure_sole_active_administrator(self.db, actor)
        except OwnerAccessError as error:
            raise AccountInvitationError(
                error.code,
                error.message,
                error.status_code,
            ) from error
        query = self.db.query(User).filter(User.id == actor.id)
        if lock:
            query = query.with_for_update()
        return query.one()

    def _active_account_count(self) -> int:
        return self.db.query(User).filter(User.is_active.is_(True)).count()

    def _pending_invitation_count(self, now: datetime) -> int:
        return (
            self.db.query(AccountInvitation)
            .filter(
                AccountInvitation.status == "pending",
                AccountInvitation.expires_at > now,
            )
            .count()
        )

    def _audit(
        self,
        *,
        action: str,
        invitation: AccountInvitation,
        description: str,
        user_id: int | None,
        patient_id: int | None = None,
        metadata: dict | None = None,
    ) -> None:
        safe_metadata = {
            "invitation_id": invitation.public_id,
            "result": "allowed",
            **(metadata or {}),
        }
        self.db.add(
            ActivityLog.create_activity(
                action=action,
                entity_type=EntityType.ACCOUNT_INVITATION,
                entity_id=invitation.id,
                user_id=user_id,
                patient_id=patient_id,
                description=description,
                metadata=safe_metadata,
            )
        )

    def _commit(self, *, conflict_code: str, conflict_message: str) -> None:
        try:
            self.db.commit()
        except IntegrityError as error:
            self.db.rollback()
            raise AccountInvitationError(
                conflict_code,
                conflict_message,
                409,
            ) from error
        except Exception as error:
            self.db.rollback()
            raise AccountInvitationError(
                "account_invitation_write_failed",
                "Account invitation change could not be completed",
                503,
            ) from error

    def status_for(self, invitation: AccountInvitation) -> str:
        if (
            invitation.status == "pending"
            and _as_utc(invitation.expires_at) <= get_utc_now()
        ):
            return "expired"
        return invitation.status

    def create_invitation(
        self,
        *,
        actor: User,
        recipient_label: str,
        expires_in_hours: int = ACCOUNT_INVITATION_DEFAULT_TTL_HOURS,
    ) -> CreatedAccountInvitation:
        try:
            locked_actor = self._ensure_actor(actor)
            if expires_in_hours not in ACCOUNT_INVITATION_ALLOWED_TTL_HOURS:
                raise AccountInvitationError(
                    "account_invitation_ttl_invalid",
                    "Invitation expiry is invalid",
                    422,
                )
            label = _normalize_single_line(
                recipient_label,
                field="recipient_label",
                minimum=2,
                maximum=100,
            )
            now = get_utc_now()
            if (
                self._active_account_count() + self._pending_invitation_count(now)
                >= ACCOUNT_INVITATION_MAX_ACCOUNTS
            ):
                raise AccountInvitationError(
                    "account_invitation_capacity_reached",
                    "Account invitation capacity has been reached",
                    409,
                )

            token = secrets.token_urlsafe(32)
            invitation = AccountInvitation(
                public_id=str(uuid.uuid4()),
                token_sha256=hash_invitation_token(token),
                created_by_user_id=locked_actor.id,
                recipient_label=label,
                status="pending",
                expires_at=now + timedelta(hours=expires_in_hours),
                created_at=now,
                updated_at=now,
            )
            self.db.add(invitation)
            self.db.flush()
            self._audit(
                action=ActionType.CREATED,
                invitation=invitation,
                user_id=locked_actor.id,
                description="Sole administrator created an account invitation",
                metadata={
                    "operation": "create",
                    "expires_in_hours": expires_in_hours,
                },
            )
            self._commit(
                conflict_code="account_invitation_conflict",
                conflict_message="Account invitation conflicts with existing state",
            )
            self.db.refresh(invitation)
            return CreatedAccountInvitation(invitation=invitation, token=token)
        except AccountInvitationError:
            self.db.rollback()
            raise
        except Exception as error:
            self.db.rollback()
            raise AccountInvitationError(
                "account_invitation_write_failed",
                "Account invitation could not be created",
                503,
            ) from error

    def list_invitations(
        self,
        actor: User,
        *,
        skip: int = 0,
        limit: int = 100,
    ) -> list[AccountInvitation]:
        self._ensure_actor(actor, lock=False)
        return (
            self.db.query(AccountInvitation)
            .order_by(
                AccountInvitation.created_at.desc(),
                AccountInvitation.id.desc(),
            )
            .offset(max(0, skip))
            .limit(min(max(1, limit), 100))
            .all()
        )

    def inspect(self, *, token: str) -> AccountInvitation:
        invitation = (
            self.db.query(AccountInvitation)
            .filter(AccountInvitation.token_sha256 == hash_invitation_token(token))
            .first()
        )
        if invitation is None or self.status_for(invitation) != "pending":
            raise AccountInvitationError(
                "account_invitation_unavailable",
                "Account invitation is unavailable",
                404,
            )
        return invitation

    def cancel(
        self,
        *,
        actor: User,
        public_id: str,
        reason: str,
    ) -> AccountInvitation:
        try:
            locked_actor = self._ensure_actor(actor)
            invitation = (
                self.db.query(AccountInvitation)
                .filter(AccountInvitation.public_id == public_id)
                .with_for_update()
                .first()
            )
            if invitation is None:
                raise AccountInvitationError(
                    "account_invitation_not_found",
                    "Account invitation was not found",
                    404,
                )
            if self.status_for(invitation) != "pending":
                raise AccountInvitationError(
                    "account_invitation_conflict",
                    "Only a pending invitation can be cancelled",
                    409,
                )
            normalized_reason = _normalize_single_line(
                reason,
                field="reason",
                minimum=3,
                maximum=200,
            )
            invitation.status = "cancelled"
            invitation.cancelled_at = get_utc_now()
            self._audit(
                action=ActionType.CANCELLED,
                invitation=invitation,
                user_id=locked_actor.id,
                description="Sole administrator cancelled an account invitation",
                metadata={
                    "operation": "cancel",
                    # The administrator-entered explanation can accidentally
                    # contain personal or health information. Record that a
                    # reason passed validation without copying its contents
                    # into the metadata-only audit stream.
                    "reason_supplied": bool(normalized_reason),
                },
            )
            self._commit(
                conflict_code="account_invitation_conflict",
                conflict_message="Account invitation conflicts with existing state",
            )
            self.db.refresh(invitation)
            return invitation
        except AccountInvitationError:
            self.db.rollback()
            raise
        except Exception as error:
            self.db.rollback()
            raise AccountInvitationError(
                "account_invitation_write_failed",
                "Account invitation could not be cancelled",
                503,
            ) from error

    def decline(self, *, token: str) -> bool:
        try:
            invitation = (
                self.db.query(AccountInvitation)
                .filter(AccountInvitation.token_sha256 == hash_invitation_token(token))
                .with_for_update()
                .first()
            )
            if invitation is None or self.status_for(invitation) != "pending":
                self.db.rollback()
                return False
            invitation.status = "declined"
            invitation.declined_at = get_utc_now()
            self._audit(
                action=ActionType.CANCELLED,
                invitation=invitation,
                user_id=None,
                description="Account invitation was declined by its token holder",
                metadata={"operation": "decline"},
            )
            self._commit(
                conflict_code="account_invitation_conflict",
                conflict_message="Account invitation conflicts with existing state",
            )
            return True
        except AccountInvitationError:
            self.db.rollback()
            return False
        except Exception:
            self.db.rollback()
            return False

    def activate(
        self,
        *,
        token: str,
        username: str,
        display_name: str,
        birth_date: date,
        gender: str,
        password: str,
        privacy_notice_version: str,
        privacy_notice_accepted: bool,
    ) -> AccountActivationResult:
        normalized_username = _normalize_username(username)
        normalized_display_name = _normalize_single_line(
            display_name,
            field="display_name",
            minimum=2,
            maximum=100,
        )
        _validate_birth_date(birth_date)
        if gender not in ACCOUNT_INVITATION_GENDERS:
            raise AccountInvitationError(
                "gender_invalid",
                "Gender value is invalid",
                422,
            )
        _validate_password(password, normalized_username)
        if (
            not privacy_notice_accepted
            or privacy_notice_version
            != privacy_consent_service.HOUSEHOLD_PRIVACY_NOTICE_VERSION
        ):
            raise AccountInvitationError(
                "privacy_notice_version_conflict",
                "Current privacy notice acceptance is required",
                409,
            )

        try:
            invitation = (
                self.db.query(AccountInvitation)
                .filter(AccountInvitation.token_sha256 == hash_invitation_token(token))
                .with_for_update()
                .first()
            )
            if invitation is None or self.status_for(invitation) != "pending":
                raise AccountInvitationError(
                    "account_invitation_unavailable",
                    "Account invitation is unavailable",
                    404,
                )
            self.db.query(User).filter(
                User.id == invitation.created_by_user_id
            ).with_for_update().one()
            if self._active_account_count() >= ACCOUNT_INVITATION_MAX_ACCOUNTS:
                raise AccountInvitationError(
                    "account_capacity_reached",
                    "Account capacity has been reached",
                    409,
                )
            if (
                self.db.query(User).filter(User.username == normalized_username).first()
                is not None
            ):
                raise AccountInvitationError(
                    "username_unavailable",
                    "Username is unavailable",
                    409,
                )

            internal_email = (
                f"invite-{invitation.public_id.replace('-', '')}@household.example"
            )
            new_user = User(
                username=normalized_username,
                email=internal_email,
                password_hash=get_password_hash(password),
                full_name=normalized_display_name,
                role="user",
                auth_method="local",
                must_change_password=False,
                auth_version=1,
                is_active=True,
            )
            self.db.add(new_user)
            self.db.flush()

            patient = Patient(
                user_id=new_user.id,
                owner_user_id=new_user.id,
                is_self_record=True,
                first_name=normalized_display_name,
                last_name="",
                birth_date=birth_date,
                gender=gender,
                address=None,
            )
            self.db.add(patient)
            self.db.flush()
            new_user.active_patient_id = patient.id

            consent, _ = privacy_consent_service.record_decision(
                self.db,
                user_id=new_user.id,
                notice_version=privacy_notice_version,
                decision="accepted",
            )

            now = get_utc_now()
            invitation.status = "activated"
            invitation.activated_user_id = new_user.id
            invitation.activated_at = now
            invitation.activation_notice_version = consent.notice_version
            invitation.activation_notice_sha256 = consent.notice_sha256
            self._audit(
                action=ActionType.ACTIVATED,
                invitation=invitation,
                user_id=new_user.id,
                patient_id=patient.id,
                description="Invited ordinary member activated an account",
                metadata={
                    "operation": "activate",
                    "role": "user",
                    "privacy_notice_version": consent.notice_version,
                    "owned_subject_created": True,
                },
            )
            self.db.commit()
            self.db.refresh(invitation)
            self.db.refresh(new_user)
            self.db.refresh(patient)
            return AccountActivationResult(
                invitation=invitation,
                user=new_user,
                patient=patient,
            )
        except AccountInvitationError:
            self.db.rollback()
            raise
        except IntegrityError as error:
            self.db.rollback()
            if (
                self.db.query(User).filter(User.username == normalized_username).first()
                is not None
            ):
                raise AccountInvitationError(
                    "username_unavailable",
                    "Username is unavailable",
                    409,
                ) from error
            raise AccountInvitationError(
                "account_activation_failed",
                "Account activation could not be completed",
                503,
            ) from error
        except Exception as error:
            self.db.rollback()
            raise AccountInvitationError(
                "account_activation_failed",
                "Account activation could not be completed",
                503,
            ) from error
