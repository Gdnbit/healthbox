import json

from app.services.health_subject_identity_service import (
    SUBJECT_IDENTITY_ASSESSMENT_VERSION,
    assess_report_subject_identity,
)


def test_subject_identity_matches_explicit_chinese_and_english_name_orders():
    chinese = assess_report_subject_identity(
        "患者姓名：张三  性别：男\n空腹血糖 5.2 mmol/L",
        first_name="三",
        last_name="张",
        extraction_method="native",
        extraction_confidence=0.95,
    )
    english = assess_report_subject_identity(
        "Patient Name: Doe, Jane\nGlucose 5.2 mmol/L",
        first_name="Jane",
        last_name="Doe",
        extraction_method="native",
        extraction_confidence=0.95,
    )

    assert chinese.status == "matched"
    assert chinese.observed_name == "张三"
    assert english.status == "matched"
    assert english.observed_name == "Doe, Jane"
    assert english.assessment_version == SUBJECT_IDENTITY_ASSESSMENT_VERSION


def test_subject_identity_flags_only_clean_explicit_mismatch_without_raw_text():
    assessment = assess_report_subject_identity(
        "受检者：李四\n报告医师姓名：王医生\n总胆固醇 4.2 mmol/L",
        first_name="三",
        last_name="张",
        extraction_method="ocr",
        extraction_confidence=0.75,
    )

    assert assessment.status == "suspected_mismatch"
    assert assessment.observed_name == "李四"
    assert assessment.confidence == 0.75
    rendered_evidence = json.dumps(assessment.evidence, ensure_ascii=False)
    assert "李四" not in rendered_evidence
    assert "张三" not in rendered_evidence
    assert "总胆固醇" not in rendered_evidence


def test_subject_identity_fails_closed_for_unlabeled_masked_or_conflicting_names():
    cases = [
        "张三\n空腹血糖 5.2 mmol/L",
        "姓名：张*\n空腹血糖 5.2 mmol/L",
        "患者姓名：李四\n受检者：王五\n空腹血糖 5.2 mmol/L",
        "报告医师姓名：李四\n空腹血糖 5.2 mmol/L",
    ]

    assessments = [
        assess_report_subject_identity(
            text,
            first_name="三",
            last_name="张",
            extraction_method="native",
            extraction_confidence=0.95,
        )
        for text in cases
    ]

    assert [assessment.status for assessment in assessments] == [
        "unavailable",
        "unavailable",
        "unavailable",
        "unavailable",
    ]
    assert all(assessment.observed_name is None for assessment in assessments)
