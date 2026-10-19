import io
import json
from pathlib import Path

import pytest
from reportlab.pdfgen import canvas

from app.services.health_source_parse_service import (
    HealthSourceParseService,
    TextExtraction,
    parse_core_lab_candidates,
)

EVAL_ROOT = Path(__file__).resolve().parents[2] / "evals" / "local-parse-worker"


def _load_json(relative_path: str) -> dict:
    return json.loads((EVAL_ROOT / relative_path).read_text(encoding="utf-8"))


def _generate_digital_pdf(lines: list[str]) -> bytes:
    output = io.BytesIO()
    document = canvas.Canvas(output)
    y = 790
    for line in lines:
        document.drawString(54, y, line)
        y -= 24
    document.save()
    return output.getvalue()


def test_status_token_in_chinese_metric_name_does_not_override_result():
    extraction = TextExtraction(
        text="低密度脂蛋白 2.6 mmol/L 0.0-3.4 正常",
        method="native",
        confidence=0.95,
        page_count=1,
    )

    parsed = parse_core_lab_candidates(extraction, report_date=None)

    assert len(parsed.candidates) == 1
    assert parsed.candidates[0].test_code == "LDL-C"
    assert parsed.candidates[0].result_status == "normal"


@pytest.mark.parametrize(
    "case",
    _load_json("cases/institution-digital-pdf-cases.json")["cases"],
    ids=lambda case: case["id"],
)
def test_fictional_institution_digital_pdf_matches_golden(case: dict):
    extraction = HealthSourceParseService._extract_pdf(
        _generate_digital_pdf(case["lines"]),
        filename=f"{case['id']}.pdf",
    )
    parsed = parse_core_lab_candidates(extraction, report_date=None)
    actual = {
        "candidate_count": len(parsed.candidates),
        "low_confidence_count": parsed.low_confidence_count,
        "unparsed_count": parsed.unparsed_count,
        "formal_write_count": 0,
        "candidates": [
            {
                "test_code": candidate.test_code,
                "observed_date": (
                    candidate.observed_date.isoformat()
                    if candidate.observed_date
                    else None
                ),
                "numeric_value": candidate.numeric_value,
                "unit": candidate.unit,
                "result_status": candidate.result_status,
            }
            for candidate in parsed.candidates
        ],
    }

    golden = _load_json("golden/institution-digital-pdf-output.json")
    assert actual == golden["cases"][case["id"]]
