"""Deterministic safety boundary for lightweight household AI providers."""

import pytest

from app.schemas.health_ai import HealthAiProviderOutput
from app.services.health_ai_service import (
    HealthAiError,
    prepare_health_ai_provider_output,
    validate_health_ai_provider_grounding,
    validate_health_ai_provider_safety,
)


def _output(
    text: str = "空腹血糖在所选记录中从 5.1 mmol/L 变为 5.4 mmol/L。",
    *,
    citation_ids: list[str] | None = None,
    general_explanations: list[str] | None = None,
    next_steps: list[str] | None = None,
) -> HealthAiProviderOutput:
    return HealthAiProviderOutput.model_validate(
        {
            "answer_items": [
                {"text": text, "citation_ids": citation_ids or ["R1", "R2"]}
            ],
            "general_explanations": general_explanations or [],
            "limitations": ["只复述所选记录。"],
            "next_steps": next_steps or [],
        }
    )


def test_citation_grounded_record_restatement_is_allowed() -> None:
    validate_health_ai_provider_safety(_output())


def test_grounding_requires_every_cited_record_value_in_the_answer_item() -> None:
    citations = [
        {
            "citation_id": "R1",
            "label": "空腹血糖",
            "value": 2.8,
            "unit": "mmol/L",
        },
        {
            "citation_id": "R2",
            "label": "空腹血糖",
            "value": 3.3,
            "unit": "mmol/L",
        },
    ]

    validate_health_ai_provider_grounding(
        _output("空腹血糖所选记录为 R1=2.8 mmol/L、R2=3.3 mmol/L。"),
        citations=citations,
    )

    with pytest.raises(HealthAiError) as captured:
        validate_health_ai_provider_grounding(
            _output("最近有哪些变化？"),
            citations=citations,
        )

    assert captured.value.code == "health_ai_ungrounded_model_output"


def test_grounding_requires_all_selected_records_to_be_covered() -> None:
    citations = [
        {
            "citation_id": "R1",
            "label": "空腹血糖",
            "value": 2.8,
            "unit": "mmol/L",
        },
        {
            "citation_id": "R2",
            "label": "空腹血糖",
            "value": 3.3,
            "unit": "mmol/L",
        },
    ]

    with pytest.raises(HealthAiError) as captured:
        validate_health_ai_provider_grounding(
            _output(
                "空腹血糖所选记录为 R1=2.8 mmol/L。",
                citation_ids=["R1"],
            ),
            citations=citations,
        )

    assert captured.value.code == "health_ai_ungrounded_model_output"


def test_grounding_rejects_date_or_count_number_coincidence() -> None:
    citations = [
        {
            "citation_id": "R1",
            "label": "空腹血糖",
            "value": 1.0,
            "unit": "mmol/L",
        }
    ]

    with pytest.raises(HealthAiError) as captured:
        validate_health_ai_provider_grounding(
            _output(
                "2026-01-01 共有 1 条记录。",
                citation_ids=["R1"],
            ),
            citations=citations,
        )

    assert captured.value.code == "health_ai_ungrounded_model_output"


def test_grounding_accepts_dual_reading_with_unit() -> None:
    validate_health_ai_provider_grounding(
        _output(
            "血压记录为 R1=120/80 mmHg。",
            citation_ids=["R1"],
        ),
        citations=[
            {
                "citation_id": "R1",
                "label": "血压",
                "value": 120.0,
                "secondary_value": 80.0,
                "unit": "mmHg",
            }
        ],
    )


def test_grounding_requires_the_literal_equals_anchor() -> None:
    with pytest.raises(HealthAiError) as captured:
        validate_health_ai_provider_grounding(
            _output(
                "空腹血糖记录为 R1:3.3 mmol/L。",
                citation_ids=["R1"],
            ),
            citations=[
                {
                    "citation_id": "R1",
                    "label": "空腹血糖",
                    "value": 3.3,
                    "unit": "mmol/L",
                }
            ],
        )

    assert captured.value.code == "health_ai_ungrounded_model_output"


@pytest.mark.parametrize(
    ("text", "citation"),
    [
        (
            "空腹血糖共有 1 条记录。",
            {
                "citation_id": "R1",
                "label": "空腹血糖",
                "value": 1.0,
                "unit": "",
            },
        ),
        (
            "空腹血糖记录日期为 2026-01-01。",
            {
                "citation_id": "R1",
                "label": "空腹血糖",
                "value": -1.0,
                "unit": "",
            },
        ),
        (
            "空腹血糖共有两条记录；无关统计量为 3.3 mmol/L。",
            {
                "citation_id": "R1",
                "label": "空腹血糖",
                "value": 3.3,
                "unit": "mmol/L",
            },
        ),
    ],
)
def test_grounding_rejects_unbound_counts_dates_and_unrelated_statistics(
    text: str,
    citation: dict,
) -> None:
    with pytest.raises(HealthAiError) as captured:
        validate_health_ai_provider_grounding(
            _output(text, citation_ids=["R1"]),
            citations=[citation],
        )

    assert captured.value.code == "health_ai_ungrounded_model_output"


def test_validated_local_answer_is_preserved_with_required_server_limits() -> None:
    original = _output("模型识别到两条所选记录之间存在数值变化。")

    prepared = prepare_health_ai_provider_output(original, test_mode=False)

    assert prepared.answer_items == original.answer_items
    assert prepared.general_explanations == original.general_explanations
    assert prepared.next_steps == original.next_steps
    assert any("家庭服务器模型" in item for item in prepared.limitations)
    assert any(
        "不同机构、检测方法或参考范围的结果可能不可直接比较" in item
        for item in prepared.limitations
    )


@pytest.mark.parametrize(
    "text",
    [
        "You have diabetes.",
        "The patient is diagnosed with hypertension.",
        "建议你把阿司匹林停了。",
        "你不需要复查，可以安心。",
        "No need to see a doctor or arrange follow-up.",
        "Stop taking aspirin and decrease the dose.",
        "Your chance of cancer is 35%.",
        "这些数据是不可信的，因为它们可能包含不可靠的信息。",
        "The records are untrusted and therefore unreliable.",
        "血糖结果提示糖尿病。",
        "血糖结果显示糖尿病。",
        "这是糖尿病。",
        "可以不用复查，也不用看医生。",
        "可以不去复查，也别看医生。",
        "The result shows diabetes.",
    ],
)
def test_diagnosis_assurance_medication_and_probability_claims_are_rejected(
    text: str,
) -> None:
    with pytest.raises(HealthAiError) as captured:
        validate_health_ai_provider_safety(_output(text))

    assert captured.value.code == "health_ai_unsafe_model_output"


@pytest.mark.parametrize(
    "field",
    ["general_explanations", "next_steps"],
)
def test_general_sections_cannot_address_the_individual(field: str) -> None:
    values = {field: ["你的血糖已经符合糖尿病。"]}

    with pytest.raises(HealthAiError) as captured:
        validate_health_ai_provider_safety(_output(**values))

    assert captured.value.code == "health_ai_unsafe_model_output"
