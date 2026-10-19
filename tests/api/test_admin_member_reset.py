"""Sole-administrator one-time ordinary-member reset contract tests."""

from datetime import timedelta

from app.core.utils.datetime_utils import get_utc_now
from app.core.utils.security import create_access_token
from app.models.activity_log import ActivityLog

RESET_PATH_TEMPLATE = "/api/v1/admin/user-management/users/{user_id}/reset-access"


def _reset_member(client, headers, user_id: int, username: str):
    return client.post(
        RESET_PATH_TEMPLATE.format(user_id=user_id),
        json={
            "confirm_username": username,
            "reason": "成员联系管理员申请恢复访问",
        },
        headers=headers,
    )


def test_admin_reset_is_server_generated_one_time_and_revokes_old_sessions(
    client,
    db_session,
    admin_token_headers,
    test_admin_user,
    test_user,
):
    old_token = create_access_token(
        data={
            "sub": test_user.username,
            "token_use": "access",
            "auth_version": test_user.auth_version,
            "mfa_verified": False,
        }
    )
    old_headers = {"Authorization": f"Bearer {old_token}"}
    previous_version = test_user.auth_version

    response = _reset_member(
        client,
        admin_token_headers,
        test_user.id,
        test_user.username,
    )

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    payload = response.json()
    temporary_password = payload.pop("temporary_password")
    assert len(temporary_password) >= 16
    assert payload == {
        "target_user_id": test_user.id,
        "target_username": test_user.username,
        "expires_at": payload["expires_at"],
        "must_change_password": True,
        "sessions_revoked": True,
        "result": "success",
    }

    db_session.refresh(test_user)
    assert test_user.auth_version == previous_version + 1
    assert test_user.must_change_password is True
    assert test_user.password_reset_expires_at is not None
    assert test_user.password_reset_consumed_at is None
    assert client.get("/api/v1/users/me", headers=old_headers).status_code == 401

    audit = (
        db_session.query(ActivityLog)
        .filter(
            ActivityLog.action == "updated",
            ActivityLog.entity_type == "user",
            ActivityLog.entity_id == test_user.id,
            ActivityLog.user_id == test_admin_user.id,
        )
        .order_by(ActivityLog.id.desc())
        .first()
    )
    assert audit is not None
    assert audit.event_metadata["source"] == "admin_member_access_reset"
    assert audit.event_metadata["sessions_revoked"] is True
    audit_text = str(audit.event_metadata)
    assert temporary_password not in audit_text
    for forbidden_key in (
        "temporary_password",
        "password_hash",
        "access_token",
        "health_values",
        "target_username",
    ):
        assert forbidden_key not in audit.event_metadata

    first_login = client.post(
        "/api/v1/auth/login",
        data={"username": test_user.username, "password": temporary_password},
    )
    assert first_login.status_code == 200
    assert first_login.json()["must_change_password"] is True
    reset_token = first_login.json()["access_token"]

    second_login = client.post(
        "/api/v1/auth/login",
        data={"username": test_user.username, "password": temporary_password},
    )
    assert second_login.status_code == 401

    reset_headers = {"Authorization": f"Bearer {reset_token}"}
    assert client.get("/api/v1/users/me", headers=reset_headers).status_code == 200
    assert client.get("/api/v1/vitals/", headers=reset_headers).status_code == 403

    new_password = "MemberChosenPassword456"
    changed = client.post(
        "/api/v1/auth/change-password",
        json={
            "currentPassword": temporary_password,
            "newPassword": new_password,
        },
        headers=reset_headers,
    )
    assert changed.status_code == 200

    db_session.refresh(test_user)
    assert test_user.must_change_password is False
    assert test_user.password_reset_expires_at is None
    assert test_user.password_reset_consumed_at is None
    assert client.get("/api/v1/users/me", headers=reset_headers).status_code == 401
    assert (
        client.post(
            "/api/v1/auth/login",
            data={"username": test_user.username, "password": temporary_password},
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/v1/auth/login",
            data={"username": test_user.username, "password": new_password},
        ).status_code
        == 200
    )


def test_expired_temporary_password_is_rejected(
    client,
    db_session,
    admin_token_headers,
    test_user,
):
    response = _reset_member(
        client,
        admin_token_headers,
        test_user.id,
        test_user.username,
    )
    temporary_password = response.json()["temporary_password"]
    db_session.refresh(test_user)
    test_user.password_reset_expires_at = get_utc_now() - timedelta(minutes=1)
    test_user.password_reset_consumed_at = None
    db_session.commit()

    login = client.post(
        "/api/v1/auth/login",
        data={"username": test_user.username, "password": temporary_password},
    )
    assert login.status_code == 401


def test_member_reset_rejects_wrong_confirmation_without_mutation(
    client,
    db_session,
    admin_token_headers,
    test_user,
):
    previous_hash = test_user.password_hash
    previous_version = test_user.auth_version
    response = _reset_member(
        client,
        admin_token_headers,
        test_user.id,
        "wrong-user",
    )
    assert response.status_code == 409
    db_session.refresh(test_user)
    assert test_user.password_hash == previous_hash
    assert test_user.auth_version == previous_version


def test_member_reset_refuses_administrator_and_inactive_member(
    client,
    db_session,
    admin_token_headers,
    test_admin_user,
    test_user,
):
    admin_response = _reset_member(
        client,
        admin_token_headers,
        test_admin_user.id,
        test_admin_user.username,
    )
    assert admin_response.status_code == 400

    test_user.is_active = False
    db_session.commit()
    inactive_response = _reset_member(
        client,
        admin_token_headers,
        test_user.id,
        test_user.username,
    )
    assert inactive_response.status_code == 409


def test_ordinary_member_cannot_reset_access(
    client,
    user_token_headers,
    test_user,
):
    response = _reset_member(
        client,
        user_token_headers,
        test_user.id,
        test_user.username,
    )
    assert response.status_code in (401, 403)


def test_legacy_arbitrary_password_reset_endpoint_fails_closed(
    client,
    admin_token_headers,
    test_user,
):
    response = client.post(
        f"/api/v1/admin/models/users/{test_user.id}/reset-password",
        json={"new_password": "ArbitraryPassword123"},
        headers=admin_token_headers,
    )
    assert response.status_code == 410
