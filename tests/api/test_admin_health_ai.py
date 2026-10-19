"""Synthetic contracts for the sole-administrator health AI controls."""

import json

import pytest

from app.core.config import settings
from app.crud.system_setting import system_setting
from app.crud.user import user as user_crud
from app.models.activity_log import ActivityLog
from app.models.health_ai import HealthAiAnswer
from app.schemas.health_ai import HealthAiProviderOutput
from app.schemas.user import UserCreate
from app.services import admin_health_ai_service
from app.services.admin_health_ai_service import (
    HEALTH_AI_ADMIN_SETTING_KEY,
    HealthAiAdminConfiguration,
)
from app.services.health_ai_provider import HealthAiRuntime


def _update_payload(**overrides):
    payload = {
        "expected_revision": 0,
        "mode": "off",
        "base_url": "",
        "model": "",
        "reason": "更新家庭服务器 AI 测试配置",
    }
    payload.update(overrides)
    return payload


def test_health_ai_settings_are_default_off_admin_only_and_never_accept_keys(
    client,
    admin_token_headers,
    user_token_headers,
):
    response = client.get(
        "/api/v1/admin/health-ai/settings",
        headers=admin_token_headers,
    )

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["selected_mode"] == "off"
    assert body["effective_mode"] == "off"
    assert body["available"] is False
    assert body["configuration_revision"] == 0
    assert body["verified_revision"] == 0
    assert body["connection_test_required"] is False
    assert body["api_key_configured"] is False
    assert (
        client.get(
            "/api/v1/admin/health-ai/settings",
            headers=user_token_headers,
        ).status_code
        == 403
    )

    rejected = client.put(
        "/api/v1/admin/health-ai/settings",
        headers=admin_token_headers,
        json={**_update_payload(), "api_key": "must-not-be-accepted"},
    )
    assert rejected.status_code == 422
    assert "must-not-be-accepted" not in rejected.text


