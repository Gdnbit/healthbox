import json
from datetime import date, datetime, timezone

import pytest

from app.api.v1.endpoints.health_ai import get_health_ai_runtime
from app.core.config import settings
from app.crud.system_setting import system_setting
from app.main import app
from app.models.activity_log import ActivityLog
from app.models.clinical import Vitals
from app.models.health_ai import HealthAiAnswer, HealthAiRequest
from app.models.labs import LabResult, LabTestComponent
from app.models.patient import Patient
from app.services.admin_health_ai_service import HEALTH_AI_ADMIN_SETTING_KEY
from app.services.health_ai_provider import HealthAiProviderError
from app.services.health_ai_request_guard import HealthAiRequestGuard
from app.services.health_ai_service import HealthAiProviderOutput, HealthAiRuntime


class FakeHealthAiProvider:
    def __init__(self, output: HealthAiProviderOutput):
        self.output = output
        self.calls: list[dict] = []

    async def answer(self, *, system_prompt: str, payload: dict):
        self.calls.append(
            {
                "system_prompt": system_prompt,
                "payload": payload,
            }
        )
        return self.output


class FailingHealthAiProvider:
    def __init__(self):
        self.calls = 0

    async def answer(self, *, system_prompt: str, payload: dict):
        self.calls += 1
        raise HealthAiProviderError(
            "health_ai_provider_unavailable",
            "The local model is unavailable",
            503,
        )


def _runtime(provider=None, *, enabled=True):
    return HealthAiRuntime(
        enabled=enabled,
        available=enabled and provider is not None,
        provider_name="local_openai_compatible",
        model="fixture-local-model" if enabled else None,
        processing_location="家庭服务器",
        reason_code=None if enabled and provider is not None else "not_configured",
        provider=provider,
        processing_mode="local" if enabled else "off",
        test_mode=False,
    )


def _add_formal_records(db_session, patient_id: int):
    old_lab = LabResult(
        patient_id=patient_id,
        test_name="血脂",
        status="completed",
        completed_date=date(2018, 1, 10),
        created_at=datetime(2018, 1, 10, tzinfo=timezone.utc),
    )
    recent_lab = LabResult(
        patient_id=patient_id,
        test_name="血脂",
        status="completed",
        completed_date=date(2025, 3, 1),
        created_at=datetime(2025, 3, 1, tzinfo=timezone.utc),
    )
    db_session.add_all([old_lab, recent_lab])
    db_session.flush()
    old_component = LabTestComponent(
        lab_result_id=old_lab.id,
        test_name="低密度脂蛋白",
        canonical_test_name="LDL cholesterol",
        value=2.9,
        unit="mmol/L",
        status="normal",
    )
    recent_component = LabTestComponent(
        lab_result_id=recent_lab.id,
        test_name="低密度脂蛋白",
        canonical_test_name="LDL cholesterol",
        value=3.4,
        unit="mmol/L",
        status="high",
    )
    vital = Vitals(
        patient_id=patient_id,
        recorded_date=datetime(2025, 4, 1, tzinfo=timezone.utc),
        systolic_bp=126,
        diastolic_bp=82,
        weight=150,
        temperature=98.6,
    )
    db_session.add_all([old_component, recent_component, vital])
    db_session.commit()
    return old_component, recent_component, vital


def _answer_output(*citation_ids: str) -> HealthAiProviderOutput:
    values = {
        "R1": "3.4 mmol/L",
        "R2": "126/82 mmHg",
    }
    rendered_values = "；".join(
        f"{citation_id}={values.get(citation_id, '3.4 mmol/L')}"
        for citation_id in citation_ids
    )
    return HealthAiProviderOutput.model_validate(
        {
            "answer_items": [
                {
                    "text": f"所选记录：{rendered_values}。需要继续观察记录变化。",
                    "citation_ids": list(citation_ids),
                }
            ],
            "general_explanations": ["趋势只能说明记录变化，不能单独用于诊断。"],
            "limitations": ["当前只纳入了用户选择的结构化记录。"],
            "next_steps": ["可携带这些记录向医生确认复查安排。"],
        }
    )


