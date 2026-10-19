"""Public and administrator API tests for invited household accounts."""

import pytest

from app.api.v1.admin import account_invitations as admin_invitation_api
from app.api.v1.endpoints import account_invitations as public_invitation_api
from app.core.rate_limit import InProcessRateLimiter
from app.models.account_invitation import AccountInvitation
from app.models.archive_circle import ArchiveCircleMembership
from app.models.patient import Patient
from app.models.user import User
from app.services import privacy_consent_service


@pytest.fixture(autouse=True)
def reset_invitation_limiters():
    limiters = (
        admin_invitation_api.admin_invitation_mutation_limiter,
        public_invitation_api.public_invitation_inspect_limiter,
        public_invitation_api.public_invitation_activate_limiter,
        public_invitation_api.public_invitation_decline_limiter,
    )
    for limiter in limiters:
        limiter.reset()
    yield
    for limiter in limiters:
        limiter.reset()


def _create_invitation(admin_client, label: str = "虚构 API 受邀者") -> dict:
    response = admin_client.post(
        "/api/v1/admin/account-invitations",
        json={
            "recipient_label": label,
            "expires_in_hours": 72,
        },
    )
    assert response.status_code == 201, response.text
    assert response.headers["cache-control"] == "no-store"
    return response.json()


def _token_from_path(path: str) -> str:
    prefix = "/activate#token="
    assert path.startswith(prefix)
    return path.removeprefix(prefix)


def _activation_json(token: str, suffix: str = "api") -> dict:
    return {
        "token": token,
        "username": f"invited{suffix}",
        "display_name": f"虚构成员{suffix}",
        "birth_date": "1993-06-18",
        "gender": "female",
        "password": f"SecureInvitedPassword{suffix}9",
        "privacy_notice_version": (
            privacy_consent_service.HOUSEHOLD_PRIVACY_NOTICE_VERSION
        ),
        "privacy_notice_accepted": True,
    }


