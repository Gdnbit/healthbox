import csv
import io
import math
import re
import unicodedata
from datetime import date, datetime

from pydantic import ValidationError

from app.schemas.health_imports import (
    CandidateObservation,
    HealthCsvPreviewError,
    HealthCsvPreviewResponse,
    HealthCsvPreviewRow,
)
from app.services.health_candidate_rules import candidate_validation_issues

SUPPORTED_DELIMITERS = (",", ";", "\t")
MAX_CSV_ROWS = 500


def _token(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).strip().lower()
    return re.sub(r"[\s\-]+", "_", normalized)


_HEADER_GROUPS = {
    "observed_date": ("observed_date", "date", "日期", "检查日期", "检验日期"),
    "test_name": ("test_name", "项目名称", "检验项目", "指标名称"),
    "canonical_test_name": ("canonical_test_name", "标准名称", "规范名称"),
    "test_code": ("test_code", "项目代码", "指标代码"),
    "result_type": ("result_type", "结果类型"),
    "value": ("value", "result", "结果", "结果值"),
    "unit": ("unit", "单位"),
    "ref_range_min": ("ref_range_min", "reference_min", "参考下限"),
    "ref_range_max": ("ref_range_max", "reference_max", "参考上限"),
    "ref_range_text": ("ref_range_text", "reference_range", "参考范围"),
    "result_status": ("result_status", "status", "结果状态"),
    "category": ("category", "分类", "项目分类"),
    "source_page": ("source_page", "page", "来源页码", "页码"),
    "source_locator": ("source_locator", "locator", "来源位置", "原件位置"),
}
HEADER_ALIASES = {
    _token(alias): canonical
    for canonical, aliases in _HEADER_GROUPS.items()
    for alias in aliases
}

RESULT_TYPE_ALIASES = {
    _token(value): canonical
    for canonical, values in {
        "quantitative": ("quantitative", "numeric", "number", "定量", "数值"),
        "qualitative": ("qualitative", "choice", "定性"),
        "textual": ("textual", "text", "文本"),
    }.items()
    for value in values
}

QUALITATIVE_ALIASES = {
    _token(value): canonical
    for canonical, values in {
        "positive": ("positive", "阳性"),
        "negative": ("negative", "阴性"),
        "detected": ("detected", "检出"),
        "undetected": ("undetected", "未检出"),
    }.items()
    for value in values
}

STATUS_ALIASES = {
    _token(value): canonical
    for canonical, values in {
        "normal": ("normal", "正常"),
        "abnormal": ("abnormal", "异常"),
        "critical": ("critical", "危急"),
        "high": ("high", "偏高", "高"),
        "low": ("low", "偏低", "低"),
        "borderline": ("borderline", "临界"),
    }.items()
    for value in values
}

CATEGORY_ALIASES = {
    _token(value): canonical
    for canonical, values in {
        "chemistry": ("chemistry", "生化"),
        "hematology": ("hematology", "血液"),
        "hepatology": ("hepatology", "肝功能"),
        "immunology": ("immunology", "免疫"),
        "microbiology": ("microbiology", "微生物"),
        "endocrinology": ("endocrinology", "内分泌"),
        "cardiology": ("cardiology", "心血管"),
        "toxicology": ("toxicology", "毒理"),
        "genetics": ("genetics", "遗传"),
        "molecular": ("molecular", "分子"),
        "pathology": ("pathology", "病理"),
        "lipids": ("lipids", "血脂"),
        "hearing": ("hearing", "听力"),
        "stomatology": ("stomatology", "口腔"),
        "imaging": ("imaging", "影像"),
        "other": ("other", "其他"),
    }.items()
    for value in values
}

ERROR_MESSAGES = {
    "invalid_date": "Use a supported calendar date format.",
    "unsafe_formula": "Spreadsheet formulas are not allowed in text fields.",
    "unsupported_qualitative": "Use a supported qualitative result.",
    "missing_required": "A required field is empty.",
    "unsupported_result_type": "Use a supported result type.",
    "invalid_number": "Use a finite decimal number.",
    "invalid_page": "Use a positive whole-number source page.",
    "unsupported_status": "Use a supported result status.",
    "unsupported_category": "Use a supported result category.",
    "invalid_reference_range": "Reference minimum must be lower than maximum.",
    "invalid_candidate": "The row does not satisfy the candidate contract.",
    "duplicate_header": "Each template field may appear only once.",
    "missing_header": "A required template column is missing.",
    "unexpected_columns": "The row contains more cells than the header.",
    "row_limit": "The CSV contains more than 500 non-empty data rows.",
}