def test_dynamic_test_mode_runs_through_admin_contract_without_member_data(
    client,
    db_session,
    test_admin_user,
    admin_token_headers,
    monkeypatch,
):
    monkeypatch.setattr(settings, "HEALTH_AI_TEST_PROVIDER_ALLOWED", True)
    monkeypatch.setattr(settings, "INSTANCE_DATA_CLASS", "synthetic")

    saved = client.put(
        "/api/v1/admin/health-ai/settings",
        headers=admin_token_headers,
        json=_update_payload(mode="test"),
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["selected_mode"] == "test"
    assert saved.json()["effective_mode"] == "test"
    assert saved.json()["provider"] == "dynamic_test"
    assert saved.json()["configuration_revision"] == 1

    tested = client.post(
        "/api/v1/admin/health-ai/test-connection",
        headers=admin_token_headers,
        json={
            "expected_revision": 1,
            "reason": "验证虚构数据问答链路",
        },
    )
    assert tested.status_code == 200, tested.text
    payload = tested.json()
    assert payload["status"] == "passed"
    assert payload["configuration_revision"] == 1
    assert payload["verified_revision"] == 0
    assert payload["processing_mode"] == "test"
    assert payload["test_mode"] is True
    assert payload["provider"] == "dynamic_test"
    assert "未调用真实大模型" in payload["disclosure"]
    assert payload["output"]["answer_items"][0]["citation_ids"] == ["R1", "R2"]
    assert db_session.query(HealthAiAnswer).count() == 0

    raw = system_setting.get_setting(db_session, HEALTH_AI_ADMIN_SETTING_KEY)
    stored = json.loads(raw)
    assert stored == {
        "base_url": "",
        "mode": "test",
        "model": "",
        "revision": 1,
        "verified_at": None,
        "verified_revision": 0,
        "verified_secret_fingerprint": None,
    }
    audits = (
        db_session.query(ActivityLog)
        .filter(ActivityLog.entity_type == "health_ai_configuration")
        .order_by(ActivityLog.id)
        .all()
    )
    assert [audit.action for audit in audits] == ["updated", "tested"]
    serialized = str([audit.event_metadata for audit in audits])
    assert "5.1" not in serialized
    assert "5.4" not in serialized
    assert "虚构指标甲" not in serialized
    assert "base_url" not in serialized
    assert all(audit.user_id == test_admin_user.id for audit in audits)


def test_connection_test_rejects_unsafe_provider_text_without_a_passed_audit(
    client,
    db_session,
    admin_token_headers,
    monkeypatch,
):
    class UnsafeProvider:
        async def answer(self, *, system_prompt: str, payload: dict):
            del system_prompt, payload
            return HealthAiProviderOutput.model_validate(
                {
                    "answer_items": [
                        {
                            "text": "你可以放心，无需复查。",
                            "citation_ids": ["R1"],
                        }
                    ],
                    "general_explanations": [],
                    "limitations": [],
                    "next_steps": [],
                }
            )

    system_setting.set_setting(
        db_session,
        HEALTH_AI_ADMIN_SETTING_KEY,
        json.dumps(
            {
                "revision": 1,
                "mode": "local",
                "base_url": "http://127.0.0.1:11434/v1",
                "model": "synthetic-local-model",
                "verified_revision": 0,
                "verified_at": None,
                "verified_secret_fingerprint": None,
            }
        ),
    )
    monkeypatch.setattr(
        admin_health_ai_service,
        "build_persisted_health_ai_runtime",
        lambda _db, **_kwargs: HealthAiRuntime(
            enabled=True,
            available=True,
            provider_name="local_openai_compatible",
            model="synthetic-local-model",
            processing_location="家庭服务器",
            reason_code=None,
            provider=UnsafeProvider(),
            processing_mode="local",
        ),
    )

    response = client.post(
        "/api/v1/admin/health-ai/test-connection",
        headers=admin_token_headers,
        json={
            "expected_revision": 1,
            "reason": "验证安全输出边界",
        },
    )

    assert response.status_code == 502
    assert response.headers["X-Error-Code"] == "health_ai_unsafe_model_output"
    failed_audits = (
        db_session.query(ActivityLog)
        .filter(
            ActivityLog.entity_type == "health_ai_configuration",
            ActivityLog.action == "tested",
        )
        .all()
    )
    assert len(failed_audits) == 1
    assert failed_audits[0].event_metadata["result"] == "failed"
    assert (
        failed_audits[0].event_metadata["error_code"] == "health_ai_unsafe_model_output"
    )
    serialized = str(failed_audits[0].to_dict())
    assert "你可以放心" not in serialized


def test_local_revision_is_unavailable_until_its_synthetic_connection_test_passes(
    client,
    db_session,
    admin_token_headers,
    monkeypatch,
):
    async def safe_answer(_provider, *, system_prompt: str, payload: dict):
        del system_prompt, payload
        return HealthAiProviderOutput.model_validate(
            {
                "answer_items": [
                    {
                        "text": (
                            "连接测试保留模型返回的安全结构化标记："
                            "R1=5.1u，R2=5.4u。"
                        ),
                        "citation_ids": ["R1", "R2"],
                    }
                ],
                "general_explanations": [],
                "limitations": ["只复述固定虚构记录。"],
                "next_steps": [],
            }
        )

    monkeypatch.setattr(settings, "HEALTH_AI_ENABLED", True)
    monkeypatch.setattr(
        "app.services.health_ai_provider.OpenAICompatibleHealthAiProvider.answer",
        safe_answer,
    )

    saved = client.put(
        "/api/v1/admin/health-ai/settings",
        headers=admin_token_headers,
        json=_update_payload(
            mode="local",
            base_url="http://127.0.0.1:11434/v1",
            model="small-local-model",
        ),
    )

    assert saved.status_code == 200, saved.text
    assert saved.json()["available"] is False
    assert saved.json()["reason_code"] == "connection_test_required"
    assert saved.json()["connection_test_required"] is True

    tested = client.post(
        "/api/v1/admin/health-ai/test-connection",
        headers=admin_token_headers,
        json={
            "expected_revision": 1,
            "reason": "验证当前模型修订",
        },
    )

    assert tested.status_code == 200, tested.text
    assert tested.json()["verified_revision"] == 1
    assert (
        tested.json()["output"]["answer_items"][0]["text"]
        == "连接测试保留模型返回的安全结构化标记：R1=5.1u，R2=5.4u。"
    )
    ready = client.get(
        "/api/v1/admin/health-ai/settings",
        headers=admin_token_headers,
    )
    assert ready.status_code == 200
    assert ready.json()["available"] is True
    assert ready.json()["effective_mode"] == "local"
    assert ready.json()["connection_test_required"] is False
    assert ready.json()["verified_revision"] == 1
    assert ready.json()["last_tested_at"]

    original_api_key = settings.HEALTH_AI_API_KEY
    monkeypatch.setattr(settings, "HEALTH_AI_API_KEY", "rotated-test-secret")
    rotated = client.get(
        "/api/v1/admin/health-ai/settings",
        headers=admin_token_headers,
    )
    assert rotated.status_code == 200
    assert rotated.json()["available"] is False
    assert rotated.json()["reason_code"] == "connection_test_required"
    assert rotated.json()["connection_test_required"] is True
    monkeypatch.setattr(settings, "HEALTH_AI_API_KEY", original_api_key)

    original_verification_contract = (
        admin_health_ai_service.HEALTH_AI_VERIFICATION_CONTRACT_VERSION
    )
    monkeypatch.setattr(
        admin_health_ai_service,
        "HEALTH_AI_VERIFICATION_CONTRACT_VERSION",
        "health-ai-provider-verification@test-changed",
        raising=False,
    )
    contract_changed = client.get(
        "/api/v1/admin/health-ai/settings",
        headers=admin_token_headers,
    )
    assert contract_changed.status_code == 200
    assert contract_changed.json()["available"] is False
    assert contract_changed.json()["reason_code"] == "connection_test_required"
    assert contract_changed.json()["connection_test_required"] is True
    monkeypatch.setattr(
        admin_health_ai_service,
        "HEALTH_AI_VERIFICATION_CONTRACT_VERSION",
        original_verification_contract,
    )

    original_template_version = admin_health_ai_service.AI_TEMPLATE_VERSION
    monkeypatch.setattr(
        admin_health_ai_service,
        "AI_TEMPLATE_VERSION",
        "household-ai-answer@test-changed",
    )
    template_changed = client.get(
        "/api/v1/admin/health-ai/settings",
        headers=admin_token_headers,
    )
    assert template_changed.status_code == 200
    assert template_changed.json()["available"] is False
    assert template_changed.json()["reason_code"] == "connection_test_required"
    assert template_changed.json()["connection_test_required"] is True
    monkeypatch.setattr(
        admin_health_ai_service,
        "AI_TEMPLATE_VERSION",
        original_template_version,
    )

    changed = client.put(
        "/api/v1/admin/health-ai/settings",
        headers=admin_token_headers,
        json=_update_payload(
            expected_revision=1,
            mode="local",
            base_url="http://127.0.0.1:11434/v1",
            model="another-small-model",
        ),
    )
    assert changed.status_code == 200
    assert changed.json()["configuration_revision"] == 2
    assert changed.json()["verified_revision"] == 0
    assert changed.json()["available"] is False
    assert changed.json()["reason_code"] == "connection_test_required"

    stored = json.loads(
        system_setting.get_setting(db_session, HEALTH_AI_ADMIN_SETTING_KEY)
    )
    assert stored["revision"] == 2
    assert stored["verified_revision"] == 0
    assert stored["verified_at"] is None
    assert stored["verified_secret_fingerprint"] is None


@pytest.mark.parametrize(
    "base_url",
    [
        "https://api.openai.com/v1",
        "http://192.168.1.20:11434/v1",
        "http://user:pass@localhost:11434/v1",
        "http://localhost:11434/v1?next=https://example.test",
        "http://localhost:11434/v1#fragment",
    ],
)
def test_local_mode_rejects_non_local_or_ambiguous_urls(
    client,
    admin_token_headers,
    base_url,
):
    response = client.put(
        "/api/v1/admin/health-ai/settings",
        headers=admin_token_headers,
        json=_update_payload(
            mode="local",
            base_url=base_url,
            model="qwen2.5:3b-instruct-q4_K_M",
        ),
    )
    assert response.status_code == 422
    assert response.headers["X-Error-Code"] == "invalid_local_endpoint"


def test_test_mode_requires_synthetic_server_gates(
    client,
    admin_token_headers,
    monkeypatch,
):
    monkeypatch.setattr(settings, "HEALTH_AI_TEST_PROVIDER_ALLOWED", False)
    monkeypatch.setattr(settings, "INSTANCE_DATA_CLASS", "private")
    response = client.put(
        "/api/v1/admin/health-ai/settings",
        headers=admin_token_headers,
        json=_update_payload(mode="test"),
    )
    assert response.status_code == 409
    assert response.headers["X-Error-Code"] == "test_provider_not_allowed"


def test_settings_fail_closed_when_sole_administrator_invariant_breaks(
    client,
    db_session,
    admin_token_headers,
):
    user_crud.create(
        db_session,
        obj_in=UserCreate(
            username="second-ai-admin",
            email="second-ai-admin@synthetic.healthbox.example",
            password="SyntheticPassword123",
            full_name="Second Synthetic AI Admin",
            role="admin",
        ),
    )

    response = client.get(
        "/api/v1/admin/health-ai/settings",
        headers=admin_token_headers,
    )
    assert response.status_code == 409
    assert response.headers["X-Error-Code"] == "sole_active_administrator_required"
    assert system_setting.get_setting(db_session, HEALTH_AI_ADMIN_SETTING_KEY) is None


def test_configuration_revision_conflict_preserves_existing_settings(
    client,
    db_session,
    admin_token_headers,
):
    first = client.put(
        "/api/v1/admin/health-ai/settings",
        headers=admin_token_headers,
        json=_update_payload(),
    )
    assert first.status_code == 200
    before = system_setting.get_setting(db_session, HEALTH_AI_ADMIN_SETTING_KEY)

    conflict = client.put(
        "/api/v1/admin/health-ai/settings",
        headers=admin_token_headers,
        json=_update_payload(expected_revision=0, mode="local"),
    )
    assert conflict.status_code == 409
    assert (
        conflict.headers["X-Error-Code"] == "health_ai_configuration_revision_conflict"
    )
    assert system_setting.get_setting(db_session, HEALTH_AI_ADMIN_SETTING_KEY) == before


def test_first_configuration_insert_race_fails_closed_without_overwrite(
    client,
    db_session,
    admin_token_headers,
    monkeypatch,
):
    existing = json.dumps(
        {
            "revision": 1,
            "mode": "off",
            "base_url": "",
            "model": "",
            "verified_revision": 0,
            "verified_at": None,
            "verified_secret_fingerprint": None,
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    system_setting.set_setting(
        db_session,
        HEALTH_AI_ADMIN_SETTING_KEY,
        existing,
    )

    # Simulate a request that observed the singleton as absent immediately
    # before another request inserted it.
    monkeypatch.setattr(
        admin_health_ai_service,
        "_load_health_ai_configuration_with_raw",
        lambda _db, **_kwargs: (HealthAiAdminConfiguration(), None),
    )
    response = client.put(
        "/api/v1/admin/health-ai/settings",
        headers=admin_token_headers,
        json=_update_payload(expected_revision=0, mode="off"),
    )

    assert response.status_code == 409
    assert (
        response.headers["X-Error-Code"] == "health_ai_configuration_revision_conflict"
    )
    assert (
        system_setting.get_setting(db_session, HEALTH_AI_ADMIN_SETTING_KEY) == existing
    )
