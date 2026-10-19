"""Synthetic contract tests for reciprocal archive-circle authorization."""

import json
from datetime import date
from pathlib import Path

from app.core.config import settings
from app.crud.patient import patient as patient_crud
from app.crud.user import user as user_crud
from app.models.activity_log import ActivityLog
from app.models.archive_circle import ArchiveCircle
from app.schemas.patient import PatientCreate
from app.schemas.user import UserCreate
from app.services.archive_circle_service import (
    ARCHIVE_CIRCLE_SCOPE,
    ArchiveCircleService,
)
from app.services.patient_access import PatientAccessService

CONTRACT_PATH = (
    Path(__file__).resolve().parents[2]
    / "evals"
    / "household-health-mvp"
    / "golden"
    / "archive-circle-contract.json"
)


def _create_member(db_session, index: int):
    user = user_crud.create(
        db_session,
        obj_in=UserCreate(
            username=f"circlemember{index}",
            email=f"circlemember{index}@synthetic.healthbox.example",
            password=f"SyntheticMember{index}Password",
            full_name=f"Synthetic Member {index}",
            role="user",
        ),
    )
    patient = patient_crud.create_for_user(
        db_session,
        user_id=user.id,
        patient_data=PatientCreate(
            first_name=f"成员{index}",
            last_name="虚构",
            birth_date=date(1980 + index, 1, 1),
            gender="F" if index % 2 else "M",
            address="Synthetic address",
        ),
    )
    user.active_patient_id = patient.id
    db_session.commit()
    return user, patient


def test_archive_circle_contract_matches_runtime_constants():
    contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))

    assert contract["ordinary_scope"] == ARCHIVE_CIRCLE_SCOPE
    assert contract["membership_statuses"] == ["active", "paused", "removed"]
    assert contract["circle_statuses"] == ["active", "paused", "archived"]


def test_same_circle_is_reciprocal_and_overlap_is_not_transitive(
    db_session,
    test_admin_user,
    monkeypatch,
):
    monkeypatch.setattr(settings, "LEGACY_DIRECTIONAL_SHARING_ENABLED", False)
    members = [_create_member(db_session, index) for index in range(1, 7)]
    users = [member[0] for member in members]
    patients = [member[1] for member in members]
    circles = ArchiveCircleService(db_session)

    household = circles.create_circle(
        actor=test_admin_user,
        name="虚构家庭组",
        description="Synthetic reciprocal group",
    )
    for patient in patients[:3]:
        circles.add_member(
            actor=test_admin_user,
            circle_id=household.id,
            patient_id=patient.id,
        )

    friends = circles.create_circle(
        actor=test_admin_user,
        name="虚构朋友组",
        description="Synthetic overlapping group",
    )
    for patient in (patients[2], patients[3]):
        circles.add_member(
            actor=test_admin_user,
            circle_id=friends.id,
            patient_id=patient.id,
        )

    access = PatientAccessService(db_session)
    for viewer_index in range(3):
        for target_index in range(3):
            assert access.can_access_structured_dashboard(
                users[viewer_index],
                patients[target_index],
            )

    assert access.can_access_structured_dashboard(users[2], patients[3])
    assert access.can_access_structured_dashboard(users[3], patients[2])
    assert not access.can_access_structured_dashboard(users[0], patients[3])
    assert not access.can_access_structured_dashboard(users[3], patients[0])
    assert not access.can_access_structured_dashboard(users[4], patients[5])

    # Circle membership must never enter the legacy broad "view" path.
    assert not access.can_access_patient(users[0], patients[1], "view")

    visible_to_first = circles.list_accessible_subjects(users[0])
    assert [subject["patient_id"] for subject in visible_to_first] == [
        patients[0].id,
        patients[1].id,
        patients[2].id,
    ]
    assert visible_to_first[0]["scope"] == "owner"
    assert {subject["scope"] for subject in visible_to_first[1:]} == {
        ARCHIVE_CIRCLE_SCOPE
    }


