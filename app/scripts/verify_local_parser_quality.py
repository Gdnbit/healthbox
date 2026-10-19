"""Synthetic multi-layout quality gate for the local health source parser.

The command accepts no report path and writes no application data.  It creates
fictional images and a fictional scanned PDF in memory, extracts review-only
candidates, and evaluates exact field and safe-rejection quality.
"""

from __future__ import annotations

import io
import json
import os
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageEnhance, ImageFont

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from app.services.health_source_parse_service import (
    HealthSourceParseService,
    SourceParseFailure,
    parse_core_lab_candidates,
)

SYNTHETIC_OCR_QUALITY_CONTRACT = {
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
            "id": "clean-english-panel",
            "source_kind": "image",
            "layout": "clean_english",
            "expected_candidates": [
                {
                    "test_code": "GLU",
                    "numeric_value": 5.2,
                    "unit": "mmol/L",
                    "result_status": "normal",
                },
                {
                    "test_code": "TC",
                    "numeric_value": 4.6,
                    "unit": "mmol/L",
                    "result_status": "normal",
                },
                {
                    "test_code": "HDL-C",
                    "numeric_value": 1.4,
                    "unit": "mmol/L",
                    "result_status": "normal",
                },
            ],
        },
        {
            "id": "bordered-chinese-table",
            "source_kind": "image",
            "layout": "bordered_chinese",
            "expected_candidates": [
                {
                    "test_code": "GLU",
                    "numeric_value": 5.4,
                    "unit": "mmol/L",
                    "result_status": "normal",
                },
                {
                    "test_code": "LDL-C",
                    "numeric_value": 2.6,
                    "unit": "mmol/L",
                    "result_status": "normal",
                },
                {
                    "test_code": "HGB",
                    "numeric_value": 145.0,
                    "unit": "g/L",
                    "result_status": "normal",
                },
            ],
        },
        {
            "id": "rotated-low-contrast-photo",
            "source_kind": "image",
            "layout": "rotated_low_contrast",
            "expected_candidates": [
                {
                    "test_code": "TG",
                    "numeric_value": 1.1,
                    "unit": "mmol/L",
                    "result_status": "normal",
                },
                {
                    "test_code": "UA",
                    "numeric_value": 330.0,
                    "unit": "umol/L",
                    "result_status": "normal",
                },
            ],
        },
        {
            "id": "two-page-scanned-pdf",
            "source_kind": "scanned_pdf",
            "layout": "two_page_scan",
            "expected_candidates": [
                {
                    "test_code": "ALT",
                    "numeric_value": 26.0,
                    "unit": "U/L",
                    "result_status": "normal",
                },
                {
                    "test_code": "AST",
                    "numeric_value": 22.0,
                    "unit": "U/L",
                    "result_status": "normal",
                },
            ],
        },
        {
            "id": "non-lab-page-rejected",
            "source_kind": "image",
            "layout": "non_lab",
            "expected_candidates": [],
        },
        {
            "id": "missing-value-rejected",
            "source_kind": "image",
            "layout": "missing_value",
            "expected_candidates": [],
        },
    ],
}

_FONT_CANDIDATES = {
    "latin": (
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        Path("C:/Windows/Fonts/arial.ttf"),
    ),
    "cjk": (
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        Path("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"),
        Path("C:/Windows/Fonts/msyh.ttc"),
    ),
}


def _candidate_key(candidate: dict[str, Any]) -> tuple[Any, ...]:
    value = candidate.get("numeric_value")
    normalized_value = round(float(value), 6) if value is not None else None
    return (
        candidate.get("test_code"),
        normalized_value,
        candidate.get("unit"),
        candidate.get("result_status"),
    )


