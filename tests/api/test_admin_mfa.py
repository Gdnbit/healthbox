"""Administrator-only MFA contract tests.

These tests intentionally use synthetic users and the isolated test database.
They must never depend on the running household deployment.
"""

import json

from jose import jwt
import pyotp
from fastapi.testclient import TestClient
from starlette.requests import Request
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.user import (
    UserMfaChallenge,
    UserMfaCredential,
    UserMfaRecoveryCode,
)


def _password_login(client: TestClient, username: str, password: str):
    return client.post(
        "/api/v1/auth/login",
        data={"username": username, "password": password},
    )


def _enroll_admin(
    client: TestClient,
    username: str = "admin",
    password: str = "adminpassword123",
):
    login_response = _password_login(client, username, password)
    assert login_response.status_code == 200
    login_data = login_response.json()
    assert login_data["status"] == "mfa_enrollment_required"
    assert "access_token" not in login_data

    challenge_token = login_data["challenge_token"]
    setup_response = client.post(
        "/api/v1/auth/mfa/totp/setup",
        json={"challenge_token": challenge_token},
    )
    assert setup_response.status_code == 200
    setup_data = setup_response.json()
    assert setup_data["status"] == "totp_setup_ready"
    assert setup_data["provisioning_uri"].startswith("otpauth://totp/")
    assert "recovery_codes" not in setup_data

    code = pyotp.TOTP(setup_data["manual_key"]).now()
    confirm_response = client.post(
        "/api/v1/auth/mfa/totp/confirm",
        json={"challenge_token": challenge_token, "code": code},
    )
    assert confirm_response.status_code == 200
    return setup_data, confirm_response.json()


def test_ordinary_member_password_login_remains_single_step(
    client: TestClient,
    test_user,
):
    response = _password_login(client, test_user.username, "testpassword123")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "authenticated"
    assert data["access_token"]
    assert "challenge_token" not in data
    assert "mfa" not in data


def test_admin_password_login_returns_only_restricted_enrollment_challenge(
    client: TestClient,
    test_admin_user,
):
    response = _password_login(client, test_admin_user.username, "adminpassword123")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "mfa_enrollment_required"
    assert data["challenge_token"]
    assert "access_token" not in data
    assert settings.AUTH_COOKIE_NAME not in response.cookies

    payload = jwt.decode(
        data["challenge_token"],
        settings.SECRET_KEY,
        algorithms=[settings.ALGORITHM],
    )
    assert payload["token_use"] == "mfa_challenge"
    assert payload["purpose"] == "enroll"

    protected = client.get(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {data['challenge_token']}"},
    )
    assert protected.status_code == 401


def test_administrator_alias_uses_the_same_mfa_gate(
    client: TestClient,
    db_session: Session,
    test_admin_user,
):
    test_admin_user.role = "administrator"
    db_session.commit()

    response = _password_login(client, test_admin_user.username, "adminpassword123")

    assert response.status_code == 200
    assert response.json()["status"] == "mfa_enrollment_required"
    assert "access_token" not in response.json()


def test_administrator_alias_rejects_password_only_access_token(
    client: TestClient,
    db_session: Session,
    test_admin_user,
):
    from app.core.utils.security import create_access_token

    test_admin_user.role = "administrator"
    db_session.commit()
    legacy_token = create_access_token(data={"sub": test_admin_user.username})

    response = client.get(
        "/api/v1/admin/health-ai/settings",
        headers={"Authorization": f"Bearer {legacy_token}"},
    )

    assert response.status_code == 401


def test_admin_totp_enrollment_encrypts_secret_and_returns_recovery_codes_once(
    client: TestClient,
    db_session: Session,
    test_admin_user,
):
    setup_data, confirmed = _enroll_admin(client)

    assert confirmed["status"] == "authenticated"
    assert confirmed["access_token"]
    assert len(confirmed["recovery_codes"]) == 10
    assert len(set(confirmed["recovery_codes"])) == 10

    credential = (
        db_session.query(UserMfaCredential)
        .filter(UserMfaCredential.user_id == test_admin_user.id)
        .one()
    )
    assert credential.is_enabled is True
    assert credential.secret_encrypted != setup_data["manual_key"]
    assert setup_data["manual_key"] not in credential.secret_encrypted

    recovery_rows = (
        db_session.query(UserMfaRecoveryCode)
        .filter(UserMfaRecoveryCode.user_id == test_admin_user.id)
        .all()
    )
    assert len(recovery_rows) == 10
    for plaintext_code in confirmed["recovery_codes"]:
        assert all(plaintext_code not in row.code_hash for row in recovery_rows)

    challenge = (
        db_session.query(UserMfaChallenge)
        .filter(UserMfaChallenge.user_id == test_admin_user.id)
        .one()
    )
    assert challenge.consumed_at is not None