def _question_payload(*record_ids: str, range_id: str = "1y") -> dict:
    return {
        "question_id": "recent_changes",
        "question": "最近有哪些变化？",
        "range": range_id,
        "record_ids": list(record_ids),
    }


def test_capability_is_visible_but_disabled_by_default_for_owner_only(
    authenticated_client,
    test_patient,
    db_session,
    test_recipient,
):
    app.dependency_overrides[get_health_ai_runtime] = lambda: _runtime(enabled=False)

    response = authenticated_client.get(
        f"/api/v1/health-ai/subjects/{test_patient.id}/capabilities"
    )

    assert response.status_code == 200
    assert response.json() == {
        "available": False,
        "provider": "disabled",
        "model": None,
        "processing_mode": "off",
        "test_mode": False,
        "processing_location": "家庭服务器",
        "reason_code": "unavailable",
        "local_handoff_available": True,
        "supported_question_ids": ["recent_changes"],
        "screening_question_available": False,
    }

    other_patient = Patient(
        user_id=test_recipient.id,
        first_name="Other",
        last_name="Person",
        birth_date=date(1991, 1, 1),
        gender="F",
        owner_user_id=test_recipient.id,
    )
    db_session.add(other_patient)
    db_session.commit()
    denied = authenticated_client.get(
        f"/api/v1/health-ai/subjects/{other_patient.id}/capabilities"
    )
    assert denied.status_code == 404


def test_question_requires_valid_idempotency_key_before_provider(
    authenticated_client,
    test_patient,
    db_session,
):
    _, recent_component, _ = _add_formal_records(db_session, test_patient.id)
    provider = FakeHealthAiProvider(_answer_output("R1"))
    app.dependency_overrides[get_health_ai_runtime] = lambda: _runtime(provider)
    url = f"/api/v1/health-ai/subjects/{test_patient.id}/questions"
    payload = _question_payload(f"lab:{recent_component.id}")

    missing = authenticated_client.post(url, json=payload)
    invalid = authenticated_client.post(
        url,
        json=payload,
        headers={"Idempotency-Key": "bad key"},
    )

    assert missing.status_code == 400
    assert missing.headers["x-error-code"] == "health_ai_idempotency_key_required"
    assert invalid.status_code == 400
    assert invalid.headers["x-error-code"] == "health_ai_idempotency_key_invalid"
    assert provider.calls == []
    assert db_session.query(HealthAiAnswer).count() == 0
    assert db_session.query(HealthAiRequest).count() == 0


def test_question_successful_replay_reuses_answer_without_provider_or_budget(
    authenticated_client,
    test_patient,
    db_session,
):
    _, recent_component, _ = _add_formal_records(db_session, test_patient.id)
    provider = FakeHealthAiProvider(_answer_output("R1"))
    app.dependency_overrides[get_health_ai_runtime] = lambda: _runtime(provider)
    url = f"/api/v1/health-ai/subjects/{test_patient.id}/questions"
    payload = _question_payload(f"lab:{recent_component.id}")
    headers = {"Idempotency-Key": "synthetic-ai-replay-0001"}

    first = authenticated_client.post(url, json=payload, headers=headers)
    replay = authenticated_client.post(url, json=payload, headers=headers)

    assert first.status_code == 200
    assert replay.status_code == 200
    assert replay.json()["answer_id"] == first.json()["answer_id"]
    assert replay.json()["request_id"] == first.json()["request_id"]
    assert replay.headers["idempotency-replayed"] == "true"
    assert len(provider.calls) == 1
    assert db_session.query(HealthAiAnswer).count() == 1
    assert (
        db_session.query(ActivityLog)
        .filter(ActivityLog.entity_type == "health_ai_question")
        .count()
        == 1
    )


