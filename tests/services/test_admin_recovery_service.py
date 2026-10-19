"""Server-local sole-administrator recovery contract tests.

All users, credentials, and databases in this module are synthetic.  The
tests never connect to the running household deployment.
"""

import json
from datetime import datetime
from pathlib import Path

import pyotp
import pytest
from sqlalchemy.orm import Session

from app.core.utils.security import create_access_token, verify_password
from app.crud.user import user as user_crud
from app.models.activity_log import ActivityLog
from app.models.user import (
    UserMfaChallenge,
    UserMfaCredential,
    UserMfaRecoveryCode,
)
from app.schemas.user import UserCreate
from app.services.admin_recovery_service import (
    COMMAND_VERSION,
    RecoveryContractError,
    inspect_administrator_recovery,
    recover_administrator_access,
)

CONTRACT_PATH = (
    Path(__file__).parents[2]
    / "evals"
    / "household-health-mvp"
    / "golden"
    / "admin-recovery-contract.json"
)


def _add_mfa_state(db: Session, user_id: int) -> None:
    db.add(
        UserMfaCredential(
            user_id=user_id,
            method="totp",
            secret_encrypted="synthetic-encrypted-secret",
            is_enabled=True,
        )
    )
    db.add(
        UserMfaRecoveryCode(
            user_id=user_id,
            code_hash="$2b$04$syntheticonlyhashnotusedforverification000000000000000",
        )
    )
    db.add(
        UserMfaChallenge(
            challenge_id="synthetic-challenge-id",
            user_id=user_id,
            purpose="verify",
            expires_at=datetime(2099, 1, 1),
        )
    )
    db.commit()


def _assert_forbidden_values_absent(payload: dict, *plaintext_values: str) -> None:
    rendered = json.dumps(payload, ensure_ascii=False)
    contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    for field_name in contract["forbidden_output_fields"]:
        assert f'"{field_name}"' not in rendered
    for plaintext in plaintext_values:
        assert plaintext not in rendered


def test_inspect_reports_recovery_readiness_without_mutation(
    db_session: Session,
    test_admin_user,
):
    _add_mfa_state(db_session, test_admin_user.id)
    before_version = test_admin_user.auth_version

    result = inspect_administrator_recovery(db_session, username="admin")

    assert result["command_version"] == COMMAND_VERSION
    assert result["action"] == "inspect_admin_recovery"
    assert result["result"] == "ready"
    assert result["target"] == {
        "user_id": test_admin_user.id,
        "username": "admin",
    }
    assert result["account"]["administrator_count"] == 1
    assert result["second_factor"]["enabled"] is True
    assert result["second_factor"]["unused_recovery_code_count"] == 1
    assert test_admin_user.auth_version == before_version
    assert db_session.query(ActivityLog).count() == 0
    _assert_forbidden_values_absent(result, "synthetic-encrypted-secret")


def test_inspect_does_not_rollback_the_callers_uncommitted_work(
    db_session: Session,
    test_admin_user,
):
    test_admin_user.full_name = "Uncommitted Synthetic Name"

    result = inspect_administrator_recovery(db_session, username="admin")

    assert result["result"] == "ready"
    assert test_admin_user.full_name == "Uncommitted Synthetic Name"


def test_recovery_resets_all_authentication_material_and_writes_audit(
    db_session: Session,
    test_admin_user,
):
    _add_mfa_state(db_session, test_admin_user.id)
    old_hash = test_admin_user.password_hash
    old_version = test_admin_user.auth_version
    new_password = "SyntheticRecovery987!"

    result = recover_administrator_access(
        db_session,
        username="admin",
        confirmed_user_id=test_admin_user.id,
        new_password=new_password,
        operator="synthetic-server-owner",
        reason="synthetic lost authenticator drill",
    )

    db_session.refresh(test_admin_user)
    assert result["result"] == "success"
    assert result["sessions_revoked"] is True
    assert result["second_factor"]["action"] == "reset_for_reenrollment"
    assert result["account"]["must_change_password"] is True
    assert result["account"]["is_active"] is True
    assert result["maintenance_record_id"] > 0
    contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    assert set(contract["required_success_fields"]).issubset(result)
    assert set(contract["required_target_fields"]).issubset(result["target"])
    assert test_admin_user.auth_version == old_version + 1
    assert test_admin_user.password_hash != old_hash
    assert verify_password(new_password, test_admin_user.password_hash)
    assert test_admin_user.must_change_password is True
    assert test_admin_user.is_active is True
    assert db_session.query(UserMfaCredential).count() == 0
    assert db_session.query(UserMfaRecoveryCode).count() == 0
    challenge = db_session.query(UserMfaChallenge).one()
    assert challenge.consumed_at is not None

    maintenance = db_session.get(ActivityLog, result["maintenance_record_id"])
    assert maintenance.action == "maintenance_completed"
    assert maintenance.entity_type == "user"
    assert maintenance.entity_id == test_admin_user.id
    assert maintenance.user_id is None
    assert maintenance.event_metadata["command_version"] == COMMAND_VERSION
    assert maintenance.event_metadata["operator"] == "synthetic-server-owner"
    assert maintenance.event_metadata["reason"] == "synthetic lost authenticator drill"
    assert maintenance.event_metadata["before"]["auth_version"] == old_version
    assert maintenance.event_metadata["after"]["auth_version"] == old_version + 1
    _assert_forbidden_values_absent(
        result,
        new_password,
        old_hash,
        "synthetic-encrypted-secret",
    )
    _assert_forbidden_values_absent(
        maintenance.to_dict(),
        new_password,
        old_hash,
        test_admin_user.password_hash,
        "synthetic-encrypted-secret",
    )