def evaluate_quality_outcomes(
    contract: dict[str, Any],
    outcomes: list[dict[str, Any]],
) -> dict[str, Any]:
    """Calculate deterministic exact-field and rejection metrics."""

    cases = {case["id"]: case for case in contract["cases"]}
    outcome_map = {outcome["id"]: outcome for outcome in outcomes}
    missing_case_ids = sorted(set(cases) - set(outcome_map))
    unexpected_case_ids = sorted(set(outcome_map) - set(cases))

    expected_field_count = 0
    predicted_field_count = 0
    matched_field_count = 0
    high_confidence_prediction_count = 0
    high_confidence_error_count = 0
    positive_case_count = 0
    positive_extraction_failure_count = 0
    rejection_case_count = 0
    correct_rejection_count = 0
    case_results = []

    for case_id, case in cases.items():
        expected = case["expected_candidates"]
        outcome = outcome_map.get(
            case_id,
            {
                "id": case_id,
                "extraction_failed": True,
                "predicted_candidates": [],
            },
        )
        predicted = outcome.get("predicted_candidates") or []
        extraction_failed = bool(outcome.get("extraction_failed"))

        expected_field_count += len(expected)
        predicted_field_count += len(predicted)
        expected_remaining = Counter(_candidate_key(item) for item in expected)
        matched_for_case = 0
        errors_for_case = 0

        for candidate in predicted:
            key = _candidate_key(candidate)
            confidence = float(candidate.get("confidence") or 0.0)
            if confidence >= 0.85:
                high_confidence_prediction_count += 1
            if expected_remaining[key] > 0:
                expected_remaining[key] -= 1
                matched_for_case += 1
            else:
                errors_for_case += 1
                if confidence >= 0.85:
                    high_confidence_error_count += 1

        matched_field_count += matched_for_case
        if expected:
            positive_case_count += 1
            if extraction_failed:
                positive_extraction_failure_count += 1
            case_passed = (
                not extraction_failed
                and matched_for_case == len(expected)
                and len(predicted) == len(expected)
            )
        else:
            rejection_case_count += 1
            if not extraction_failed and not predicted:
                correct_rejection_count += 1
            case_passed = not extraction_failed and not predicted

        case_results.append(
            {
                "id": case_id,
                "passed": case_passed,
                "extraction_failed": extraction_failed,
                "expected_count": len(expected),
                "predicted_count": len(predicted),
                "matched_count": matched_for_case,
                "error_count": errors_for_case,
                "error_code": outcome.get("error_code"),
            }
        )

    field_precision = (
        matched_field_count / predicted_field_count if predicted_field_count else 1.0
    )
    field_recall = (
        matched_field_count / expected_field_count if expected_field_count else 1.0
    )
    rejection_accuracy = (
        correct_rejection_count / rejection_case_count if rejection_case_count else 1.0
    )
    high_confidence_error_rate = (
        high_confidence_error_count / high_confidence_prediction_count
        if high_confidence_prediction_count
        else 0.0
    )
    positive_extraction_failure_rate = (
        positive_extraction_failure_count / positive_case_count
        if positive_case_count
        else 0.0
    )

    gates = contract["gates"]
    failed_gates = []
    if field_precision < gates["min_field_precision"]:
        failed_gates.append("min_field_precision")
    if field_recall < gates["min_field_recall"]:
        failed_gates.append("min_field_recall")
    if rejection_accuracy < gates["min_rejection_accuracy"]:
        failed_gates.append("min_rejection_accuracy")
    if high_confidence_error_rate > gates["max_high_confidence_error_rate"]:
        failed_gates.append("max_high_confidence_error_rate")
    if positive_extraction_failure_rate > gates["max_positive_extraction_failure_rate"]:
        failed_gates.append("max_positive_extraction_failure_rate")
    if missing_case_ids:
        failed_gates.append("case_coverage")
    if unexpected_case_ids:
        failed_gates.append("unexpected_cases")

    return {
        "schema_version": contract["schema_version"],
        "synthetic_only": True,
        "passed": not failed_gates and all(result["passed"] for result in case_results),
        "field_precision": round(field_precision, 6),
        "field_recall": round(field_recall, 6),
        "rejection_accuracy": round(rejection_accuracy, 6),
        "high_confidence_error_rate": round(high_confidence_error_rate, 6),
        "positive_extraction_failure_rate": round(positive_extraction_failure_rate, 6),
        "expected_field_count": expected_field_count,
        "predicted_field_count": predicted_field_count,
        "matched_field_count": matched_field_count,
        "high_confidence_prediction_count": high_confidence_prediction_count,
        "high_confidence_error_count": high_confidence_error_count,
        "positive_extraction_failure_count": positive_extraction_failure_count,
        "correct_rejection_count": correct_rejection_count,
        "rejection_case_count": rejection_case_count,
        "missing_case_ids": missing_case_ids,
        "unexpected_case_ids": unexpected_case_ids,
        "failed_gates": failed_gates,
        "cases": case_results,
        "formal_write_count": 0,
    }


def _load_font(kind: str, size: int) -> ImageFont.FreeTypeFont:
    for path in _FONT_CANDIDATES[kind]:
        if path.is_file():
            return ImageFont.truetype(str(path), size=size)
    raise RuntimeError(f"synthetic_{kind}_font_missing")


def _draw_text_panel(
    lines: list[str],
    *,
    size: tuple[int, int] = (3000, 1200),
    font_kind: str = "latin",
    body_size: int = 76,
    text_fill: tuple[int, int, int] = (0, 0, 0),
) -> Image.Image:
    image = Image.new("RGB", size, "white")
    drawing = ImageDraw.Draw(image)
    title_font = _load_font(font_kind, max(52, body_size - 18))
    body_font = _load_font(font_kind, body_size)
    drawing.text(
        (100, 70),
        "虚构体检中心" if font_kind == "cjk" else "Fictional Health Center",
        fill=text_fill,
        font=title_font,
    )
    y = 235
    for line in lines:
        drawing.text((120, y), line, fill=text_fill, font=body_font)
        y += body_size + 105
    return image


