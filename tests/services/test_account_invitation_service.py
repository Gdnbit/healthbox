"""Synthetic contract tests for single-use household account invitations."""

import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from app.core.utils.datetime_utils import get_utc_now
from app.core.utils.security import get_password_hash
from app.models.account_invitation import AccountInvitation
from app.models.activity_log import ActivityLog
from app.models.patient import Patient
from app.models.user import User, UserPrivacyConsent
from app.schemas.user import User as UserSchema
from app.services import privacy_consent_service
from app.services.account_invitation_service import (
    ACCOUNT_INVITATION_CONTRACT_VERSION,
    ACCOUNT_INVITATION_DEFAULT_TTL_HOURS,
    ACCOUNT_INVITATION_MAX_ACCOUNTS,
    AccountInvitationError,
    AccountInvitationService,
    hash_invitation_token,
)

CONTRACT_PATH = (
    Path(__file__).resolve().parents[2]
    / "evals"
    / "household-invitation-activation"
    / "golden"
    / "account-invitation-contract.json"
)


def _create_direct_user(
    db_session,
    index: int,
    *,
    role: str = "user",
    active: bool = True,
) -> User:
    row = User(
        username=f"syntheticinviteuser{index}",
        email=f"syntheticinviteuser{index}@household.example",
        password_hash=get_password_hash(f"SyntheticPassword{index}"),
        full_name=f"虚构成员{index}",
        role=role,
        is_active=active,
        must_change_password=False,
        auth_version=1,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def _activation_payload(token: str, suffix: str = "01") -> dict:
    return {
        "token": token,
        "username": f"invitedmember{suffix}",
        "display_name": f"虚构受邀成员{suffix}",
        "birth_date": date(1992, 4, 15),
        "gender": "prefer_not_to_say",
        "password": f"SafeHouseholdPassword{suffix}",
        "privacy_notice_version": (
            privacy_consent_service.HOUSEHOLD_PRIVACY_NOTICE_VERSION
        ),
        "privacy_notice_accepted": True,
    }


def test_golden_contract_matches_runtime_constants():
    contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))

    assert contract["contract_id"] == ACCOUNT_INVITATION_CONTRACT_VERSION
    assert contract["token"]["default_ttl_hours"] == (
        ACCOUNT_INVITATION_DEFAULT_TTL_HOURS
    )
    assert contract["capacity"]["maximum_active_accounts"] == (
        ACCOUNT_INVITATION_MAX_ACCOUNTS
    )
    assert contract["states"] == [
        "pending",
        "activated",
        "declined",
        "cancelled",
        "expired",
    ]


def test_create_returns_plaintext_once_and_persists_only_digest(
    db_session,
    test_admin_user,
):
    created = AccountInvitationService(db_session).create_invitation(
        actor=test_admin_user,
        recipient_label="虚构家人甲",
        expires_in_hours=72,
    )

    assert created.token
    assert len(created.token.encode("utf-8")) >= 32
    assert created.invitation.status == "pending"
    assert created.invitation.token_sha256 == hash_invitation_token(created.token)
    assert created.token not in created.invitation.token_sha256
    assert (created.invitation.expires_at - created.invitation.created_at) == timedelta(
        hours=72
    )

    persisted = db_session.query(AccountInvitation).one()
    rendered = json.dumps(
        {
            column.name: getattr(persisted, column.name)
            for column in persisted.__table__.columns
        },
        default=str,
        ensure_ascii=False,
    )
    assert created.token not in rendered

    audits = db_session.query(ActivityLog).filter(
        ActivityLog.entity_type == "account_invitation"
    )
    assert audits.count() == 1
    assert created.token not in json.dumps(
        audits.one().event_metadata,
        ensure_ascii=False,
    )


def test_invitation_management_requires_the_sole_active_administrator(
    db_session,
    test_admin_user,
    test_user,
):
    service = AccountInvitationService(db_session)

    with pytest.raises(AccountInvitationError) as member_error:
        service.create_invitation(
            actor=test_user,
            recipient_label="不应创建",
            expires_in_hours=72,
        )
    assert member_error.value.code == "sole_active_administrator_required"

    _create_direct_user(db_session, 99, role="admin")
    with pytest.raises(AccountInvitationError) as second_admin_error:
        service.create_invitation(
            actor=test_admin_user,
            recipient_label="仍不应创建",
            expires_in_hours=72,
        )
    assert second_admin_error.value.code == "sole_active_administrator_required"
    assert db_session.query(AccountInvitation).count() == 0


def test_pending_invitations_reserve_twenty_account_capacity(
    db_session,
    test_admin_user,
):
    service = AccountInvitationService(db_session)
    for index in range(1, ACCOUNT_INVITATION_MAX_ACCOUNTS - 1):
        _create_direct_user(db_session, index)

    first = service.create_invitation(
        actor=test_admin_user,
        recipient_label="最后一个容量名额",
        expires_in_hours=24,
    )
    assert first.invitation.status == "pending"

    with pytest.raises(AccountInvitationError) as error:
        service.create_invitation(
            actor=test_admin_user,
            recipient_label="超过容量",
            expires_in_hours=24,
        )
    assert error.value.code == "account_invitation_capacity_reached"
    assert db_session.query(AccountInvitation).count() == 1


