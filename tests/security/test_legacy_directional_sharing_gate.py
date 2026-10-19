"""Household-mode regressions for retired one-way sharing authorization."""

import ast
import os
import subprocess
import sys
from pathlib import Path

import pytest

from app.api import deps
from app.core.config import settings
from app.core.http.error_handling import ForbiddenException
from app.models.models import Medication, PatientShare
from app.services.patient_access import PatientAccessService

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def test_legacy_directional_sharing_defaults_to_disabled():
    environment = os.environ.copy()
    environment.pop("LEGACY_DIRECTIONAL_SHARING_ENABLED", None)
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from app.core.config import settings; "
                "print(settings.LEGACY_DIRECTIONAL_SHARING_ENABLED)"
            ),
        ],
        cwd=PROJECT_ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=True,
    )

    assert result.stdout.strip() == "False"


def _function(file_name: str, function_name: str):
    tree = ast.parse((PROJECT_ROOT / file_name).read_text(encoding="utf-8"))
    return next(
        node
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name == function_name
    )


def _has_call_with_keyword(
    function,
    call_suffix: str,
    keyword: str,
    value: str,
) -> bool:
    for node in ast.walk(function):
        if not isinstance(node, ast.Call):
            continue
        if not ast.unparse(node.func).endswith(call_suffix):
            continue
        for item in node.keywords:
            if (
                item.arg == keyword
                and isinstance(item.value, ast.Constant)
                and item.value.value == value
            ):
                return True
    return False


def _depends_on(function, dependency_suffix: str) -> bool:
    arguments = (
        function.args.posonlyargs + function.args.args + function.args.kwonlyargs
    )
    positional_defaults = [None] * (
        len(function.args.posonlyargs)
        + len(function.args.args)
        - len(function.args.defaults)
    ) + list(function.args.defaults)
    defaults = positional_defaults + list(function.args.kw_defaults)

    for argument, default in zip(arguments, defaults):
        if argument.arg != "patient_id" or not isinstance(default, ast.Call):
            continue
        if not ast.unparse(default.func).endswith("Depends") or not default.args:
            continue
        if ast.unparse(default.args[0]).endswith(dependency_suffix):
            return True
    return False


def test_household_mode_hides_all_legacy_directional_routes(
    client,
    user_token_headers,
    admin_token_headers,
    monkeypatch,
):
    monkeypatch.setattr(settings, "LEGACY_DIRECTIONAL_SHARING_ENABLED", False)

    for path in (
        "/api/v1/patient-sharing/shared-with-me",
        "/api/v1/family-history-sharing/mine",
        "/api/v1/invitations/pending",
    ):
        response = client.get(path, headers=user_token_headers)
        assert response.status_code == 404, response.text
        assert response.json()["error_code"] == "legacy_directional_sharing_disabled"

    admin_model = client.get(
        "/api/v1/admin/models/patient_share/",
        headers=admin_token_headers,
    )
    assert admin_model.status_code == 404, admin_model.text
    assert admin_model.json()["error_code"] == "legacy_directional_sharing_disabled"

    account_invitation = client.post(
        "/api/v1/account-invitations/inspect",
        json={"token": "nonexistent-account-invitation-token"},
    )
    assert account_invitation.status_code == 404
    assert (
        account_invitation.json()["error_code"] != "legacy_directional_sharing_disabled"
    )


def test_disabled_patient_share_rows_are_inert_and_preserved(
    db_session,
    test_patient,
    test_recipient,
    test_share,
    monkeypatch,
):
    monkeypatch.setattr(settings, "LEGACY_DIRECTIONAL_SHARING_ENABLED", False)
    access = PatientAccessService(db_session)

    for permission in ("view", "edit", "full"):
        assert not access.can_access_patient(
            test_recipient,
            test_patient,
            permission,
        )

    assert test_patient.id not in {
        patient.id for patient in access.get_accessible_patients(test_recipient)
    }
    assert (
        access.get_patient_context(test_recipient, test_patient)["access_type"] is None
    )
    assert access.get_user_patient_count(test_recipient)["shared_with_me"] == 0

    db_session.refresh(test_share)
    assert test_share.is_active is True
    assert (
        db_session.query(PatientShare).filter(PatientShare.id == test_share.id).count()
        == 1
    )


def test_unknown_patient_permissions_fail_closed_for_owner_and_share(
    db_session,
    test_user,
    test_patient,
    test_recipient,
    test_share,
    monkeypatch,
):
    monkeypatch.setattr(settings, "LEGACY_DIRECTIONAL_SHARING_ENABLED", True)
    access = PatientAccessService(db_session)

    assert not access.can_access_patient(test_user, test_patient, "owner")
    assert not access.can_access_patient(test_recipient, test_patient, "typo")
    assert access.get_accessible_patients(test_user, "unknown") == []