def test_admin_create_list_and_cancel_never_return_secret_again(
    admin_client,
    db_session,
):
    created = _create_invitation(admin_client)
    token = _token_from_path(created["activation_path"])
    assert created["contract_version"] == "household-account-invitation@1.0.0"
    assert created["invitation"]["status"] == "pending"

    listing = admin_client.get("/api/v1/admin/account-invitations")
    assert listing.status_code == 200, listing.text
    assert listing.headers["cache-control"] == "no-store"
    body = listing.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["id"] == created["invitation"]["id"]
    assert "activation_path" not in body["items"][0]
    assert token not in listing.text
    assert "token_sha256" not in listing.text

    cancelled = admin_client.post(
        ("/api/v1/admin/account-invitations/" f"{created['invitation']['id']}/cancel"),
        json={"reason": "虚构成员暂时不加入"},
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"

    db_session.expire_all()
    row = db_session.query(AccountInvitation).one()
    assert row.status == "cancelled"
    assert token not in row.token_sha256


def test_ordinary_member_cannot_use_admin_invitation_endpoints(
    client,
    user_token_headers,
    test_user,
):
    response = client.post(
        "/api/v1/admin/account-invitations",
        headers=user_token_headers,
        json={"recipient_label": "不应创建", "expires_in_hours": 72},
    )
    assert response.status_code in {401, 403}

    listing = client.get(
        "/api/v1/admin/account-invitations",
        headers=user_token_headers,
    )
    assert listing.status_code in {401, 403}


def test_public_inspect_and_activate_return_minimum_fields(
    admin_client,
    client,
    db_session,
):
    created = _create_invitation(admin_client, "仅管理员可见标签")
    token = _token_from_path(created["activation_path"])

    inspected = client.post(
        "/api/v1/account-invitations/inspect",
        json={"token": token},
    )
    assert inspected.status_code == 200, inspected.text
    assert inspected.headers["cache-control"] == "no-store"
    notice = inspected.json()
    assert notice["valid"] is True
    assert notice["privacy_notice"]["locale"] == "zh-CN"
    assert (
        notice["privacy_notice"]["notice_version"]
        == privacy_consent_service.HOUSEHOLD_PRIVACY_NOTICE_VERSION
    )
    rendered = inspected.text
    for forbidden in (
        "仅管理员可见标签",
        "admin@example.com",
        "archive_circle",
        "patient_id",
        "token_sha256",
    ):
        assert forbidden not in rendered

    activated = client.post(
        "/api/v1/account-invitations/activate",
        json=_activation_json(token),
    )
    assert activated.status_code == 201, activated.text
    assert activated.headers["cache-control"] == "no-store"
    assert activated.json() == {
        "contract_version": "household-account-invitation@1.0.0",
        "status": "activated",
        "username": "invitedapi",
        "display_name": "虚构成员api",
        "login_path": "/login",
    }
    assert "access_token" not in activated.text
    assert "patient_id" not in activated.text
    assert "email" not in activated.text

    user = db_session.query(User).filter(User.username == "invitedapi").one()
    patient = db_session.query(Patient).filter(Patient.owner_user_id == user.id).one()
    assert user.active_patient_id == patient.id
    assert db_session.query(ArchiveCircleMembership).count() == 0

    login = client.post(
        "/api/v1/auth/login",
        data={
            "username": "invitedapi",
            "password": "SecureInvitedPasswordapi9",
        },
    )
    assert login.status_code == 200, login.text
    me = client.get(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
    )
    assert me.status_code == 200, me.text
    assert me.json()["email"].endswith("@household.example")


def test_public_invalid_terminal_states_share_one_error(
    admin_client,
    client,
):
    created = _create_invitation(admin_client)
    token = _token_from_path(created["activation_path"])

    first = client.post(
        "/api/v1/account-invitations/activate",
        json=_activation_json(token, "once"),
    )
    assert first.status_code == 201, first.text

    replay = client.post(
        "/api/v1/account-invitations/activate",
        json=_activation_json(token, "twice"),
    )
    unknown = client.post(
        "/api/v1/account-invitations/activate",
        json=_activation_json("synthetic-unknown-token-value", "unknown"),
    )
    inspect_replay = client.post(
        "/api/v1/account-invitations/inspect",
        json={"token": token},
    )

    assert (
        replay.status_code == unknown.status_code == inspect_replay.status_code == 404
    )
    assert replay.json() == unknown.json() == inspect_replay.json()
    assert "account_invitation_unavailable" in replay.text


def test_public_decline_is_generic_and_never_creates_account(
    admin_client,
    client,
    db_session,
):
    created = _create_invitation(admin_client)
    token = _token_from_path(created["activation_path"])

    first = client.post(
        "/api/v1/account-invitations/decline",
        json={"token": token},
    )
    replay = client.post(
        "/api/v1/account-invitations/decline",
        json={"token": token},
    )
    unknown = client.post(
        "/api/v1/account-invitations/decline",
        json={"token": "synthetic-unknown-token-value"},
    )

    assert first.status_code == replay.status_code == unknown.status_code == 204
    db_session.expire_all()
    assert db_session.query(AccountInvitation).one().status == "declined"
    assert db_session.query(User).count() == 1
    assert db_session.query(Patient).count() == 0


def test_activation_rejects_privacy_version_change_and_extra_privilege_fields(
    admin_client,
    client,
    db_session,
):
    created = _create_invitation(admin_client)
    token = _token_from_path(created["activation_path"])
    payload = _activation_json(token, "guarded")
    payload["privacy_notice_version"] = "stale-notice@0"

    stale = client.post(
        "/api/v1/account-invitations/activate",
        json=payload,
    )
    assert stale.status_code in {409, 422}
    assert "privacy_notice_version_conflict" in stale.text
    assert db_session.query(User).count() == 1
    assert db_session.query(Patient).count() == 0

    payload = _activation_json(token, "guarded")
    payload["role"] = "admin"
    extra = client.post(
        "/api/v1/account-invitations/activate",
        json=payload,
    )
    assert extra.status_code == 422
    assert db_session.query(User).count() == 1


def test_public_and_admin_invitation_rate_limits_are_stable(
    admin_client,
    client,
    monkeypatch,
):
    public_limiter = InProcessRateLimiter(max_requests=2, window_seconds=60)
    admin_limiter = InProcessRateLimiter(max_requests=1, window_seconds=60)
    monkeypatch.setattr(
        public_invitation_api,
        "public_invitation_inspect_limiter",
        public_limiter,
    )
    monkeypatch.setattr(
        admin_invitation_api,
        "admin_invitation_mutation_limiter",
        admin_limiter,
    )

    for _ in range(2):
        unavailable = client.post(
            "/api/v1/account-invitations/inspect",
            json={"token": "synthetic-rate-limit-token"},
        )
        assert unavailable.status_code == 404

    public_limited = client.post(
        "/api/v1/account-invitations/inspect",
        json={"token": "synthetic-rate-limit-token"},
    )
    assert public_limited.status_code == 429
    assert public_limited.json()["error_code"] == "rate_limit_exceeded"
    assert int(public_limited.headers["retry-after"]) >= 1
    assert public_limited.headers["cache-control"] == "no-store"

    created = admin_client.post(
        "/api/v1/admin/account-invitations",
        json={"recipient_label": "虚构限速一", "expires_in_hours": 72},
    )
    assert created.status_code == 201
    admin_limited = admin_client.post(
        "/api/v1/admin/account-invitations",
        json={"recipient_label": "虚构限速二", "expires_in_hours": 72},
    )
    assert admin_limited.status_code == 429
    assert admin_limited.json()["error_code"] == "rate_limit_exceeded"
    assert int(admin_limited.headers["retry-after"]) >= 1
    assert admin_limited.headers["cache-control"] == "no-store"


def test_validation_errors_do_not_log_invitation_secrets(
    client,
    caplog,
):
    raw_token = "synthetic-secret-token-must-not-appear"
    raw_password = "SyntheticSecretPassword9"
    raw_birth_date = "1999-09-09"

    response = client.post(
        "/api/v1/account-invitations/activate",
        json={
            "token": raw_token,
            "username": "bad username!",
            "display_name": "虚构成员",
            "birth_date": raw_birth_date,
            "gender": "female",
            "password": raw_password,
            "privacy_notice_version": "stale",
            "privacy_notice_accepted": True,
            "role": "admin",
        },
    )
    assert response.status_code == 422

    rendered_records = "\n".join(
        f"{record.getMessage()} {getattr(record, 'validation_errors', '')}"
        for record in caplog.records
    )
    assert raw_token not in rendered_records
    assert raw_password not in rendered_records
    assert raw_birth_date not in rendered_records