def _error(row_number: int, field: str | None, code: str) -> HealthCsvPreviewError:
    return HealthCsvPreviewError(
        row_number=row_number,
        field=field,
        code=code,
        message=ERROR_MESSAGES[code],
    )


def _decode(content: bytes) -> tuple[str, str]:
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            text = content.decode(encoding)
            if "\x00" in text:
                continue
            return text, encoding
        except UnicodeDecodeError:
            continue
    raise ValueError("unsupported_encoding")


def _detect_delimiter(text: str) -> str:
    sample = "\n".join(text.splitlines()[:20])
    try:
        return (
            csv.Sniffer()
            .sniff(sample, delimiters="".join(SUPPORTED_DELIMITERS))
            .delimiter
        )
    except csv.Error:
        counts = {
            delimiter: sample.count(delimiter) for delimiter in SUPPORTED_DELIMITERS
        }
        return max(counts, key=counts.get) if any(counts.values()) else ","


def _is_blank(row: list[str]) -> bool:
    return not row or all(not cell.strip() for cell in row)


def _has_formula(value: str | None) -> bool:
    stripped = (value or "").lstrip()
    return bool(stripped) and stripped[0] in "=+-@"


def _parse_date(value: str) -> date | None:
    if not value:
        return None
    for pattern in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(value, pattern).date()
        except ValueError:
            continue
    raise ValueError("invalid_date")


def _parse_float(
    value: str, field: str, errors: list[HealthCsvPreviewError], row_number: int
) -> float | None:
    if not value:
        return None
    try:
        parsed = float(value)
    except ValueError:
        errors.append(_error(row_number, field, "invalid_number"))
        return None
    if not math.isfinite(parsed):
        errors.append(_error(row_number, field, "invalid_number"))
        return None
    return parsed


def _parse_page(
    value: str, errors: list[HealthCsvPreviewError], row_number: int
) -> int | None:
    if not value:
        return None
    try:
        parsed = int(value)
    except ValueError:
        errors.append(_error(row_number, "source_page", "invalid_page"))
        return None
    if parsed < 1 or str(parsed) != value.strip():
        errors.append(_error(row_number, "source_page", "invalid_page"))
        return None
    return parsed


def _mapped_optional(
    raw: str,
    aliases: dict[str, str],
    field: str,
    code: str,
    errors: list[HealthCsvPreviewError],
    row_number: int,
) -> str | None:
    if not raw:
        return None
    mapped = aliases.get(_token(raw))
    if mapped is None:
        errors.append(_error(row_number, field, code))
    return mapped


def _parse_row(
    values: dict[str, str], row_number: int
) -> tuple[CandidateObservation | None, list[HealthCsvPreviewError]]:
    errors: list[HealthCsvPreviewError] = []
    test_name = values.get("test_name", "").strip()
    result_type_raw = values.get("result_type", "").strip()
    result_value = values.get("value", "").strip()

    for field, value in values.items():
        if field in {
            "observed_date",
            "ref_range_min",
            "ref_range_max",
            "source_page",
            "value",
        }:
            continue
        if _has_formula(value):
            errors.append(_error(row_number, field, "unsafe_formula"))

    for field, value in (
        ("test_name", test_name),
        ("result_type", result_type_raw),
        ("value", result_value),
    ):
        if not value:
            errors.append(_error(row_number, field, "missing_required"))

    result_type = RESULT_TYPE_ALIASES.get(_token(result_type_raw))
    if result_type_raw and result_type is None:
        errors.append(_error(row_number, "result_type", "unsupported_result_type"))

    observed_date = None
    try:
        observed_date = _parse_date(values.get("observed_date", "").strip())
    except ValueError:
        errors.append(_error(row_number, "observed_date", "invalid_date"))

    numeric_value = None
    qualitative_value = None
    textual_value = None
    if result_type == "quantitative" and result_value:
        numeric_value = _parse_float(result_value, "value", errors, row_number)
    elif result_type == "qualitative" and result_value:
        qualitative_value = QUALITATIVE_ALIASES.get(_token(result_value))
        if qualitative_value is None:
            errors.append(_error(row_number, "value", "unsupported_qualitative"))
    elif result_type == "textual" and result_value:
        if _has_formula(result_value):
            errors.append(_error(row_number, "value", "unsafe_formula"))
        else:
            textual_value = result_value

    ref_range_min = _parse_float(
        values.get("ref_range_min", "").strip(),
        "ref_range_min",
        errors,
        row_number,
    )
    ref_range_max = _parse_float(
        values.get("ref_range_max", "").strip(),
        "ref_range_max",
        errors,
        row_number,
    )
    source_page = _parse_page(values.get("source_page", "").strip(), errors, row_number)
    result_status = _mapped_optional(
        values.get("result_status", "").strip(),
        STATUS_ALIASES,
        "result_status",
        "unsupported_status",
        errors,
        row_number,
    )
    category = _mapped_optional(
        values.get("category", "").strip(),
        CATEGORY_ALIASES,
        "category",
        "unsupported_category",
        errors,
        row_number,
    )

    if errors:
        return None, errors

    try:
        candidate = CandidateObservation(
            observed_date=observed_date,
            test_name=test_name,
            canonical_test_name=values.get("canonical_test_name", "").strip() or None,
            test_code=values.get("test_code", "").strip() or None,
            result_type=result_type,
            numeric_value=numeric_value,
            qualitative_value=qualitative_value,
            textual_value=textual_value,
            unit=(
                values.get("unit", "").strip() or None
                if result_type == "quantitative"
                else None
            ),
            ref_range_min=(ref_range_min if result_type == "quantitative" else None),
            ref_range_max=(ref_range_max if result_type == "quantitative" else None),
            ref_range_text=values.get("ref_range_text", "").strip() or None,
            result_status=result_status,
            category=category,
            source_page=source_page,
            source_locator=values.get("source_locator", "").strip() or None,
        )
    except ValidationError as exc:
        code = (
            "invalid_reference_range"
            if any("Reference range" in error["msg"] for error in exc.errors())
            else "invalid_candidate"
        )
        field = exc.errors()[0].get("loc", (None,))[-1]
        return None, [_error(row_number, str(field) if field else None, code)]
    return candidate, []