def test_pause_move_and_remove_recompute_access_and_audit_safely(
    db_session,
    test_admin_user,
):
    members = [_create_member(db_session, index) for index in range(11, 15)]
    users = [member[0] for member in members]
    patients = [member[1] for member in members]
    circles = ArchiveCircleService(db_session)
    access = PatientAccessService(db_session)

    first = circles.create_circle(actor=test_admin_user, name="虚构组甲")
    second = circles.create_circle(actor=test_admin_user, name="虚构组乙")
    for patient in patients[:2]:
        circles.add_member(
            actor=test_admin_user,
            circle_id=first.id,
            patient_id=patient.id,
        )
    for patient in patients[2:]:
        circles.add_member(
            actor=test_admin_user,
            circle_id=second.id,
            patient_id=patient.id,
        )

    assert access.can_access_structured_dashboard(users[0], patients[1])

    circles.set_membership_status(
        actor=test_admin_user,
        circle_id=first.id,
        patient_id=patients[1].id,
        status="paused",
    )
    assert not access.can_access_structured_dashboard(users[0], patients[1])
    assert not access.can_access_structured_dashboard(users[1], patients[0])

    circles.set_membership_status(
        actor=test_admin_user,
        circle_id=first.id,
        patient_id=patients[1].id,
        status="active",
    )
    assert access.can_access_structured_dashboard(users[0], patients[1])

    circles.move_member(
        actor=test_admin_user,
        patient_id=patients[1].id,
        source_circle_id=first.id,
        target_circle_id=second.id,
    )
    assert not access.can_access_structured_dashboard(users[0], patients[1])
    assert access.can_access_structured_dashboard(users[1], patients[2])
    assert access.can_access_structured_dashboard(users[2], patients[1])

    circles.remove_member(
        actor=test_admin_user,
        circle_id=second.id,
        patient_id=patients[1].id,
    )
    assert not access.can_access_structured_dashboard(users[1], patients[2])
    assert not access.can_access_structured_dashboard(users[2], patients[1])

    audits = (
        db_session.query(ActivityLog)
        .filter(ActivityLog.entity_type == "archive_circle")
        .order_by(ActivityLog.id)
        .all()
    )
    assert audits
    rendered = json.dumps(
        [row.event_metadata for row in audits],
        ensure_ascii=False,
        sort_keys=True,
    ).lower()
    for forbidden in (
        "blood",
        "health_values",
        "report_text",
        "password",
        "token",
        "secret",
        "成员11",
        "synthetic address",
    ):
        assert forbidden not in rendered


def test_circle_management_fails_closed_when_sole_admin_invariant_breaks(
    db_session,
    test_admin_user,
):
    user_crud.create(
        db_session,
        obj_in=UserCreate(
            username="syntheticsecondadmin",
            email="syntheticsecondadmin@synthetic.healthbox.example",
            password="SyntheticSecondAdminPassword1",
            full_name="Synthetic Second Admin",
            role="admin",
        ),
    )

    service = ArchiveCircleService(db_session)
    try:
        service.create_circle(actor=test_admin_user, name="不应创建")
    except Exception as error:
        assert getattr(error, "code", None) == "sole_active_administrator_required"
    else:
        raise AssertionError("Circle management accepted a non-sole administrator")


def test_duplicate_circle_name_returns_stable_conflict_and_rolls_back(
    db_session,
    test_admin_user,
):
    service = ArchiveCircleService(db_session)
    service.create_circle(actor=test_admin_user, name="合成重复组")

    try:
        service.create_circle(actor=test_admin_user, name="合成重复组")
    except Exception as error:
        assert getattr(error, "code", None) == "archive_circle_conflict"
        assert getattr(error, "status_code", None) == 409
    else:
        raise AssertionError("Duplicate archive-circle name was accepted")

    assert (
        db_session.query(ArchiveCircle)
        .filter(ArchiveCircle.name == "合成重复组")
        .count()
        == 1
    )
