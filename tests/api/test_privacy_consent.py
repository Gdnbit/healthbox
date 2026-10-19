from app.core.config import settings
from app.models.user import UserPrivacyConsent
from app.services.privacy_consent_service import (
    HOUSEHOLD_PRIVACY_NOTICE_VERSION,
)
from tests.utils.user import create_user_authentication_headers


def _headers(client):
    return create_user_authentication_headers(
        client=client,
        username="testuser",
        password="testpassword123",
    )


def test_current_notice_requires_versioned_consent_before_business_access(
    client,
    test_user,
    monkeypatch,
):
    monkeypatch.setattr(settings, "HOUSEHOLD_PRIVACY_CONSENT_REQUIRED", True)
    headers = _headers(client)

    me_response = client.get("/api/v1/users/me", headers=headers)
    assert me_response.status_code == 200
    assert me_response.json()["privacy_consent_required"] is True

    notice_response = client.get("/api/v1/privacy-consent/current", headers=headers)
    assert notice_response.status_code == 200
    notice = notice_response.json()
    assert notice["notice_version"] == HOUSEHOLD_PRIVACY_NOTICE_VERSION
    assert notice["locale"] == "zh-CN"
    assert notice["required"] is True
    assert notice["accepted"] is False
    assert notice["latest_decision"] is None
    section_keys = {section["key"] for section in notice["sections"]}
    assert {
        "operator_and_purpose",
        "data_and_retention",
        "sole_admin_global_read",
        "reciprocal_structured_dashboard",
        "not_shared_by_default",
        "external_processing_separate",
        "rights_and_exit",
    }.issubset(section_keys)
    assert notice["external_processing_consent_included"] is False

    blocked = client.get("/api/v1/users/me/preferences", headers=headers)
    assert blocked.status_code == 403
    assert "consent" in str(blocked.json()).lower()


def test_accepting_current_notice_unlocks_business_access_and_persists_scope(
    client,
    db_session,
    test_user,
    monkeypatch,
):
    monkeypatch.setattr(settings, "HOUSEHOLD_PRIVACY_CONSENT_REQUIRED", True)
    headers = _headers(client)

    response = client.post(
        "/api/v1/privacy-consent/decisions",
        headers=headers,
        json={
            "notice_version": HOUSEHOLD_PRIVACY_NOTICE_VERSION,
            "decision": "accepted",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["decision"] == "accepted"
    assert body["privacy_consent_required"] is False
    assert body["notice_version"] == HOUSEHOLD_PRIVACY_NOTICE_VERSION
    assert body["decided_at"]

    row = db_session.query(UserPrivacyConsent).one()
    assert row.user_id == test_user.id
    assert row.notice_version == HOUSEHOLD_PRIVACY_NOTICE_VERSION
    assert row.notice_locale == "zh-CN"
    assert row.decision == "accepted"
    assert len(row.notice_sha256) == 64
    assert row.scope_snapshot["external_processing"] == "separate_confirmation_required"
    assert "health_values" not in row.scope_snapshot

    me_response = client.get("/api/v1/users/me", headers=headers)
    assert me_response.status_code == 200
    assert me_response.json()["privacy_consent_required"] is False
    assert (
        client.get("/api/v1/users/me/preferences", headers=headers).status_code == 200
    )


def test_declining_notice_is_recorded_but_keeps_business_access_blocked(
    client,
    db_session,
    test_user,
    monkeypatch,
):
    monkeypatch.setattr(settings, "HOUSEHOLD_PRIVACY_CONSENT_REQUIRED", True)
    headers = _headers(client)

    response = client.post(
        "/api/v1/privacy-consent/decisions",
        headers=headers,
        json={
            "notice_version": HOUSEHOLD_PRIVACY_NOTICE_VERSION,
            "decision": "declined",
        },
    )

    assert response.status_code == 200
    assert response.json()["privacy_consent_required"] is True
    assert db_session.query(UserPrivacyConsent).one().decision == "declined"
    assert (
        client.get("/api/v1/users/me/preferences", headers=headers).status_code == 403
    )


def test_repeated_same_decision_is_idempotent(
    client,
    db_session,
    test_user,
    monkeypatch,
):
    monkeypatch.setattr(settings, "HOUSEHOLD_PRIVACY_CONSENT_REQUIRED", True)
    headers = _headers(client)
    payload = {
        "notice_version": HOUSEHOLD_PRIVACY_NOTICE_VERSION,
        "decision": "accepted",
    }

    first = client.post(
        "/api/v1/privacy-consent/decisions",
        headers=headers,
        json=payload,
    )
    second = client.post(
        "/api/v1/privacy-consent/decisions",
        headers=headers,
        json=payload,
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert db_session.query(UserPrivacyConsent).count() == 1


def test_stale_or_unknown_notice_version_is_rejected_without_a_record(
    client,
    db_session,
    test_user,
    monkeypatch,
):
    monkeypatch.setattr(settings, "HOUSEHOLD_PRIVACY_CONSENT_REQUIRED", True)
    headers = _headers(client)

    response = client.post(
        "/api/v1/privacy-consent/decisions",
        headers=headers,
        json={
            "notice_version": "household-privacy-notice@0.9.0",
            "decision": "accepted",
        },
    )

    assert response.status_code == 409
    assert db_session.query(UserPrivacyConsent).count() == 0


def test_forced_password_change_takes_precedence_over_consent(
    client,
    db_session,
    test_user,
    monkeypatch,
):
    monkeypatch.setattr(settings, "HOUSEHOLD_PRIVACY_CONSENT_REQUIRED", True)
    test_user.must_change_password = True
    db_session.commit()
    headers = _headers(client)

    assert (
        client.get("/api/v1/privacy-consent/current", headers=headers).status_code
        == 403
    )
    assert client.get("/api/v1/users/me", headers=headers).status_code == 200


def test_forced_password_change_remains_available_before_privacy_consent(
    client,
    db_session,
    test_user,
    monkeypatch,
):
    monkeypatch.setattr(settings, "HOUSEHOLD_PRIVACY_CONSENT_REQUIRED", True)
    test_user.must_change_password = True
    db_session.commit()
    headers = _headers(client)

    changed = client.post(
        "/api/v1/auth/change-password",
        headers=headers,
        json={
            "currentPassword": "testpassword123",
            "newPassword": "newpassword456",
        },
    )

    assert changed.status_code == 200
    db_session.refresh(test_user)
    assert test_user.must_change_password is False

    relogin_headers = create_user_authentication_headers(
        client=client,
        username="testuser",
        password="newpassword456",
    )
    assert (
        client.get(
            "/api/v1/privacy-consent/current",
            headers=relogin_headers,
        ).status_code
        == 200
    )
    assert (
        client.get(
            "/api/v1/users/me/preferences",
            headers=relogin_headers,
        ).status_code
        == 403
    )


def test_consent_enforcement_can_be_disabled_for_non_household_deployments(
    client,
    test_user,
    monkeypatch,
):
    monkeypatch.setattr(settings, "HOUSEHOLD_PRIVACY_CONSENT_REQUIRED", False)
    headers = _headers(client)

    me_response = client.get("/api/v1/users/me", headers=headers)
    assert me_response.status_code == 200
    assert me_response.json()["privacy_consent_required"] is False
    assert (
        client.get("/api/v1/users/me/preferences", headers=headers).status_code == 200
    )
