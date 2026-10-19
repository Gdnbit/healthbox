"""Administrator-only TOTP and recovery-code services.

No method in this module logs or returns a password, TOTP value, recovery code
hash, encrypted secret, or challenge token. Public response shaping stays in
the authentication endpoints.
"""

from base64 import urlsafe_b64encode
from datetime import datetime, timedelta, timezone
import hashlib
import secrets
from typing import Literal

import bcrypt
from cryptography.fernet import Fernet, InvalidToken
from jose import JWTError, jwt
import pyotp
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.constants import is_admin_role
from app.core.utils.security import create_access_token
from app.models.base import get_utc_now
from app.models.user import (
    User,
    UserMfaChallenge,
    UserMfaCredential,
    UserMfaRecoveryCode,
)

MFA_CHALLENGE_TTL_MINUTES = 5
MFA_MAX_ATTEMPTS = 5
RECOVERY_CODE_COUNT = 10


class MfaError(Exception):
    """Generic client-safe MFA failure."""


def _fernet() -> Fernet:
    material = f"{settings.SECRET_KEY}:family-health-records:admin-mfa:v1".encode(
        "utf-8"
    )
    key = urlsafe_b64encode(hashlib.sha256(material).digest())
    return Fernet(key)


def encrypt_totp_secret(secret: str) -> str:
    return _fernet().encrypt(secret.encode("ascii")).decode("ascii")


def decrypt_totp_secret(encrypted_secret: str) -> str:
    try:
        return _fernet().decrypt(encrypted_secret.encode("ascii")).decode("ascii")
    except (InvalidToken, UnicodeError) as exc:
        raise MfaError("MFA verification failed") from exc


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def issue_challenge(
    db: Session,
    db_user: User,
    purpose: Literal["enroll", "verify"],
) -> str:
    """Persist and sign one active five-minute challenge for an administrator."""
    now = get_utc_now()
    (
        db.query(UserMfaChallenge)
        .filter(
            UserMfaChallenge.user_id == db_user.id,
            UserMfaChallenge.consumed_at.is_(None),
        )
        .update({UserMfaChallenge.consumed_at: now}, synchronize_session=False)
    )
    challenge_id = secrets.token_urlsafe(32)
    row = UserMfaChallenge(
        challenge_id=challenge_id,
        user_id=db_user.id,
        purpose=purpose,
        expires_at=now + timedelta(minutes=MFA_CHALLENGE_TTL_MINUTES),
    )
    db.add(row)
    db.commit()
    return create_access_token(
        data={
            "sub": db_user.username,
            "user_id": db_user.id,
            "token_use": "mfa_challenge",
            "purpose": purpose,
            "challenge_id": challenge_id,
            "auth_version": db_user.auth_version,
        },
        expires_delta=timedelta(minutes=MFA_CHALLENGE_TTL_MINUTES),
    )


def validate_challenge(
    db: Session,
    challenge_token: str,
    expected_purpose: Literal["enroll", "verify"] | None = None,
) -> tuple[User, UserMfaChallenge]:
    try:
        payload = jwt.decode(
            challenge_token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
        )
    except JWTError as exc:
        raise MfaError("MFA verification failed") from exc

    if payload.get("token_use") != "mfa_challenge":
        raise MfaError("MFA verification failed")
    purpose = payload.get("purpose")
    if expected_purpose is not None and purpose != expected_purpose:
        raise MfaError("MFA verification failed")

    row = (
        db.query(UserMfaChallenge)
        .filter(UserMfaChallenge.challenge_id == payload.get("challenge_id"))
        .one_or_none()
    )
    if (
        row is None
        or row.consumed_at is not None
        or _aware_utc(row.expires_at) <= get_utc_now()
        or row.purpose != purpose
    ):
        raise MfaError("MFA verification failed")

    db_user = db.query(User).filter(User.id == row.user_id).one_or_none()
    if (
        db_user is None
        or not db_user.is_active
        or not is_admin_role(db_user.role)
        or payload.get("sub") != db_user.username
        or payload.get("auth_version") != db_user.auth_version
    ):
        raise MfaError("MFA verification failed")
    return db_user, row


def prepare_totp_enrollment(db: Session, db_user: User) -> tuple[str, str]:
    """Create or rotate the pending encrypted secret for an enrollment challenge."""
    secret = pyotp.random_base32()
    credential = (
        db.query(UserMfaCredential)
        .filter(UserMfaCredential.user_id == db_user.id)
        .one_or_none()
    )
    if credential is None:
        credential = UserMfaCredential(
            user_id=db_user.id,
            method="totp",
            secret_encrypted=encrypt_totp_secret(secret),
            is_enabled=False,
        )
        db.add(credential)
    elif not credential.is_enabled:
        credential.secret_encrypted = encrypt_totp_secret(secret)
        credential.updated_at = get_utc_now()
    else:
        raise MfaError("MFA verification failed")
    db.commit()

    issuer = "HealthBox"
    uri = pyotp.TOTP(secret).provisioning_uri(
        name=db_user.username,
        issuer_name=issuer,
    )
    return secret, uri