def test_question_replays_completed_answer_even_after_provider_is_disabled(
    authenticated_client,
    test_patient,
    db_session,
):
    _, recent_component, _ = _add_formal_records(db_session, test_patient.id)
    provider = FakeHealthAiProvider(_answer_output("R1"))
    app.dependency_overrides[get_health_ai_runtime] = lambda: _runtime(provider)
    url = f"/api/v1/health-ai/subjects/{test_patient.id}/questions"
    payload = _question_payload(f"lab:{recent_component.id}")
    headers = {"Idempotency-Key": "synthetic-ai-disabled-replay-0001"}

    first = authenticated_client.post(url, json=payload, headers=headers)
    app.dependency_overrides[get_health_ai_runtime] = lambda: _runtime(enabled=False)
    replay = authenticated_client.post(url, json=payload, headers=headers)

    assert first.status_code == 200
    assert replay.status_code == 200
    assert replay.json()["answer_id"] == first.json()["answer_id"]
    assert replay.headers["idempotency-replayed"] == "true"
    assert len(provider.calls) == 1


def test_question_terminal_provider_failure_is_replayed_without_second_call(
    authenticated_client,
    test_patient,
    db_session,
):
    _, recent_component, _ = _add_formal_records(db_session, test_patient.id)
    provider = FailingHealthAiProvider()
    app.dependency_overrides[get_health_ai_runtime] = lambda: _runtime(provider)
    url = f"/api/v1/health-ai/subjects/{test_patient.id}/questions"
    payload = _question_payload(f"lab:{recent_component.id}")
    headers = {"Idempotency-Key": "synthetic-ai-failed-replay-0001"}

    first = authenticated_client.post(url, json=payload, headers=headers)
    replay = authenticated_client.post(url, json=payload, headers=headers)

    assert first.status_code == 503
    assert replay.status_code == 503
    assert first.headers["x-error-code"] == "health_ai_provider_unavailable"
    assert replay.headers["x-error-code"] == "health_ai_provider_unavailable"
    assert replay.headers["idempotency-replayed"] == "true"
    assert provider.calls == 1
    assert db_session.query(HealthAiAnswer).count() == 0
    ledger = db_session.query(HealthAiRequest).one()
    assert ledger.status == "failed"
    assert ledger.safe_error_code == "health_ai_provider_unavailable"


def test_question_idempotency_key_cannot_change_payload(
    authenticated_client,
    test_patient,
    db_session,
):
    old_component, recent_component, _ = _add_formal_records(
        db_session,
        test_patient.id,
    )
    provider = FakeHealthAiProvider(_answer_output("R1"))
    app.dependency_overrides[get_health_ai_runtime] = lambda: _runtime(provider)
    url = f"/api/v1/health-ai/subjects/{test_patient.id}/questions"
    headers = {"Idempotency-Key": "synthetic-ai-conflict-0001"}

    first = authenticated_client.post(
        url,
        json=_question_payload(f"lab:{recent_component.id}"),
        headers=headers,
    )
    conflict = authenticated_client.post(
        url,
        json=_question_payload(
            f"lab:{old_component.id}",
            f"lab:{recent_component.id}",
            range_id="all",
        ),
        headers=headers,
    )

    assert first.status_code == 200
    assert conflict.status_code == 409
    assert conflict.headers["x-error-code"] == "health_ai_idempotency_conflict"
    assert len(provider.calls) == 1
    assert db_session.query(HealthAiAnswer).count() == 1


