"""Synthetic-only runtime smoke test for the local health source parser.

This module intentionally accepts no input file.  It creates fictional content
in memory and verifies that parser dependencies can produce the expected,
review-only candidate without writing to the application database.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas

# The smoke process never opens a business database, but importing the parser
# loads shared application configuration that requires a URL.  Keep the build
# check isolated and ephemeral when no runtime configuration has been supplied.
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from app.services.health_image_codec import register_optional_heif_decoder
from app.services.health_source_parse_service import (
    HealthSourceParseService,
    parse_core_lab_candidates,
    probe_local_parser_readiness,
)

RUNTIME_SMOKE_CONTRACT = {
    "schema_version": "1.0",
    "synthetic_only": True,
    "required_capabilities": [
        "digital_pdf",
        "image_ocr",
        "scanned_pdf_ocr",
        "heic_image_ocr",
    ],
    "required_languages": ["eng", "chi_sim"],
    "expected_candidate": {
        "test_code": "GLU",
        "numeric_value": 5.2,
        "unit": "mmol/L",
        "result_status": "normal",
    },
    "formal_write_count": 0,
}

_FICTIONAL_LAB_LINE = "Glucose 5.2 mmol/L 3.9-6.1 Normal"
_FONT_CANDIDATES = (
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
    Path("C:/Windows/Fonts/arial.ttf"),
)


def evaluate_dependency_readiness(readiness: dict[str, Any]) -> dict[str, Any]:
    """Evaluate the privacy-safe readiness response against the checked-in contract."""

    capabilities = readiness.get("capabilities") or {}
    missing_capabilities = [
        name
        for name in RUNTIME_SMOKE_CONTRACT["required_capabilities"]
        if (capabilities.get(name) or {}).get("status") != "ready"
    ]
    available_languages = set(readiness.get("supported_ocr_languages") or [])
    missing_languages = [
        language
        for language in RUNTIME_SMOKE_CONTRACT["required_languages"]
        if language not in available_languages
    ]
    return {
        "schema_version": RUNTIME_SMOKE_CONTRACT["schema_version"],
        "synthetic_only": True,
        "passed": not missing_capabilities and not missing_languages,
        "runtime_status": readiness.get("status"),
        "capability_statuses": {
            name: (capabilities.get(name) or {}).get("status", "unavailable")
            for name in RUNTIME_SMOKE_CONTRACT["required_capabilities"]
        },
        "supported_ocr_languages": sorted(available_languages),
        "missing_capabilities": missing_capabilities,
        "missing_languages": missing_languages,
        "reason_codes": list(readiness.get("reason_codes") or []),
        "formal_write_count": 0,
    }


def _load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in _FONT_CANDIDATES:
        if path.is_file():
            return ImageFont.truetype(str(path), size=size)
    raise RuntimeError("synthetic_smoke_font_missing")


def _generate_synthetic_image() -> Image.Image:
    image = Image.new("RGB", (2400, 620), "white")
    drawing = ImageDraw.Draw(image)
    title_font = _load_font(76)
    body_font = _load_font(92)
    drawing.text(
        (110, 95), "Fictional Local OCR Runtime", fill="black", font=title_font
    )
    drawing.text((110, 285), _FICTIONAL_LAB_LINE, fill="black", font=body_font)
    return image


def _image_bytes(image: Image.Image, image_format: str) -> bytes:
    output = io.BytesIO()
    image.save(output, format=image_format)
    return output.getvalue()


def _generate_digital_pdf() -> bytes:
    output = io.BytesIO()
    document = canvas.Canvas(output)
    document.setFont("Helvetica", 18)
    document.drawString(54, 780, "Fictional Local Parser Runtime")
    document.drawString(54, 740, _FICTIONAL_LAB_LINE)
    document.save()
    return output.getvalue()


def _candidate_snapshot(extraction: Any) -> dict[str, Any]:
    parsed = parse_core_lab_candidates(extraction, report_date=None)
    candidate = next(
        (
            item
            for item in parsed.candidates
            if item.test_code
            == RUNTIME_SMOKE_CONTRACT["expected_candidate"]["test_code"]
        ),
        None,
    )
    if candidate is None:
        raise RuntimeError("synthetic_candidate_missing")
    return {
        "test_code": candidate.test_code,
        "numeric_value": candidate.numeric_value,
        "unit": candidate.unit,
        "result_status": candidate.result_status,
    }


def _assert_expected_candidate(snapshot: dict[str, Any]) -> None:
    if snapshot != RUNTIME_SMOKE_CONTRACT["expected_candidate"]:
        raise RuntimeError("synthetic_candidate_mismatch")


def run_full_synthetic_smoke() -> dict[str, Any]:
    """Exercise all declared paths with generated content and no persistence."""

    readiness = evaluate_dependency_readiness(probe_local_parser_readiness())
    if not readiness["passed"]:
        return {
            **readiness,
            "checks": {},
        }

    image = _generate_synthetic_image()
    png_content = _image_bytes(image, "PNG")
    scanned_pdf_content = _image_bytes(image, "PDF")

    checks: dict[str, dict[str, Any]] = {}
    digital = HealthSourceParseService._extract_pdf(
        _generate_digital_pdf(),
        filename="fictional-digital-runtime.pdf",
    )
    checks["digital_pdf"] = {
        "method": digital.method,
        "candidate": _candidate_snapshot(digital),
    }

    image_extraction = HealthSourceParseService._extract_image(png_content)
    checks["image_ocr"] = {
        "method": image_extraction.method,
        "candidate": _candidate_snapshot(image_extraction),
    }

    scanned = HealthSourceParseService._extract_pdf(
        scanned_pdf_content,
        filename="fictional-scanned-runtime.pdf",
    )
    checks["scanned_pdf_ocr"] = {
        "method": scanned.method,
        "candidate": _candidate_snapshot(scanned),
    }

    if not register_optional_heif_decoder():
        raise RuntimeError("heic_decoder_missing")
    from pillow_heif import from_pillow

    with tempfile.TemporaryDirectory(prefix="health-parser-smoke-") as directory:
        heic_path = Path(directory) / "fictional-runtime.heic"
        from_pillow(image).save(heic_path, quality=100)
        heic = HealthSourceParseService._extract_image(heic_path.read_bytes())
    checks["heic_image_ocr"] = {
        "method": heic.method,
        "candidate": _candidate_snapshot(heic),
    }

    for check in checks.values():
        _assert_expected_candidate(check["candidate"])
    expected_methods = {
        "digital_pdf": "native",
        "image_ocr": "ocr",
        "scanned_pdf_ocr": "ocr",
        "heic_image_ocr": "ocr",
    }
    if {name: check["method"] for name, check in checks.items()} != expected_methods:
        raise RuntimeError("synthetic_extraction_method_mismatch")

    return {
        **readiness,
        "passed": True,
        "checks": checks,
        "formal_write_count": 0,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Verify local parser runtime using generated fictional content only."
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help="Run OCR and HEIC round trips in addition to dependency checks.",
    )
    arguments = parser.parse_args(argv)

    try:
        if arguments.full:
            result = run_full_synthetic_smoke()
        else:
            result = evaluate_dependency_readiness(probe_local_parser_readiness())
    except Exception as error:
        result = {
            "schema_version": RUNTIME_SMOKE_CONTRACT["schema_version"],
            "synthetic_only": True,
            "passed": False,
            "error_code": str(error),
            "formal_write_count": 0,
        }

    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