def test_recovery_revokes_preexisting_administrator_session(
    client,
    db_session: Session,
    test_admin_user,
):
    old_token = create_access_token(
        data={
            "sub": test_admin_user.username,
            "token_use": "access",
            "auth_version": test_admin_user.auth_version,
            "mfa_verified": True,
        }
    )

    recover_administrator_access(
        db_session,
        username="admin",
        confirmed_user_id=test_admin_user.id,
        new_password="SyntheticRecovery987!",
        operator="synthetic-server-owner",
        reason="synthetic session revocation drill",
    )

    response = client.get(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {old_token}"},
    )
    assert response.status_code == 401


def test_recovery_refuses_an_ordinary_member_while_admin_exists(
    db_session: Session,
    test_admin_user,
    test_user,
):
    before_hash = test_user.password_hash

    with pytest.raises(RecoveryContractError) as exc:
        recover_administrator_access(
            db_session,
            username=test_user.username,
            confirmed_user_id=test_user.id,
            new_password="SyntheticRecovery987!",
            operator="synthetic-server-owner",
            reason="synthetic wrong target drill",
        )

    assert exc.value.code == "target_is_not_sole_administrator"
    db_session.refresh(test_user)
    assert test_user.password_hash == before_hash
    assert db_session.query(ActivityLog).count() == 0


def test_recovery_refuses_multiple_administrators_without_mutation(
    db_session: Session,
    test_admin_user,
):
    second = user_crud.create(
        db_session,
        obj_in=UserCreate(
            username="second-admin",
            email="second-admin@example.com",
            password="SyntheticAdmin123!",
            full_name="Second Admin",
            role="admin",
        ),
    )
    before_hash = test_admin_user.password_hash

    with pytest.raises(RecoveryContractError) as exc:
        recover_administrator_access(
            db_session,
            username="admin",
            confirmed_user_id=test_admin_user.id,
            new_password="SyntheticRecovery987!",
            operator="synthetic-server-owner",
            reason="synthetic multiple admin drill",
        )

    assert second.id is not None
    assert exc.value.code == "administrator_integrity_violation"
    db_session.refresh(test_admin_user)
    assert test_admin_user.password_hash == before_hash
    assert db_session.query(ActivityLog).count() == 0


def test_demotion_recovery_requires_explicit_role_restore(
    db_session: Session,
    test_admin_user,
):
    test_admin_user.role = "user"
    db_session.commit()

    with pytest.raises(RecoveryContractError) as exc:
        recover_administrator_access(
            db_session,
            username="admin",
            confirmed_user_id=test_admin_user.id,
            new_password="SyntheticRecovery987!",
            operator="synthetic-server-owner",
            reason="synthetic demotion drill",
        )
    assert exc.value.code == "explicit_role_restore_required"

    result = recover_administrator_access(
        db_session,
        username="admin",
        confirmed_user_id=test_admin_user.id,
        new_password="SyntheticRecovery987!",
        operator="synthetic-server-owner",
        reason="synthetic demotion drill",
        restore_admin_role=True,
        expected_owner_username="admin",
    )
    db_session.refresh(test_admin_user)
    assert result["account"]["admin_role_restored"] is True
    assert test_admin_user.role == "admin"
    maintenance = db_session.get(ActivityLog, result["maintenance_record_id"])
    assert maintenance.event_metadata["before"]["role"] == "user"
    assert maintenance.event_metadata["after"]["role"] == "admin"


