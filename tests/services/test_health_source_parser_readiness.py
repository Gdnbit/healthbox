from app.services.health_source_parse_service import probe_local_parser_readiness


def test_parser_readiness_reports_all_local_paths_when_dependencies_exist():
    result = probe_local_parser_readiness(
        module_available=lambda name: name in {"pdfplumber", "pdf2image"},
        command_available=lambda name: name in {"tesseract", "pdftoppm"},
        language_provider=lambda: {"chi_sim", "eng"},
        heic_decoder_available=lambda: True,
    )

    assert result["status"] == "ready"
    assert result["capabilities"]["digital_pdf"]["status"] == "ready"
    assert result["capabilities"]["image_ocr"]["status"] == "ready"
    assert result["capabilities"]["scanned_pdf_ocr"]["status"] == "ready"
    assert result["capabilities"]["heic_image_ocr"]["status"] == "ready"
    assert result["reason_codes"] == []


def test_parser_readiness_keeps_digital_pdf_available_when_ocr_is_incomplete():
    result = probe_local_parser_readiness(
        module_available=lambda name: name == "pdfplumber",
        command_available=lambda _name: False,
        language_provider=lambda: set(),
        heic_decoder_available=lambda: False,
    )

    assert result["status"] == "partial"
    assert result["capabilities"]["digital_pdf"]["status"] == "ready"
    assert result["capabilities"]["image_ocr"]["status"] == "unavailable"
    assert result["capabilities"]["scanned_pdf_ocr"]["status"] == "unavailable"
    assert result["capabilities"]["heic_image_ocr"]["status"] == "unavailable"
    assert set(result["reason_codes"]) == {
        "tesseract_missing",
        "ocr_language_missing",
        "pdf2image_missing",
        "poppler_missing",
        "heic_decoder_missing",
    }


def test_parser_readiness_marks_single_language_ocr_as_partial():
    result = probe_local_parser_readiness(
        module_available=lambda _name: True,
        command_available=lambda _name: True,
        language_provider=lambda: {"eng"},
        heic_decoder_available=lambda: True,
    )

    assert result["status"] == "partial"
    assert result["capabilities"]["image_ocr"]["status"] == "partial"
    assert result["capabilities"]["scanned_pdf_ocr"]["status"] == "partial"
    assert result["reason_codes"] == ["chi_sim_language_missing"]