def test_activation_atomically_creates_user_subject_consent_and_audit(
    db_session,
    test_admin_user,
):
    service = AccountInvitationService(db_session)
    created = service.create_invitation(
        actor=test_admin_user,
        recipient_label="虚构受邀者",
        expires_in_hours=72,
    )

    result = service.activate(**_activation_payload(created.token))

    assert result.invitation.status == "activated"
    assert result.invitation.activated_user_id == result.user.id
    assert result.user.role == "user"
    assert result.user.is_active is True
    assert result.user.must_change_password is False
    assert result.user.email.endswith("@household.example")
    assert UserSchema.model_validate(result.user).email == result.user.email
    assert result.user.active_patient_id == result.patient.id
    assert result.patient.user_id == result.user.id
    assert result.patient.owner_user_id == result.user.id
    assert result.patient.is_self_record is True
    assert result.patient.first_name == "虚构受邀成员01"
    assert result.patient.last_name == ""
    assert (
        db_session.query(Patient)
        .filter(Patient.owner_user_id == result.user.id)
        .count()
        == 1
    )

    consent = (
        db_session.query(UserPrivacyConsent)
        .filter(UserPrivacyConsent.user_id == result.user.id)
        .one()
    )
    assert consent.decision == "accepted"
    assert consent.notice_version == (
        privacy_consent_service.HOUSEHOLD_PRIVACY_NOTICE_VERSION
    )

    activation_audit = (
        db_session.query(ActivityLog)
        .filter(
            ActivityLog.entity_type == "account_invitation",
            ActivityLog.action == "activated",
        )
        .one()
    )
    assert activation_audit.user_id == result.user.id
    assert activation_audit.patient_id == result.patient.id
    rendered = json.dumps(
        activation_audit.event_metadata,
        ensure_ascii=False,
        sort_keys=True,
    ).lower()
    for forbidden in (
        created.token.lower(),
        "safehouseholdpassword",
        "1992-04-15",
        "@household.example",
        "health_values",
    ):
        assert forbidden not in rendered


@pytest.mark.parametrize(
    "terminal_action",
    ["activate", "decline", "cancel", "expire"],
)
def test_terminal_invitation_cannot_be_replayed(
    db_session,
    test_admin_user,
    terminal_action,
):
    service = AccountInvitationService(db_session)
    created = service.create_invitation(
        actor=test_admin_user,
        recipient_label=f"虚构终态-{terminal_action}",
        expires_in_hours=24,
    )

    if terminal_action == "activate":
        service.activate(**_activation_payload(created.token, "21"))
    elif terminal_action == "decline":
        assert service.decline(token=created.token) is True
    elif terminal_action == "cancel":
        cancellation_reason = "虚构受邀者暂不需要使用"
        service.cancel(
            actor=test_admin_user,
            public_id=created.invitation.public_id,
            reason=cancellation_reason,
        )
        cancellation_audit = (
            db_session.query(ActivityLog)
            .filter(
                ActivityLog.entity_type == "account_invitation",
                ActivityLog.action == "cancelled",
            )
            .one()
        )
        rendered_audit = json.dumps(
            cancellation_audit.event_metadata,
            ensure_ascii=False,
        )
        assert cancellation_reason not in rendered_audit
        assert cancellation_audit.event_metadata["reason_supplied"] is True
    else:
        created.invitation.expires_at = get_utc_now() - timedelta(seconds=1)
        db_session.commit()

    with pytest.raises(AccountInvitationError) as error:
        service.activate(**_activation_payload(created.token, "22"))
    assert error.value.code == "account_invitation_unavailable"
    assert (
        db_session.query(User).filter(User.username == "invitedmember22").count() == 0
    )


def test_activation_rolls_back_every_effect_when_consent_write_fails(
    db_session,
    test_admin_user,
    monkeypatch,
):
    service = AccountInvitationService(db_session)
    created = service.create_invitation(
        actor=test_admin_user,
        recipient_label="虚构回滚成员",
        expires_in_hours=72,
    )
    invitation_id = created.invitation.id

    def fail_consent(*args, **kwargs):
        raise RuntimeError("synthetic consent failure")

    monkeypatch.setattr(privacy_consent_service, "record_decision", fail_consent)

    with pytest.raises(AccountInvitationError) as error:
        service.activate(**_activation_payload(created.token, "31"))
    assert error.value.code == "account_activation_failed"

    db_session.expire_all()
    invitation = db_session.get(AccountInvitation, invitation_id)
    assert invitation.status == "pending"
    assert invitation.activated_user_id is None
    assert (
        db_session.query(User).filter(User.username == "invitedmember31").count() == 0
    )
    assert db_session.query(Patient).count() == 0
    assert db_session.query(UserPrivacyConsent).count() == 0
    assert (
        db_session.query(ActivityLog)
        .filter(
            ActivityLog.entity_type == "account_invitation",
            ActivityLog.action == "activated",
        )
        .count()
        == 0
    )


@pytest.mark.parametrize(
    ("password", "expected_code"),
    [
        ("abc123", "password_policy_failed"),
        ("1234567890", "password_policy_failed"),
        ("invitedmember41-safe-123", "password_policy_failed"),
        ("密" * 30 + "A1", "password_policy_failed"),
    ],
)
def test_invited_member_password_policy_fails_without_consuming_invitation(
    db_session,
    test_admin_user,
    password,
    expected_code,
):
    service = AccountInvitationService(db_session)
    created = service.create_invitation(
        actor=test_admin_user,
        recipient_label="虚构密码测试",
        expires_in_hours=72,
    )
    payload = _activation_payload(created.token, "41")
    payload["password"] = password

    with pytest.raises(AccountInvitationError) as error:
        service.activate(**payload)
    assert error.value.code == expected_code

    db_session.expire_all()
    assert db_session.get(AccountInvitation, created.invitation.id).status == "pending"
    assert (
        db_session.query(User).filter(User.username == "invitedmember41").count() == 0
    )