def parse_health_csv(content: bytes) -> HealthCsvPreviewResponse:
    """Parse a fixed household lab CSV into review candidates without persistence."""

    text, encoding = _decode(content)
    delimiter = _detect_delimiter(text)
    raw_rows = list(csv.reader(io.StringIO(text, newline=""), delimiter=delimiter))
    if not raw_rows:
        return HealthCsvPreviewResponse(
            total_rows=0,
            valid_rows=0,
            invalid_rows=0,
            skipped_blank_rows=0,
            encoding=encoding,
            delimiter=delimiter,
            errors=[_error(1, None, "missing_header")],
        )

    header = raw_rows[0]
    canonical_headers: list[str | None] = []
    header_errors: list[HealthCsvPreviewError] = []
    seen: set[str] = set()
    for raw_header in header:
        canonical = HEADER_ALIASES.get(_token(raw_header))
        canonical_headers.append(canonical)
        if canonical is not None and canonical in seen:
            header_errors.append(_error(1, canonical, "duplicate_header"))
        if canonical is not None:
            seen.add(canonical)
    for required in ("test_name", "result_type", "value"):
        if required not in seen:
            header_errors.append(_error(1, required, "missing_header"))

    data_rows: list[tuple[int, list[str]]] = []
    skipped_blank_rows = 0
    for row_number, row in enumerate(raw_rows[1:], start=2):
        if _is_blank(row):
            skipped_blank_rows += 1
        else:
            data_rows.append((row_number, row))

    if len(data_rows) > MAX_CSV_ROWS:
        header_errors.append(_error(1, None, "row_limit"))

    if header_errors:
        return HealthCsvPreviewResponse(
            total_rows=len(data_rows),
            valid_rows=0,
            invalid_rows=len(data_rows),
            skipped_blank_rows=skipped_blank_rows,
            encoding=encoding,
            delimiter=delimiter,
            errors=header_errors,
        )

    preview_rows: list[HealthCsvPreviewRow] = []
    errors: list[HealthCsvPreviewError] = []
    invalid_row_numbers: set[int] = set()
    for row_number, row in data_rows:
        if len(row) > len(canonical_headers):
            errors.append(_error(row_number, None, "unexpected_columns"))
            invalid_row_numbers.add(row_number)
            continue
        padded = row + [""] * (len(canonical_headers) - len(row))
        values = {
            canonical: padded[index].strip()
            for index, canonical in enumerate(canonical_headers)
            if canonical is not None
        }
        candidate, row_errors = _parse_row(values, row_number)
        if row_errors:
            errors.extend(row_errors)
            invalid_row_numbers.add(row_number)
            continue
        assert candidate is not None
        preview_rows.append(
            HealthCsvPreviewRow(
                row_number=row_number,
                candidate=candidate,
                validation_issues=candidate_validation_issues(candidate),
            )
        )

    return HealthCsvPreviewResponse(
        total_rows=len(data_rows),
        valid_rows=len(preview_rows),
        invalid_rows=len(invalid_row_numbers),
        skipped_blank_rows=skipped_blank_rows,
        encoding=encoding,
        delimiter=delimiter,
        rows=preview_rows,
        errors=errors,
    )