def test_question_persistent_per_user_budget_rejects_next_new_request(
    authenticated_client,
    test_patient,
    db_session,
    monkeypatch,
):
    _, recent_component, _ = _add_formal_records(db_session, test_patient.id)
    provider = FakeHealthAiProvider(_answer_output("R1"))
    app.dependency_overrides[get_health_ai_runtime] = lambda: _runtime(provider)
    monkeypatch.setattr(settings, "HEALTH_AI_RATE_LIMIT_REQUESTS", 2, raising=False)
    monkeypatch.setattr(
        settings,
        "HEALTH_AI_RATE_LIMIT_WINDOW_SECONDS",
        600,
        raising=False,
    )
    url = f"/api/v1/health-ai/subjects/{test_patient.id}/questions"
    payload = _question_payload(f"lab:{recent_component.id}")

    first = authenticated_client.post(
        url,
        json=payload,
        headers={"Idempotency-Key": "synthetic-ai-budget-0001"},
    )
    second = authenticated_client.post(
        url,
        json=payload,
        headers={"Idempotency-Key": "synthetic-ai-budget-0002"},
    )
    limited = authenticated_client.post(
        url,
        json=payload,
        headers={"Idempotency-Key": "synthetic-ai-budget-0003"},
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert limited.status_code == 429
    assert limited.headers["x-error-code"] == "health_ai_rate_limit_exceeded"
    assert int(limited.headers["retry-after"]) >= 1
    assert limited.headers["x-ratelimit-limit"] == "2"
    assert limited.headers["x-ratelimit-remaining"] == "0"
    assert len(provider.calls) == 2
    assert db_session.query(HealthAiAnswer).count() == 2


def test_deleted_answer_idempotency_tombstone_does_not_regenerate(
    authenticated_client,
    test_patient,
    db_session,
):
    _, recent_component, _ = _add_formal_records(db_session, test_patient.id)
    provider = FakeHealthAiProvider(_answer_output("R1"))
    app.dependency_overrides[get_health_ai_runtime] = lambda: _runtime(provider)
    url = f"/api/v1/health-ai/subjects/{test_patient.id}/questions"
    payload = _question_payload(f"lab:{recent_component.id}")
    headers = {"Idempotency-Key": "synthetic-ai-deleted-0001"}

    first = authenticated_client.post(url, json=payload, headers=headers)
    deleted = authenticated_client.delete(
        f"/api/v1/health-ai/subjects/{test_patient.id}/answers/"
        f"{first.json()['answer_id']}"
    )
    replay = authenticated_client.post(url, json=payload, headers=headers)

    assert first.status_code == 200
    assert deleted.status_code == 200
    assert replay.status_code == 410
    assert replay.headers["x-error-code"] == "health_ai_idempotent_result_deleted"
    assert len(provider.calls) == 1
    assert db_session.query(HealthAiAnswer).count() == 0


def test_replay_reports_deleted_tombstone_when_answer_is_deleted_after_admission(
    authenticated_client,
    test_patient,
    db_session,
    monkeypatch,
):
    _, recent_component, _ = _add_formal_records(db_session, test_patient.id)
    provider = FakeHealthAiProvider(_answer_output("R1"))
    app.dependency_overrides[get_health_ai_runtime] = lambda: _runtime(provider)
    url = f"/api/v1/health-ai/subjects/{test_patient.id}/questions"
    payload = _question_payload(f"lab:{recent_component.id}")
    headers = {"Idempotency-Key": "synthetic-ai-delete-race-0001"}

    first = authenticated_client.post(url, json=payload, headers=headers)
    answer_id = first.json()["answer_id"]
    original_resolve_existing = HealthAiRequestGuard.resolve_existing

    def resolve_existing_then_delete(self, **kwargs):
        admission = original_resolve_existing(self, **kwargs)
        if admission is not None and admission.disposition == "replayed":
            self.db.query(HealthAiAnswer).filter(
                HealthAiAnswer.id == admission.answer_id
            ).delete(synchronize_session=False)
            self.db.commit()
        return admission

    monkeypatch.setattr(
        HealthAiRequestGuard,
        "resolve_existing",
        resolve_existing_then_delete,
    )
    replay = authenticated_client.post(url, json=payload, headers=headers)

    assert first.status_code == 200
    assert replay.status_code == 410
    assert replay.headers["x-error-code"] == "health_ai_idempotent_result_deleted"
    assert replay.headers["idempotency-replayed"] == "true"
    assert db_session.get(HealthAiAnswer, answer_id) is None
    assert len(provider.calls) == 1


def test_question_resolves_formal_records_server_side_and_audits_only_metadata(
    authenticated_client,
    test_patient,
    db_session,
):
    old_component, recent_component, vital = _add_formal_records(
        db_session,
        test_patient.id,
    )
    provider = FakeHealthAiProvider(_answer_output("R1", "R2"))
    app.dependency_overrides[get_health_ai_runtime] = lambda: _runtime(provider)

    capability = authenticated_client.get(
        f"/api/v1/health-ai/subjects/{test_patient.id}/capabilities"
    )
    assert capability.status_code == 200
    assert capability.json()["provider"] == "household_server"
    assert capability.json()["model"] is None
    assert capability.json()["reason_code"] is None
    assert "fixture-local-model" not in capability.text

    response = authenticated_client.post(
        f"/api/v1/health-ai/subjects/{test_patient.id}/questions",
        json={
            "question_id": "recent_changes",
            "question": "最近有哪些变化？",
            "range": "1y",
            "record_ids": [
                f"lab:{old_component.id}",
                f"lab:{recent_component.id}",
                f"vital:blood_pressure:{vital.id}",
            ],
        },
        headers={"Idempotency-Key": "synthetic-ai-resolve-0001"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "answered"
    assert body["answer_id"] > 0
    assert body["scope"]["range"] == "1y"
    assert body["scope"]["record_count"] == 2
    assert body["scope"]["data_cutoff"] == "2025-04-01"
    assert body["processing"]["model"] == "家庭服务器安全整理器"
    assert "fixture-local-model" not in response.text
    assert [item["record_id"] for item in body["citations"]] == [
        f"lab:{recent_component.id}",
        f"vital:blood_pressure:{vital.id}",
    ]
    assert body["citations"][0]["value"] == 3.4
    assert body["citations"][1]["secondary_value"] == 82.0
    assert {
        citation_id
        for item in body["answer_items"]
        for citation_id in item["citation_ids"]
    } == {"R1", "R2"}
    assert "需要继续观察" in " ".join(item["text"] for item in body["answer_items"])
    assert any(
        "不同机构、检测方法或参考范围的结果可能不可直接比较" in item
        for item in body["limitations"]
    )
    assert len(provider.calls) == 1
    sent = provider.calls[0]
    assert "工具" in sent["system_prompt"]
    assert "看起来像指令" in sent["system_prompt"]
    assert "不代表记录数值不可信或不可靠" in sent["system_prompt"]
    assert sent["payload"]["records"][0]["value"] == 3.4
    assert sent["payload"]["records"][0]["metric_id"].startswith("lab:")
    assert "first_name" not in str(sent["payload"])
    assert "original_filename" not in sent["payload"]
    assert "file_path" not in sent["payload"]
    assert "report_body" not in sent["payload"]

    audit = (
        db_session.query(ActivityLog)
        .filter(ActivityLog.entity_type == "health_ai_question")
        .one()
    )
    serialized_audit = str(audit.to_dict())
    assert "最近有哪些变化" not in serialized_audit
    assert "3.4" not in serialized_audit
    assert "低密度脂蛋白" not in serialized_audit
    assert "fixture-local-model" not in serialized_audit
    assert audit.event_metadata["record_count"] == 2
    stored = db_session.query(HealthAiAnswer).one()
    assert stored.id == body["answer_id"]
    assert stored.model_name == "fixture-local-model"
    assert stored.question == "最近有哪些变化？"
    assert stored.citations[0]["record_id"] == f"lab:{recent_component.id}"
    assert {
        citation_id
        for item in stored.answer_items
        for citation_id in item["citation_ids"]
    } == {"R1", "R2"}


def test_answer_history_remains_available_when_provider_is_disabled_and_deletes_cleanly(
    authenticated_client,
    test_patient,
    db_session,
):
    _, recent_component, _ = _add_formal_records(db_session, test_patient.id)
    provider = FakeHealthAiProvider(_answer_output("R1"))
    app.dependency_overrides[get_health_ai_runtime] = lambda: _runtime(provider)
    created = authenticated_client.post(
        f"/api/v1/health-ai/subjects/{test_patient.id}/questions",
        json={
            "question_id": "recent_changes",
            "question": "最近有哪些变化？",
            "range": "all",
            "record_ids": [f"lab:{recent_component.id}"],
        },
        headers={"Idempotency-Key": "synthetic-ai-history-0001"},
    )
    assert created.status_code == 200
    answer_id = created.json()["answer_id"]
    assert created.json()["citations"][0]["available"] is True
    assert created.json()["citations"][0]["metric_id"].startswith("lab:")

    app.dependency_overrides[get_health_ai_runtime] = lambda: _runtime(enabled=False)
    history = authenticated_client.get(
        f"/api/v1/health-ai/subjects/{test_patient.id}/answers"
    )
    assert history.status_code == 200
    assert history.json()["total"] == 1
    assert history.json()["items"][0]["answer_id"] == answer_id
    assert history.json()["items"][0]["question"] == "最近有哪些变化？"
    assert history.json()["items"][0]["provider"] == "local_openai_compatible"
    assert history.json()["items"][0]["test_mode"] is False

    recent_component.value = 9.9
    db_session.commit()
    revised_detail = authenticated_client.get(
        f"/api/v1/health-ai/subjects/{test_patient.id}/answers/{answer_id}"
    )
    assert revised_detail.status_code == 200
    assert revised_detail.json()["citations"][0]["available"] is False

    recent_component.value = 3.4
    db_session.commit()

    result = db_session.get(LabResult, recent_component.lab_result_id)
    result.status = "cancelled"
    db_session.commit()
    detail = authenticated_client.get(
        f"/api/v1/health-ai/subjects/{test_patient.id}/answers/{answer_id}"
    )
    assert detail.status_code == 200
    assert detail.json()["answer_items"][0]["text"]
    assert detail.json()["citations"][0]["available"] is False

    deleted = authenticated_client.delete(
        f"/api/v1/health-ai/subjects/{test_patient.id}/answers/{answer_id}"
    )
    assert deleted.status_code == 200
    assert deleted.json() == {"status": "deleted", "answer_id": answer_id}
    assert db_session.get(HealthAiAnswer, answer_id) is None
    assert (
        authenticated_client.get(
            f"/api/v1/health-ai/subjects/{test_patient.id}/answers/{answer_id}"
        ).status_code
        == 404
    )
    delete_audit = (
        db_session.query(ActivityLog)
        .filter(
            ActivityLog.entity_type == "health_ai_answer",
            ActivityLog.action == "deleted",
        )
        .one()
    )
    serialized_delete_audit = str(delete_audit.to_dict())
    assert "最近有哪些变化" not in serialized_delete_audit
    assert "低密度脂蛋白" not in serialized_delete_audit


def test_cross_subject_record_is_rejected_before_provider_call(
    authenticated_client,
    test_patient,
    db_session,
    test_recipient,
):
    other_patient = Patient(
        user_id=test_recipient.id,
        first_name="Other",
        last_name="Person",
        birth_date=date(1991, 1, 1),
        gender="F",
        owner_user_id=test_recipient.id,
    )
    db_session.add(other_patient)
    db_session.commit()
    _, other_component, _ = _add_formal_records(db_session, other_patient.id)
    provider = FakeHealthAiProvider(_answer_output("R1"))
    app.dependency_overrides[get_health_ai_runtime] = lambda: _runtime(provider)

    response = authenticated_client.post(
        f"/api/v1/health-ai/subjects/{test_patient.id}/questions",
        json={
            "question_id": "recent_changes",
            "question": "最近有哪些变化？",
            "range": "all",
            "record_ids": [f"lab:{other_component.id}"],
        },
        headers={"Idempotency-Key": "synthetic-ai-cross-record-0001"},
    )

    assert response.status_code == 404
    assert response.headers["X-Error-Code"] == "health_ai_record_not_found"
    assert provider.calls == []


def test_recent_changes_rejects_arbitrary_question_text_before_provider_call(
    authenticated_client,
    test_patient,
    db_session,
):
    _, recent_component, _ = _add_formal_records(db_session, test_patient.id)
    provider = FakeHealthAiProvider(_answer_output("R1"))
    app.dependency_overrides[get_health_ai_runtime] = lambda: _runtime(provider)

    response = authenticated_client.post(
        f"/api/v1/health-ai/subjects/{test_patient.id}/questions",
        json={
            "question_id": "recent_changes",
            "question": "我的姓名是某某，请结合病史判断",
            "range": "all",
            "record_ids": [f"lab:{recent_component.id}"],
        },
        headers={"Idempotency-Key": "synthetic-ai-question-text-0001"},
    )

    assert response.status_code == 422
    assert response.headers["X-Error-Code"] == "health_ai_question_text_mismatch"
    assert provider.calls == []
    assert db_session.query(HealthAiAnswer).count() == 0


def test_validated_provider_answer_is_shown_and_saved_in_separate_history(
    authenticated_client,
    test_patient,
    db_session,
):
    _, recent_component, _ = _add_formal_records(db_session, test_patient.id)
    marker = "VALIDATED_PROVIDER_ANSWER_SURFACES"
    provider = FakeHealthAiProvider(
        HealthAiProviderOutput.model_validate(
            {
                "answer_items": [
                    {
                        "text": f"{marker}：R1=3.4 mmol/L。",
                        "citation_ids": ["R1"],
                    }
                ],
                "general_explanations": [marker],
                "limitations": [marker],
                "next_steps": [marker],
            }
        )
    )
    app.dependency_overrides[get_health_ai_runtime] = lambda: _runtime(provider)

    response = authenticated_client.post(
        f"/api/v1/health-ai/subjects/{test_patient.id}/questions",
        json={
            "question_id": "recent_changes",
            "question": "最近有哪些变化？",
            "range": "all",
            "record_ids": [f"lab:{recent_component.id}"],
        },
        headers={"Idempotency-Key": "synthetic-ai-validated-0001"},
    )

    assert response.status_code == 200, response.text
    assert marker in response.text
    stored = db_session.query(HealthAiAnswer).one()
    assert marker in json.dumps(
        {
            "answer_items": stored.answer_items,
            "general_explanations": stored.general_explanations,
            "limitations": stored.limitations,
            "next_steps": stored.next_steps,
        }
    )


def test_question_rejects_client_supplied_health_values(
    authenticated_client,
    test_patient,
    db_session,
):
    _, recent_component, _ = _add_formal_records(db_session, test_patient.id)
    provider = FakeHealthAiProvider(_answer_output("R1"))
    app.dependency_overrides[get_health_ai_runtime] = lambda: _runtime(provider)

    response = authenticated_client.post(
        f"/api/v1/health-ai/subjects/{test_patient.id}/questions",
        json={
            "question_id": "recent_changes",
            "question": "最近有哪些变化？",
            "range": "all",
            "record_ids": [f"lab:{recent_component.id}"],
            "health_values": [{"value": 999, "label": "客户端伪造值"}],
        },
        headers={"Idempotency-Key": "synthetic-ai-client-values-0001"},
    )

    assert response.status_code == 422
    assert provider.calls == []


def test_unknown_model_citation_and_screening_question_fail_closed(
    authenticated_client,
    test_patient,
    db_session,
):
    _, recent_component, _ = _add_formal_records(db_session, test_patient.id)
    provider = FakeHealthAiProvider(_answer_output("R999"))
    app.dependency_overrides[get_health_ai_runtime] = lambda: _runtime(provider)

    invalid_citation = authenticated_client.post(
        f"/api/v1/health-ai/subjects/{test_patient.id}/questions",
        json={
            "question_id": "recent_changes",
            "question": "最近有哪些变化？",
            "range": "all",
            "record_ids": [f"lab:{recent_component.id}"],
        },
        headers={"Idempotency-Key": "synthetic-ai-bad-citation-0001"},
    )
    assert invalid_citation.status_code == 502
    assert (
        invalid_citation.headers["X-Error-Code"] == "health_ai_invalid_model_citation"
    )

    screening = authenticated_client.post(
        f"/api/v1/health-ai/subjects/{test_patient.id}/questions",
        json={
            "question_id": "screening_schedule",
            "question": "哪些检查需要安排？",
            "range": "all",
            "record_ids": [f"lab:{recent_component.id}"],
        },
        headers={"Idempotency-Key": "synthetic-ai-screening-0001"},
    )
    assert screening.status_code == 409
    assert screening.headers["X-Error-Code"] == "health_ai_screening_state_unavailable"
    assert len(provider.calls) == 1


def test_personalized_diagnosis_or_safety_guarantee_is_withheld(
    authenticated_client,
    test_patient,
    db_session,
):
    _, recent_component, _ = _add_formal_records(db_session, test_patient.id)
    unsafe = HealthAiProviderOutput.model_validate(
        {
            "answer_items": [
                {
                    "text": "根据这条记录你可以放心，不必复查。",
                    "citation_ids": ["R1"],
                }
            ],
            "general_explanations": [],
            "limitations": [],
            "next_steps": [],
        }
    )
    provider = FakeHealthAiProvider(unsafe)
    app.dependency_overrides[get_health_ai_runtime] = lambda: _runtime(provider)

    response = authenticated_client.post(
        f"/api/v1/health-ai/subjects/{test_patient.id}/questions",
        json={
            "question_id": "recent_changes",
            "question": "最近有哪些变化？",
            "range": "all",
            "record_ids": [f"lab:{recent_component.id}"],
        },
        headers={"Idempotency-Key": "synthetic-ai-unsafe-0001"},
    )

    assert response.status_code == 502
    assert response.headers["X-Error-Code"] == "health_ai_unsafe_model_output"
    assert db_session.query(HealthAiAnswer).count() == 0


@pytest.mark.parametrize(
    "base_url",
    [
        "https://api.openai.com/v1",
        "http://192.168.1.10:11434/v1",
        "http://localhost:11434/v1?redirect=https://example.com",
        "http://user:pass@localhost:11434/v1",
    ],
)
def test_runtime_rejects_non_local_or_ambiguous_provider_urls(base_url):
    from app.services.health_ai_provider import build_health_ai_runtime

    runtime = build_health_ai_runtime(
        enabled=True,
        provider_name="local_openai_compatible",
        base_url=base_url,
        model="fixture-model",
        api_key="",
    )

    assert runtime.available is False
    assert runtime.reason_code == "invalid_local_endpoint"


def test_member_question_uses_persisted_dynamic_test_provider_end_to_end(
    authenticated_client,
    test_patient,
    db_session,
    monkeypatch,
):
    _old_component, recent_component, vital = _add_formal_records(
        db_session,
        test_patient.id,
    )
    monkeypatch.setattr(settings, "HEALTH_AI_TEST_PROVIDER_ALLOWED", True)
    monkeypatch.setattr(settings, "INSTANCE_DATA_CLASS", "synthetic")
    system_setting.set_setting(
        db_session,
        HEALTH_AI_ADMIN_SETTING_KEY,
        json.dumps(
            {
                "revision": 1,
                "mode": "test",
                "base_url": "",
                "model": "",
                "verified_revision": 0,
                "verified_at": None,
            }
        ),
    )

    response = authenticated_client.post(
        f"/api/v1/health-ai/subjects/{test_patient.id}/questions",
        json={
            "question_id": "recent_changes",
            "question": "最近有哪些变化？",
            "range": "all",
            "record_ids": [
                f"lab:{recent_component.id}",
                f"vital:weight:{vital.id}",
                f"vital:temperature:{vital.id}",
            ],
        },
        headers={"Idempotency-Key": "synthetic-ai-dynamic-0001"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["processing"]["processing_mode"] == "test"
    assert body["processing"]["test_mode"] is True
    assert body["processing"]["provider"] == "dynamic_test"
    assert body["processing"]["model"] == "虚构规则测试器（非模型）"
    answer_text = " ".join(item["text"] for item in body["answer_items"])
    assert "3.4mmol/L" in answer_text
    assert "68kg" in answer_text
    assert "37°C" in answer_text
    assert {(item["unit"], item["value"]) for item in body["citations"]} == {
        ("mmol/L", 3.4),
        ("kg", 68.0),
        ("°C", 37.0),
    }
    assert any("未调用真实大模型" in item for item in body["limitations"])