def _record_failed_attempt(db: Session, challenge: UserMfaChallenge) -> None:
    # Serialize failures for the same challenge so concurrent invalid requests
    # cannot overwrite one another's counters and extend the attempt budget.
    locked_challenge = (
        db.query(UserMfaChallenge)
        .filter(
            UserMfaChallenge.id == challenge.id,
            UserMfaChallenge.consumed_at.is_(None),
        )
        .populate_existing()
        .with_for_update()
        .one_or_none()
    )
    if locked_challenge is None:
        db.rollback()
        raise MfaError("MFA verification failed")
    locked_challenge.attempt_count += 1
    if locked_challenge.attempt_count >= MFA_MAX_ATTEMPTS:
        locked_challenge.consumed_at = get_utc_now()
    db.commit()


def _consume_challenge(db: Session, challenge: UserMfaChallenge) -> None:
    changed = (
        db.query(UserMfaChallenge)
        .filter(
            UserMfaChallenge.id == challenge.id,
            UserMfaChallenge.consumed_at.is_(None),
        )
        .update(
            {UserMfaChallenge.consumed_at: get_utc_now()},
            synchronize_session=False,
        )
    )
    if changed != 1:
        raise MfaError("MFA verification failed")


def confirm_totp_enrollment(
    db: Session,
    db_user: User,
    challenge: UserMfaChallenge,
    code: str,
) -> list[str]:
    credential = (
        db.query(UserMfaCredential)
        .filter(UserMfaCredential.user_id == db_user.id)
        .one_or_none()
    )
    if credential is None or credential.is_enabled:
        raise MfaError("MFA verification failed")
    secret = decrypt_totp_secret(credential.secret_encrypted)
    if not pyotp.TOTP(secret).verify(code.strip(), valid_window=1):
        _record_failed_attempt(db, challenge)
        raise MfaError("MFA verification failed")

    recovery_codes = [generate_recovery_code() for _ in range(RECOVERY_CODE_COUNT)]
    db.query(UserMfaRecoveryCode).filter(
        UserMfaRecoveryCode.user_id == db_user.id
    ).delete(synchronize_session=False)
    for plaintext in recovery_codes:
        db.add(
            UserMfaRecoveryCode(
                user_id=db_user.id,
                code_hash=bcrypt.hashpw(
                    plaintext.encode("ascii"), bcrypt.gensalt()
                ).decode("ascii"),
            )
        )

    now = get_utc_now()
    credential.is_enabled = True
    credential.confirmed_at = now
    credential.updated_at = now
    db_user.auth_version += 1
    _consume_challenge(db, challenge)
    db.commit()
    db.refresh(db_user)
    return recovery_codes


def generate_recovery_code() -> str:
    raw = secrets.token_hex(8).upper()
    return "-".join(raw[index : index + 4] for index in range(0, len(raw), 4))


def verify_totp(
    db: Session,
    db_user: User,
    challenge: UserMfaChallenge,
    code: str,
) -> None:
    credential = (
        db.query(UserMfaCredential)
        .filter(
            UserMfaCredential.user_id == db_user.id,
            UserMfaCredential.is_enabled.is_(True),
        )
        .one_or_none()
    )
    if credential is None:
        raise MfaError("MFA verification failed")
    secret = decrypt_totp_secret(credential.secret_encrypted)
    if not pyotp.TOTP(secret).verify(code.strip(), valid_window=1):
        _record_failed_attempt(db, challenge)
        raise MfaError("MFA verification failed")
    _consume_challenge(db, challenge)
    db.commit()


def verify_recovery_code(
    db: Session,
    db_user: User,
    challenge: UserMfaChallenge,
    code: str,
) -> None:
    matched = None
    normalized = code.strip().upper()
    for row in (
        db.query(UserMfaRecoveryCode)
        .filter(
            UserMfaRecoveryCode.user_id == db_user.id,
            UserMfaRecoveryCode.used_at.is_(None),
        )
        .all()
    ):
        if bcrypt.checkpw(normalized.encode("ascii"), row.code_hash.encode("ascii")):
            matched = row
            break
    if matched is None:
        _record_failed_attempt(db, challenge)
        raise MfaError("MFA verification failed")

    changed = (
        db.query(UserMfaRecoveryCode)
        .filter(
            UserMfaRecoveryCode.id == matched.id,
            UserMfaRecoveryCode.used_at.is_(None),
        )
        .update(
            {UserMfaRecoveryCode.used_at: get_utc_now()},
            synchronize_session=False,
        )
    )
    if changed != 1:
        db.rollback()
        raise MfaError("MFA verification failed")
    _consume_challenge(db, challenge)
    db.commit()


def has_enabled_totp(db: Session, user_id: int) -> bool:
    return (
        db.query(UserMfaCredential)
        .filter(
            UserMfaCredential.user_id == user_id,
            UserMfaCredential.is_enabled.is_(True),
        )
        .count()
        == 1
    )