def test_view_share_cannot_use_explicit_edit_or_owner_dependencies(
    db_session,
    test_patient,
    test_recipient,
    test_share,
    monkeypatch,
):
    monkeypatch.setattr(settings, "LEGACY_DIRECTIONAL_SHARING_ENABLED", True)
    assert PatientAccessService(db_session).can_access_patient(
        test_recipient,
        test_patient,
        "view",
    )

    with pytest.raises(ForbiddenException):
        deps.verify_patient_edit_access(
            test_patient.id,
            db_session,
            test_recipient,
        )
    with pytest.raises(ForbiddenException):
        deps.verify_patient_owner_access(
            test_patient.id,
            db_session,
            test_recipient,
        )


def test_view_share_cannot_create_patient_medication(
    client,
    db_session,
    test_patient,
    test_recipient,
    test_share,
    recipient_token_headers,
    monkeypatch,
):
    monkeypatch.setattr(settings, "LEGACY_DIRECTIONAL_SHARING_ENABLED", True)
    before = (
        db_session.query(Medication)
        .filter(Medication.patient_id == test_patient.id)
        .count()
    )

    response = client.post(
        f"/api/v1/patients/{test_patient.id}/medications/",
        headers=recipient_token_headers,
        json={
            "patient_id": test_patient.id,
            "medication_name": "Synthetic denied medication",
        },
    )

    assert response.status_code == 403, response.text
    assert (
        db_session.query(Medication)
        .filter(Medication.patient_id == test_patient.id)
        .count()
        == before
    )


def test_all_known_side_effect_endpoints_require_edit_or_owner():
    dependency_cases = {
        "app/api/v1/endpoints/patients.py": ["create_patient_medication"],
        "app/api/v1/endpoints/vitals.py": [
            "execute_import",
            "delete_imported_day",
            "create_patient_vitals",
        ],
    }
    for file_name, function_names in dependency_cases.items():
        for function_name in function_names:
            assert _depends_on(
                _function(file_name, function_name),
                "verify_patient_edit_access",
            ), f"{file_name}:{function_name} must use explicit edit access"

    direct_edit_cases = {
        (
            "app/api/v1/endpoints/lab_test_component.py",
            "verify_patient_access",
            "required_permission",
        ): [
            "create_lab_test_component",
            "create_lab_test_components_bulk",
            "update_lab_test_component",
            "delete_lab_test_component",
        ],
        (
            "app/api/v1/endpoints/symptom.py",
            "verify_patient_ownership",
            "permission",
        ): [
            "log_symptom_occurrence",
            "update_symptom_occurrence",
            "delete_symptom_occurrence",
            "link_symptom_to_condition",
            "unlink_symptom_from_condition",
            "link_symptom_to_medication",
            "unlink_symptom_from_medication",
            "link_symptom_to_treatment",
            "unlink_symptom_from_treatment",
        ],
        (
            "app/api/v1/endpoints/emergency_contact.py",
            "verify_patient_record_access",
            "permission",
        ): ["set_primary_emergency_contact"],
        (
            "app/api/v1/endpoints/entity_file.py",
            "verify_entity_file_access",
            "permission",
        ): [
            "upload_entity_file",
            "link_paperless_document",
            "link_papra_document",
            "delete_file",
            "update_file_metadata",
        ],
        (
            "app/api/v1/endpoints/patients.py",
            "can_access_patient",
            "permission",
        ): ["upload_patient_photo"],
    }
    for (
        file_name,
        call_suffix,
        keyword,
    ), function_names in direct_edit_cases.items():
        for function_name in function_names:
            assert _has_call_with_keyword(
                _function(file_name, function_name),
                call_suffix,
                keyword,
                "edit",
            ), f"{file_name}:{function_name} must require edit access"

    reminder = _function(
        "app/api/v1/endpoints/medication.py",
        "send_test_reminder",
    )
    assert any(
        isinstance(node, ast.Call)
        and ast.unparse(node.func).endswith("verify_patient_owner_access")
        for node in ast.walk(reminder)
    )


def test_semantic_read_only_posts_remain_view_scoped():
    ocr = _function(
        "app/api/v1/endpoints/lab_result.py",
        "parse_lab_pdf_with_ocr",
    )
    assert not _has_call_with_keyword(
        ocr,
        "verify_patient_access",
        "required_permission",
        "edit",
    )

    preview = _function(
        "app/api/v1/endpoints/vitals.py",
        "preview_import",
    )
    assert _depends_on(preview, "verify_patient_access")

    batch_counts = _function(
        "app/api/v1/endpoints/entity_file.py",
        "get_batch_file_counts",
    )
    assert not _has_call_with_keyword(
        batch_counts,
        "verify_entity_file_access",
        "permission",
        "edit",
    )


def test_unauthorized_entity_file_cleanup_route_is_not_public():
    from app.api.v1.endpoints.entity_file import router

    paths = {route.path for route in router.routes if hasattr(route, "path")}
    assert "/{entity_type}/{entity_id}/cleanup" not in paths