def _clean_english_image() -> Image.Image:
    return _draw_text_panel(
        [
            "Glucose 5.2 mmol/L 3.9-6.1 Normal",
            "Total Cholesterol 4.6 mmol/L 0.0-5.2 Normal",
            "HDL 1.4 mmol/L 1.0-1.6 Normal",
        ]
    )


def _bordered_chinese_image() -> Image.Image:
    image = _draw_text_panel(
        [
            "空腹血糖 5.4 mmol/L 3.9-6.1 正常",
            "低密度脂蛋白 2.6 mmol/L 0.0-3.4 正常",
            "血红蛋白 145 g/L 130-175 正常",
        ],
        size=(3200, 1250),
        font_kind="cjk",
        body_size=76,
    )
    drawing = ImageDraw.Draw(image)
    for y in (205, 410, 591, 772, 953):
        drawing.line((80, y, 3120, y), fill=(185, 185, 185), width=3)
    drawing.rectangle((80, 205, 3120, 953), outline=(165, 165, 165), width=3)
    return image


def _rotated_low_contrast_image() -> Image.Image:
    image = _draw_text_panel(
        [
            "Triglycerides 1.1 mmol/L 0.0-1.7 Normal",
            "Uric Acid 330 umol/L 208-428 Normal",
        ],
        size=(2850, 900),
        body_size=80,
        text_fill=(72, 72, 72),
    )
    image = ImageEnhance.Contrast(image).enhance(0.82)
    return image.rotate(
        1.2,
        resample=Image.Resampling.BICUBIC,
        expand=True,
        fillcolor="white",
    )


def _two_page_scanned_pdf() -> bytes:
    pages = [
        _draw_text_panel(
            ["Alanine Aminotransferase 26 U/L 9-50 Normal"],
            size=(2200, 720),
            body_size=62,
        ),
        _draw_text_panel(
            ["Aspartate Aminotransferase 22 U/L 15-40 Normal"],
            size=(2200, 720),
            body_size=62,
        ),
    ]
    output = io.BytesIO()
    pages[0].save(
        output,
        format="PDF",
        save_all=True,
        append_images=pages[1:],
        resolution=160,
    )
    return output.getvalue()


def _non_lab_image() -> Image.Image:
    return _draw_text_panel(
        [
            "Bring an identification document to reception.",
            "No laboratory measurements are present on this page.",
        ],
        size=(2600, 850),
        body_size=64,
    )


def _missing_value_image() -> Image.Image:
    return _draw_text_panel(
        [
            "Glucose Pending - no numeric result issued",
            "Please contact the fictional laboratory later.",
        ],
        size=(2600, 850),
        body_size=64,
    )


def _image_to_png(image: Image.Image) -> bytes:
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def _render_case(case: dict[str, Any]) -> bytes:
    layout = case["layout"]
    if layout == "clean_english":
        return _image_to_png(_clean_english_image())
    if layout == "bordered_chinese":
        return _image_to_png(_bordered_chinese_image())
    if layout == "rotated_low_contrast":
        return _image_to_png(_rotated_low_contrast_image())
    if layout == "two_page_scan":
        return _two_page_scanned_pdf()
    if layout == "non_lab":
        return _image_to_png(_non_lab_image())
    if layout == "missing_value":
        return _image_to_png(_missing_value_image())
    raise RuntimeError("unknown_synthetic_layout")


def _candidate_snapshot(candidate: Any) -> dict[str, Any]:
    return {
        "test_code": candidate.test_code,
        "numeric_value": candidate.numeric_value,
        "unit": candidate.unit,
        "result_status": candidate.result_status,
        "confidence": candidate.confidence,
    }


def run_synthetic_quality_gate() -> dict[str, Any]:
    outcomes = []
    for case in SYNTHETIC_OCR_QUALITY_CONTRACT["cases"]:
        try:
            content = _render_case(case)
            if case["source_kind"] == "scanned_pdf":
                extraction = HealthSourceParseService._extract_pdf(
                    content,
                    filename=f"{case['id']}.pdf",
                )
            else:
                extraction = HealthSourceParseService._extract_image(content)
            parsed = parse_core_lab_candidates(extraction, report_date=None)
            outcomes.append(
                {
                    "id": case["id"],
                    "extraction_failed": False,
                    "predicted_candidates": [
                        _candidate_snapshot(candidate)
                        for candidate in parsed.candidates
                    ],
                }
            )
        except SourceParseFailure as error:
            outcomes.append(
                {
                    "id": case["id"],
                    "extraction_failed": True,
                    "error_code": error.code,
                    "predicted_candidates": [],
                }
            )
        except Exception:
            outcomes.append(
                {
                    "id": case["id"],
                    "extraction_failed": True,
                    "error_code": "synthetic_quality_execution_failed",
                    "predicted_candidates": [],
                }
            )

    return evaluate_quality_outcomes(SYNTHETIC_OCR_QUALITY_CONTRACT, outcomes)


def main() -> int:
    result = run_synthetic_quality_gate()
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