def test_enrolled_admin_needs_totp_and_challenge_cannot_be_replayed(
    client: TestClient,
    db_session: Session,
    test_admin_user,
):
    setup_data, _ = _enroll_admin(client)
    client.cookies.clear()

    login_response = _password_login(client, "admin", "adminpassword123")
    data = login_response.json()
    assert data["status"] == "mfa_required"
    assert "access_token" not in data

    verification = client.post(
        "/api/v1/auth/mfa/verify",
        json={
            "challenge_token": data["challenge_token"],
            "code": pyotp.TOTP(setup_data["manual_key"]).now(),
            "method": "totp",
        },
    )
    assert verification.status_code == 200
    access_token = verification.json()["access_token"]
    access_payload = jwt.decode(
        access_token,
        settings.SECRET_KEY,
        algorithms=[settings.ALGORITHM],
    )
    assert access_payload["token_use"] == "access"
    assert access_payload["mfa_verified"] is True
    assert access_payload["auth_version"] == test_admin_user.auth_version

    replay = client.post(
        "/api/v1/auth/mfa/verify",
        json={
            "challenge_token": data["challenge_token"],
            "code": pyotp.TOTP(setup_data["manual_key"]).now(),
            "method": "totp",
        },
    )
    assert replay.status_code == 401


def test_recovery_code_is_single_use(
    client: TestClient,
    test_admin_user,
):
    _, confirmed = _enroll_admin(client)
    recovery_code = confirmed["recovery_codes"][0]
    client.cookies.clear()

    first_login = _password_login(client, "admin", "adminpassword123").json()
    first_use = client.post(
        "/api/v1/auth/mfa/verify",
        json={
            "challenge_token": first_login["challenge_token"],
            "code": recovery_code,
            "method": "recovery_code",
        },
    )
    assert first_use.status_code == 200

    client.cookies.clear()
    second_login = _password_login(client, "admin", "adminpassword123").json()
    second_use = client.post(
        "/api/v1/auth/mfa/verify",
        json={
            "challenge_token": second_login["challenge_token"],
            "code": recovery_code,
            "method": "recovery_code",
        },
    )
    assert second_use.status_code == 401


def test_legacy_admin_access_token_without_mfa_claim_is_rejected(
    client: TestClient,
    test_admin_user,
):
    from app.core.utils.security import create_access_token

    legacy_token = create_access_token(data={"sub": test_admin_user.username})
    response = client.get(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {legacy_token}"},
    )

    assert response.status_code == 401


def test_admin_sso_first_factor_cannot_bypass_mfa(
    db_session: Session,
    test_admin_user,
):
    from app.api.v1.endpoints.sso import _complete_sso_login

    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/auth/sso/callback",
            "headers": [],
            "client": ("127.0.0.1", 12345),
            "server": ("testserver", 80),
            "scheme": "http",
            "query_string": b"",
        }
    )
    response = _complete_sso_login(
        {"user": test_admin_user, "is_new_user": False},
        request,
        db_session,
        log_event_name="test",
        activity_description="test",
    )
    data = json.loads(response.body)

    assert data["status"] == "mfa_enrollment_required"
    assert "challenge_token" in data
    assert "access_token" not in data
    assert settings.AUTH_COOKIE_NAME not in response.headers.get("set-cookie", "")


def test_admin_password_change_revokes_the_current_session(
    client: TestClient,
    test_admin_user,
):
    _, confirmed = _enroll_admin(client)
    access_token = confirmed["access_token"]

    changed = client.post(
        "/api/v1/auth/change-password",
        json={
            "currentPassword": "adminpassword123",
            "newPassword": "newadminpassword456",
        },
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert changed.status_code == 200

    after_change = client.get(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert after_change.status_code == 401


def test_overlong_recovery_code_is_rejected_without_server_error(
    client: TestClient,
    test_admin_user,
):
    _enroll_admin(client)
    client.cookies.clear()
    login_data = _password_login(client, "admin", "adminpassword123").json()

    response = client.post(
        "/api/v1/auth/mfa/verify",
        json={
            "challenge_token": login_data["challenge_token"],
            "code": "A" * 200,
            "method": "recovery_code",
        },
    )
    assert response.status_code == 422


def test_five_invalid_totp_attempts_consume_the_challenge(
    client: TestClient,
    db_session: Session,
    test_admin_user,
):
    setup, _ = _enroll_admin(client)
    secret = setup["manual_key"]
    client.cookies.clear()
    login_data = _password_login(client, "admin", "adminpassword123").json()
    current_code = pyotp.TOTP(secret).now()
    invalid_code = "000000" if current_code != "000000" else "000001"

    for _ in range(5):
        response = client.post(
            "/api/v1/auth/mfa/verify",
            json={
                "challenge_token": login_data["challenge_token"],
                "code": invalid_code,
                "method": "totp",
            },
        )
        assert response.status_code == 401

    challenge = (
        db_session.query(UserMfaChallenge).order_by(UserMfaChallenge.id.desc()).first()
    )
    db_session.refresh(challenge)
    assert challenge.attempt_count == 5
    assert challenge.consumed_at is not None

    rejected = client.post(
        "/api/v1/auth/mfa/verify",
        json={
            "challenge_token": login_data["challenge_token"],
            "code": pyotp.TOTP(secret).now(),
            "method": "totp",
        },
    )
    assert rejected.status_code == 401
