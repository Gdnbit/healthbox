import io
import json
from pathlib import Path

from PIL import Image

from app.scripts.verify_local_parser_runtime import (
    RUNTIME_SMOKE_CONTRACT,
    evaluate_dependency_readiness,
)
from app.services.health_image_codec import register_optional_heif_decoder

EVAL_ROOT = Path(__file__).resolve().parents[2] / "evals" / "local-parse-worker"


def _load_contract() -> dict:
    return json.loads(
        (EVAL_ROOT / "golden" / "runtime-smoke-contract.json").read_text(
            encoding="utf-8"
        )
    )


def test_runtime_smoke_contract_matches_checked_in_golden():
    assert RUNTIME_SMOKE_CONTRACT == _load_contract()


def test_dependency_evaluator_requires_every_declared_path_and_language():
    readiness = {
        "status": "partial",
        "reason_codes": ["chi_sim_language_missing"],
        "supported_ocr_languages": ["eng"],
        "capabilities": {
            "digital_pdf": {"status": "ready", "reason_codes": []},
            "image_ocr": {"status": "partial", "reason_codes": []},
            "scanned_pdf_ocr": {"status": "partial", "reason_codes": []},
            "heic_image_ocr": {"status": "partial", "reason_codes": []},
        },
    }

    result = evaluate_dependency_readiness(readiness)

    assert result["passed"] is False
    assert result["formal_write_count"] == 0
    assert result["missing_capabilities"] == [
        "image_ocr",
        "scanned_pdf_ocr",
        "heic_image_ocr",
    ]
    assert result["missing_languages"] == ["chi_sim"]
    assert "raw_text" not in result


def test_optional_heif_decoder_registers_pillow_round_trip(tmp_path):
    from pillow_heif import from_pillow

    assert register_optional_heif_decoder() is True

    source = Image.new("RGB", (32, 24), "white")
    path = tmp_path / "fictional-runtime.heic"
    from_pillow(source).save(path, quality=100)

    content = io.BytesIO(path.read_bytes())
    with Image.open(content) as decoded:
        assert decoded.size == (32, 24)
        assert decoded.mode in {"RGB", "RGBA"}
