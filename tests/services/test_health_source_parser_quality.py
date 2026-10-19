import json
from pathlib import Path

from app.scripts.verify_local_parser_quality import (
    SYNTHETIC_OCR_QUALITY_CONTRACT,
    evaluate_quality_outcomes,
)

EVAL_ROOT = Path(__file__).resolve().parents[2] / "evals" / "local-parse-worker"


def _load_contract() -> dict:
    return json.loads(
        (EVAL_ROOT / "golden" / "synthetic-ocr-quality-contract.json").read_text(
            encoding="utf-8"
        )
    )


def test_quality_contract_matches_checked_in_golden():
    assert SYNTHETIC_OCR_QUALITY_CONTRACT == _load_contract()


def test_quality_evaluator_passes_exact_candidates_and_safe_rejection():
    contract = {
        "schema_version": "1.0",
        "synthetic_only": True,
        "gates": {
            "min_field_precision": 1.0,
            "min_field_recall": 1.0,
            "min_rejection_accuracy": 1.0,
            "max_high_confidence_error_rate": 0.0,
            "max_positive_extraction_failure_rate": 0.0,
        },
        "cases": [
            {
                "id": "positive",
                "expected_candidates": [
                    {
                        "test_code": "GLU",
                        "numeric_value": 5.2,
                        "unit": "mmol/L",
                        "result_status": "normal",
                    }
                ],
            },
            {"id": "rejection", "expected_candidates": []},
        ],
    }
    outcomes = [
        {
            "id": "positive",
            "extraction_failed": False,
            "predicted_candidates": [
                {
                    "test_code": "GLU",
                    "numeric_value": 5.2,
                    "unit": "mmol/L",
                    "result_status": "normal",
                    "confidence": 0.75,
                }
            ],
        },
        {
            "id": "rejection",
            "extraction_failed": False,
            "predicted_candidates": [],
        },
    ]

    result = evaluate_quality_outcomes(contract, outcomes)

    assert result["passed"] is True
    assert result["field_precision"] == 1.0
    assert result["field_recall"] == 1.0
    assert result["rejection_accuracy"] == 1.0
    assert result["formal_write_count"] == 0


def test_quality_evaluator_blocks_high_confidence_wrong_value():
    contract = {
        "schema_version": "1.0",
        "synthetic_only": True,
        "gates": {
            "min_field_precision": 0.0,
            "min_field_recall": 0.0,
            "min_rejection_accuracy": 0.0,
            "max_high_confidence_error_rate": 0.0,
            "max_positive_extraction_failure_rate": 1.0,
        },
        "cases": [
            {
                "id": "wrong-value",
                "expected_candidates": [
                    {
                        "test_code": "GLU",
                        "numeric_value": 5.2,
                        "unit": "mmol/L",
                        "result_status": "normal",
                    }
                ],
            }
        ],
    }
    outcomes = [
        {
            "id": "wrong-value",
            "extraction_failed": False,
            "predicted_candidates": [
                {
                    "test_code": "GLU",
                    "numeric_value": 52.0,
                    "unit": "mmol/L",
                    "result_status": "high",
                    "confidence": 0.9,
                }
            ],
        }
    ]

    result = evaluate_quality_outcomes(contract, outcomes)

    assert result["passed"] is False
    assert result["high_confidence_error_count"] == 1
    assert result["high_confidence_error_rate"] == 1.0
    assert "max_high_confidence_error_rate" in result["failed_gates"]


def test_quality_evaluator_blocks_candidate_leakage_in_rejection_case():
    contract = {
        "schema_version": "1.0",
        "synthetic_only": True,
        "gates": {
            "min_field_precision": 0.0,
            "min_field_recall": 0.0,
            "min_rejection_accuracy": 1.0,
            "max_high_confidence_error_rate": 1.0,
            "max_positive_extraction_failure_rate": 1.0,
        },
        "cases": [{"id": "rejection", "expected_candidates": []}],
    }
    outcomes = [
        {
            "id": "rejection",
            "extraction_failed": False,
            "predicted_candidates": [
                {
                    "test_code": "GLU",
                    "numeric_value": 5.2,
                    "unit": "mmol/L",
                    "result_status": "normal",
                    "confidence": 0.75,
                }
            ],
        }
    ]

    result = evaluate_quality_outcomes(contract, outcomes)

    assert result["passed"] is False
    assert result["rejection_accuracy"] == 0.0
    assert "min_rejection_accuracy" in result["failed_gates"]