def test_recovery_reason_cannot_contain_the_new_password(
    db_session: Session,
    test_admin_user,
):
    new_password = "SyntheticRecovery987!"
    before_hash = test_admin_user.password_hash

    with pytest.raises(RecoveryContractError) as exc:
        recover_administrator_access(
            db_session,
            username="admin",
            confirmed_user_id=test_admin_user.id,
            new_password=new_password,
            operator="synthetic-server-owner",
            reason=f"accidentally pasted {new_password}",
        )

    assert exc.value.code == "maintenance_text_contains_credential"
    db_session.refresh(test_admin_user)
    assert test_admin_user.password_hash == before_hash
    assert db_session.query(ActivityLog).count() == 0


@pytest.mark.parametrize(
    "new_password",
    [
        "short1A",
        "123456789012",
        "abcdefghijkl",
        "admin12345678",
        "A" * 73 + "1",
    ],
)
def test_weak_or_unsafe_password_is_rejected_before_mutation(
    db_session: Session,
    test_admin_user,
    new_password: str,
):
    before_hash = test_admin_user.password_hash

    with pytest.raises(RecoveryContractError) as exc:
        recover_administrator_access(
            db_session,
            username="admin",
            confirmed_user_id=test_admin_user.id,
            new_password=new_password,
            operator="synthetic-server-owner",
            reason="synthetic password policy drill",
        )

    assert exc.value.code == "password_policy_failed"
    db_session.refresh(test_admin_user)
    assert test_admin_user.password_hash == before_hash
    assert db_session.query(ActivityLog).count() == 0


def test_failed_post_change_integrity_check_rolls_back_everything(
    monkeypatch,
    db_session: Session,
    test_admin_user,
):
    import app.services.admin_recovery_service as recovery_service

    _add_mfa_state(db_session, test_admin_user.id)
    before_hash = test_admin_user.password_hash
    before_version = test_admin_user.auth_version

    monkeypatch.setattr(
        recovery_service,
        "_post_change_integrity_checks",
        lambda *args, **kwargs: [
            {
                "id": "forced_failure",
                "status": "failed",
                "details": {},
            }
        ],
    )

    with pytest.raises(RecoveryContractError) as exc:
        recover_administrator_access(
            db_session,
            username="admin",
            confirmed_user_id=test_admin_user.id,
            new_password="SyntheticRecovery987!",
            operator="synthetic-server-owner",
            reason="synthetic rollback drill",
        )

    assert exc.value.code == "post_change_integrity_failed"
    db_session.refresh(test_admin_user)
    assert test_admin_user.password_hash == before_hash
    assert test_admin_user.auth_version == before_version
    assert db_session.query(UserMfaCredential).count() == 1
    assert db_session.query(UserMfaRecoveryCode).count() == 1
    assert db_session.query(UserMfaChallenge).one().consumed_at is None
    assert db_session.query(ActivityLog).count() == 0


def test_recovered_admin_must_reenroll_totp_and_change_password(
    client,
    db_session: Session,
    test_admin_user,
):
    _add_mfa_state(db_session, test_admin_user.id)
    recovery_password = "SyntheticRecovery987!"
    final_password = "FinalOwnerPassword246!"
    recover_administrator_access(
        db_session,
        username="admin",
        confirmed_user_id=test_admin_user.id,
        new_password=recovery_password,
        operator="synthetic-server-owner",
        reason="synthetic complete recovery flow",
    )
    client.cookies.clear()

    first_login = client.post(
        "/api/v1/auth/login",
        data={"username": "admin", "password": recovery_password},
    )
    assert first_login.status_code == 200
    challenge = first_login.json()
    assert challenge["status"] == "mfa_enrollment_required"
    assert "access_token" not in challenge

    setup = client.post(
        "/api/v1/auth/mfa/totp/setup",
        json={"challenge_token": challenge["challenge_token"]},
    )
    assert setup.status_code == 200
    setup_data = setup.json()
    confirm = client.post(
        "/api/v1/auth/mfa/totp/confirm",
        json={
            "challenge_token": challenge["challenge_token"],
            "code": pyotp.TOTP(setup_data["manual_key"]).now(),
        },
    )
    assert confirm.status_code == 200
    authenticated = confirm.json()
    assert authenticated["must_change_password"] is True
    assert len(authenticated["recovery_codes"]) == 10

    blocked = client.get(
        "/api/v1/admin/dashboard/test-access",
        headers={"Authorization": f"Bearer {authenticated['access_token']}"},
    )
    assert blocked.status_code == 403

    changed = client.post(
        "/api/v1/auth/change-password",
        json={
            "currentPassword": recovery_password,
            "newPassword": final_password,
        },
        headers={"Authorization": f"Bearer {authenticated['access_token']}"},
    )
    assert changed.status_code == 200

    client.cookies.clear()
    subsequent_login = client.post(
        "/api/v1/auth/login",
        data={"username": "admin", "password": final_password},
    )
    assert subsequent_login.status_code == 200
    assert subsequent_login.json()["status"] == "mfa_required"
