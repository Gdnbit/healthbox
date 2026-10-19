"""Member-facing privacy access transparency tests."""

from datetime import date, datetime, timedelta, timezone

from app.crud.patient import patient as patient_crud
from app.crud.user import user as user_crud
from app.models.activity_log import ActivityLog
from app.models.patient import Patient
from app.schemas.patient import PatientCreate
from app.schemas.user import UserCreate
from app.services.archive_circle_service import ArchiveCircleService
from tests.utils.user import create_user_token_headers


def _create_member(db_session, suffix: str):
    user = user_crud.create(
        db_session,
        obj_in=UserCreate(
            username=f"privacy{suffix}",
            email=f"privacy{suffix}@synthetic.healthbox.example",
            password=f"SyntheticPrivacy{suffix}Password1",
            full_name=f"隐私成员{suffix}",
            role="user",
        ),
    )
    patient = patient_crud.create_for_user(
        db_session,
        user_id=user.id,
        patient_data=PatientCreate(
            first_name=f"成员{suffix}",
            last_name="虚构",
            birth_date=date(1990, 1, 1),
            gender="F",
            address="Synthetic address",
        ),
    )
    user.active_patient_id = patient.id
    db_session.commit()
    return user, patient


def test_member_can_see_current_reciprocal_visibility_without_group_metadata(
    client,
    db_session,
    test_user,
    test_patient,
    test_admin_user,
    user_token_headers,
):
    _, peer_patient = _create_member(db_session, "peer")
    _, outsider_patient = _create_member(db_session, "outsider")
    service = ArchiveCircleService(db_session)
    circle = service.create_circle(
        actor=test_admin_user,
        name="不得对普通成员显示的内部组",
    )
    for patient in (test_patient, peer_patient):
        service.add_member(
            actor=test_admin_user,
            circle_id=circle.id,
            patient_id=patient.id,
        )

    response = client.get(
        "/api/v1/privacy-access/me",
        headers=user_token_headers,
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["subject"]["display_name"] == "TestUser"
    assert payload["visibility"]["administrator"]["label"] == "系统管理员"
    assert payload["visibility"]["administrator"]["can_read_all_server_data"] is True
    assert payload["visibility"]["reciprocal_viewers"] == [
        {
            "display_name": "成员Peer虚构",
            "scope": "structured_dashboard",
            "scope_label": "结构化指标与趋势",
        }
    ]
    assert payload["visibility"]["not_shared_by_default"] == [
        "报告原件",
        "报告文字描述",
        "编辑权限",
        "导出权限",
        "AI 分析权限",
    ]
    assert payload["events"] == []

    rendered = response.text
    for forbidden in (
        "不得对普通成员显示的内部组",
        "circle_id",
        "membership_id",
        outsider_patient.first_name,
        test_user.username,
        test_user.email,
        "owner_user_id",
    ):
        assert forbidden not in rendered


def test_member_access_history_is_scoped_ordered_and_sanitized(
    client,
    db_session,
    test_user,
    test_patient,
    test_admin_user,
    user_token_headers,
):
    peer_user, _ = _create_member(db_session, "viewer")
    now = datetime.now(timezone.utc)
    db_session.add_all(
        [
            ActivityLog.create_activity(
                action="viewed",
                entity_type="archive_circle",
                entity_id=test_patient.id,
                user_id=peer_user.id,
                patient_id=test_patient.id,
                description="SENSITIVE HEALTH VALUE 9.99",
                metadata={
                    "access_basis": "archive_circle",
                    "scope": "structured_dashboard",
                    "resource": "dashboard",
                    "secret_health_value": "9.99",
                    "result": "allowed",
                },
            ),
            ActivityLog.create_activity(
                action="updated",
                entity_type="lab_result",
                entity_id=998,
                user_id=test_admin_user.id,
                patient_id=test_patient.id,
                description="SENSITIVE ADMIN EDIT",
                metadata={
                    "access_basis": "owner_global_read",
                    "resource": "formal_metric",
                    "result": "completed",
                },
            ),
            ActivityLog.create_activity(
                action="exported",
                entity_type="health_archive_export",
                entity_id=997,
                user_id=test_user.id,
                patient_id=test_patient.id,
                description="SENSITIVE SELF EXPORT",
                metadata={
                    "access_basis": "owner",
                    "resource": "complete_archive",
                    "result": "completed",
                },
            ),
            ActivityLog.create_activity(
                action="viewed",
                entity_type="archive_circle",
                entity_id=996,
                user_id=peer_user.id,
                patient_id=None,
                description="UNSCOPED EVENT",
                metadata={"resource": "dashboard"},
            ),
        ]
    )
    db_session.flush()
    rows = (
        db_session.query(ActivityLog)
        .filter(ActivityLog.patient_id == test_patient.id)
        .order_by(ActivityLog.id)
        .all()
    )
    rows[0].timestamp = now - timedelta(minutes=3)
    rows[1].timestamp = now - timedelta(minutes=2)
    rows[2].timestamp = now - timedelta(minutes=1)
    db_session.commit()

    response = client.get(
        "/api/v1/privacy-access/me?limit=2&offset=0",
        headers=user_token_headers,
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 3
    assert [event["action"] for event in payload["events"]] == [
        "exported",
        "updated",
    ]
    assert payload["events"][0]["actor"] == {
        "kind": "self",
        "label": "我",
    }
    assert payload["events"][1]["actor"] == {
        "kind": "administrator",
        "label": "系统管理员",
    }
    assert payload["events"][1]["authorization"] == {
        "basis": "owner_global_read",
        "label": "管理员全局读取",
    }
    assert payload["events"][1]["resource"] == {
        "kind": "formal_metric",
        "label": "结构化指标",
    }
    assert payload["events"][1]["result"] == "completed"
    assert payload["events"][1]["occurred_at"]
    assert payload["history_notice"]

    rendered = response.text
    for forbidden in (
        "SENSITIVE",
        "9.99",
        "secret_health_value",
        "entity_id",
        "user_id",
        "patient_id",
        "ip_address",
        peer_user.username,
        peer_user.email,
    ):
        assert forbidden not in rendered

    second_page = client.get(
        "/api/v1/privacy-access/me?limit=2&offset=2",
        headers=user_token_headers,
    )
    assert second_page.status_code == 200
    assert second_page.json()["events"][0]["actor"] == {
        "kind": "member",
        "label": "成员Viewer虚构",
    }
    assert second_page.json()["events"][0]["authorization"]["basis"] == (
        "archive_circle"
    )


def test_privacy_access_requires_exactly_one_owned_subject(
    client,
    db_session,
    test_user,
    user_token_headers,
):
    missing = client.get(
        "/api/v1/privacy-access/me",
        headers=user_token_headers,
    )
    assert missing.status_code == 404

    first = patient_crud.create_for_user(
        db_session,
        user_id=test_user.id,
        patient_data=PatientCreate(
            first_name="第一",
            last_name="虚构",
            birth_date=date(1990, 1, 1),
            gender="F",
            address="Synthetic address",
        ),
    )
    second = Patient(
        user_id=test_user.id,
        owner_user_id=test_user.id,
        is_self_record=True,
        privacy_level="owner",
        first_name="第二",
        last_name="虚构",
        birth_date=date(1991, 1, 1),
        gender="F",
        address="Synthetic address",
    )
    db_session.add(second)
    test_user.active_patient_id = first.id
    db_session.commit()

    ambiguous = client.get(
        "/api/v1/privacy-access/me",
        headers=user_token_headers,
    )
    assert ambiguous.status_code == 409
    assert second.id != first.id


def test_unauthenticated_user_cannot_read_privacy_access_history(client):
    response = client.get("/api/v1/privacy-access/me")
    assert response.status_code in (401, 403)
