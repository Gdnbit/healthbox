"""Local, review-first parsing for retained household health source files."""

from __future__ import annotations

import hashlib
import importlib.util
import io
import re
import shutil
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Iterable

import pdfplumber
import pytesseract
from fastapi import HTTPException, status
from PIL import Image, ImageSequence, UnidentifiedImageError
from pydantic import ValidationError
from sqlalchemy.orm import Session, joinedload

from app.core.logging.config import get_logger
from app.models.activity_log import ActivityLog
from app.models.base import get_utc_now
from app.models.files import EntityFile
from app.models.health_imports import HealthSourceDocument, HealthSourceParseTask
from app.models.patient import Patient
from app.models.user import User
from app.schemas.health_imports import (
    CandidateObservation,
    HealthImportBatchCreate,
    HealthSourceParseTaskStart,
)
from app.services.health_image_codec import register_optional_heif_decoder
from app.services.health_import_service import health_import_service
from app.services.health_subject_identity_service import (
    assess_report_subject_identity,
)

logger = get_logger(__name__, "app")

LOCAL_PARSER_NAME = "local-core-lab"
LOCAL_PARSER_VERSION = "1.0.0"
MAX_EXTRACTED_CHARACTERS = 200_000
MAX_PDF_PAGES = 50
MAX_IMAGE_PAGES = 30
MAX_IMAGE_PIXELS = 40_000_000
LOW_CONFIDENCE_THRESHOLD = 0.85
STALE_RUNNING_TASK_AFTER = timedelta(minutes=30)


class SourceParseFailure(RuntimeError):
    """Safe, stable error that can be shown without leaking report contents."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class MetricDefinition:
    canonical_name: str
    test_code: str
    category: str
    aliases: tuple[str, ...]


@dataclass(frozen=True)
class TextExtraction:
    text: str
    method: str
    confidence: float
    page_count: int


@dataclass(frozen=True)
class CandidateParseResult:
    candidates: list[CandidateObservation]
    low_confidence_count: int
    unparsed_count: int
    ignored_line_count: int


def _module_available(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def _command_available(name: str) -> bool:
    return shutil.which(name) is not None


def _ocr_languages() -> set[str]:
    try:
        return set(pytesseract.get_languages(config=""))
    except Exception:
        return set()


def _heic_decoder_available() -> bool:
    return register_optional_heif_decoder()


def _capability(status_value: str, reason_codes: Iterable[str]) -> dict:
    return {
        "status": status_value,
        "reason_codes": list(reason_codes),
    }


def probe_local_parser_readiness(
    *,
    module_available: Callable[[str], bool] = _module_available,
    command_available: Callable[[str], bool] = _command_available,
    language_provider: Callable[[], set[str]] = _ocr_languages,
    heic_decoder_available: Callable[[], bool] = _heic_decoder_available,
) -> dict:
    """Return a path-specific, privacy-safe local parsing capability report."""

    pdfplumber_ready = module_available("pdfplumber")
    pdf2image_ready = module_available("pdf2image")
    tesseract_ready = command_available("tesseract")
    poppler_ready = command_available("pdftoppm") or command_available("pdftocairo")
    languages = language_provider() if tesseract_ready else set()
    supported_languages = sorted(languages.intersection({"chi_sim", "eng"}))
    heic_ready = heic_decoder_available()

    digital_reasons = [] if pdfplumber_ready else ["pdfplumber_missing"]
    digital_status = "ready" if not digital_reasons else "unavailable"

    image_reasons: list[str] = []
    if not tesseract_ready:
        image_reasons.append("tesseract_missing")
    if not supported_languages:
        image_reasons.append("ocr_language_missing")
    elif "chi_sim" not in supported_languages:
        image_reasons.append("chi_sim_language_missing")
    if image_reasons:
        image_status = (
            "partial" if tesseract_ready and supported_languages else "unavailable"
        )
    else:
        image_status = "ready"

    scanned_reasons = list(image_reasons)
    if not pdf2image_ready:
        scanned_reasons.append("pdf2image_missing")
    if not poppler_ready:
        scanned_reasons.append("poppler_missing")
    if not scanned_reasons:
        scanned_status = "ready"
    elif pdf2image_ready and poppler_ready and image_status == "partial":
        scanned_status = "partial"
    else:
        scanned_status = "unavailable"

    heic_reasons = list(image_reasons)
    if not heic_ready:
        heic_reasons.append("heic_decoder_missing")
    if not heic_reasons:
        heic_status = "ready"
    elif heic_ready and image_status == "partial":
        heic_status = "partial"
    else:
        heic_status = "unavailable"

    reason_codes = list(
        dict.fromkeys(digital_reasons + image_reasons + scanned_reasons + heic_reasons)
    )
    statuses = {
        digital_status,
        image_status,
        scanned_status,
        heic_status,
    }
    if statuses == {"ready"}:
        overall_status = "ready"
    elif digital_status == "ready":
        overall_status = "partial"
    else:
        overall_status = "unavailable"

    return {
        "parser_name": LOCAL_PARSER_NAME,
        "parser_version": LOCAL_PARSER_VERSION,
        "status": overall_status,
        "capabilities": {
            "digital_pdf": _capability(digital_status, digital_reasons),
            "image_ocr": _capability(image_status, image_reasons),
            "scanned_pdf_ocr": _capability(scanned_status, scanned_reasons),
            "heic_image_ocr": _capability(heic_status, heic_reasons),
        },
        "supported_ocr_languages": supported_languages,
        "reason_codes": reason_codes,
    }


CORE_METRICS = (
    MetricDefinition(
        "空腹血糖",
        "GLU",
        "chemistry",
        ("空腹血糖", "葡萄糖", "glucose", "glu"),
    ),
    MetricDefinition(
        "糖化血红蛋白",
        "HBA1C",
        "endocrinology",
        ("糖化血红蛋白", "hba1c", "hemoglobin a1c"),
    ),
    MetricDefinition(
        "总胆固醇",
        "TC",
        "lipids",
        ("总胆固醇", "total cholesterol", "cholesterol, total"),
    ),
    MetricDefinition(
        "甘油三酯",
        "TG",
        "lipids",
        ("甘油三酯", "triglycerides", "triglyceride"),
    ),
    MetricDefinition(
        "低密度脂蛋白胆固醇",
        "LDL-C",
        "lipids",
        ("低密度脂蛋白胆固醇", "低密度脂蛋白", "ldl cholesterol", "ldl-c", "ldl"),
    ),
    MetricDefinition(
        "高密度脂蛋白胆固醇",
        "HDL-C",
        "lipids",
        ("高密度脂蛋白胆固醇", "高密度脂蛋白", "hdl cholesterol", "hdl-c", "hdl"),
    ),
    MetricDefinition(
        "尿酸",
        "UA",
        "chemistry",
        ("尿酸", "uric acid"),
    ),
    MetricDefinition(
        "肌酐",
        "CREA",
        "chemistry",
        ("肌酐", "creatinine", "crea"),
    ),
    MetricDefinition(
        "丙氨酸氨基转移酶",
        "ALT",
        "hepatology",
        ("丙氨酸氨基转移酶", "谷丙转氨酶", "alanine aminotransferase", "alt"),
    ),
    MetricDefinition(
        "天门冬氨酸氨基转移酶",
        "AST",
        "hepatology",
        ("天门冬氨酸氨基转移酶", "谷草转氨酶", "aspartate aminotransferase", "ast"),
    ),
    MetricDefinition(
        "白细胞计数",
        "WBC",
        "hematology",
        ("白细胞计数", "白细胞", "white blood cell count", "wbc"),
    ),
    MetricDefinition(
        "红细胞计数",
        "RBC",
        "hematology",
        ("红细胞计数", "红细胞", "red blood cell count", "rbc"),
    ),
    MetricDefinition(
        "血红蛋白",
        "HGB",
        "hematology",
        ("血红蛋白", "hemoglobin", "hgb"),
    ),
    MetricDefinition(
        "血小板计数",
        "PLT",
        "hematology",
        ("血小板计数", "血小板", "platelet count", "platelets", "plt"),
    ),
)

_NUMERIC_RESULT = re.compile(r"(?P<prefix>[<>≤≥]?)\s*(?P<value>-?\d+(?:\.\d+)?)")
_REFERENCE_RANGE = re.compile(
    r"(?P<minimum>-?\d+(?:\.\d+)?)\s*(?:--|[-–—~～]|至)\s*(?P<maximum>-?\d+(?:\.\d+)?)"
)
_DATE_PATTERNS = (
    re.compile(r"(?P<year>20\d{2})[-/.年](?P<month>\d{1,2})[-/.月](?P<day>\d{1,2})日?"),
)
_STATUS_TOKENS = {
    "↑": "high",
    "h": "high",
    "high": "high",
    "偏高": "high",
    "高": "high",
    "↓": "low",
    "l": "low",
    "low": "low",
    "偏低": "low",
    "低": "low",
    "异常": "abnormal",
    "abnormal": "abnormal",
    "危急": "critical",
    "critical": "critical",
    "临界": "borderline",
    "borderline": "borderline",
    "正常": "normal",
    "normal": "normal",
}


def _find_alias(line: str) -> tuple[MetricDefinition, re.Match[str]] | None:
    for metric in CORE_METRICS:
        for alias in sorted(metric.aliases, key=len, reverse=True):
            if alias.isascii():
                pattern = rf"(?<![A-Za-z]){re.escape(alias)}(?![A-Za-z])"
                match = re.search(pattern, line, flags=re.IGNORECASE)
            else:
                match = re.search(re.escape(alias), line)
            if match:
                return metric, match
    return None


def _extract_report_date(text: str, fallback: date | None) -> date | None:
    if fallback is not None:
        return fallback
    for pattern in _DATE_PATTERNS:
        match = pattern.search(text[:10_000])
        if not match:
            continue
        try:
            return date(
                int(match.group("year")),
                int(match.group("month")),
                int(match.group("day")),
            )
        except ValueError:
            continue
    return None


def _as_utc_naive(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _result_status(
    line: str,
    value: float,
    ref_min: float | None,
    ref_max: float | None,
) -> str | None:
    lowered = line.lower()
    for token, result_status in _STATUS_TOKENS.items():
        if token.isascii():
            if token in {"h", "l"}:
                pattern = rf"(?<![a-z0-9/]){token}(?![a-z0-9])"
            else:
                pattern = rf"(?<![a-z]){re.escape(token)}(?![a-z])"
            if re.search(pattern, lowered):
                return result_status
        elif token in line:
            return result_status
    if ref_min is not None and value < ref_min:
        return "low"
    if ref_max is not None and value > ref_max:
        return "high"
    if ref_min is not None and ref_max is not None:
        return "normal"
    return None


def _extract_unit(text_after_value: str) -> str | None:
    cleaned = text_after_value.lstrip(" :：|,，")
    if not cleaned:
        return None
    token = re.split(r"[\s()（）,，;；]+", cleaned, maxsplit=1)[0].strip()
    if not token or token.lower() in _STATUS_TOKENS:
        return None
    if _REFERENCE_RANGE.fullmatch(token):
        return None
    if not re.search(r"[%A-Za-zμµ\u4e00-\u9fff]", token):
        return None
    return token[:100]


def parse_core_lab_candidates(
    extraction: TextExtraction,
    *,
    report_date: date | None,
) -> CandidateParseResult:
    """Parse a conservative allow-list of common numeric lab metrics."""

    candidates: list[CandidateObservation] = []
    recognized_lines = 0
    nonempty_lines = 0
    resolved_date = _extract_report_date(extraction.text, report_date)

    for line_number, raw_line in enumerate(extraction.text.splitlines(), start=1):
        line = " ".join(raw_line.strip().split())
        if not line:
            continue
        nonempty_lines += 1
        alias_match = _find_alias(line)
        if alias_match is None:
            continue
        recognized_lines += 1
        metric, matched_alias = alias_match
        suffix = line[matched_alias.end() :]
        value_match = _NUMERIC_RESULT.search(suffix)
        if value_match is None:
            continue

        try:
            numeric_value = float(value_match.group("value"))
        except ValueError:
            continue
        after_value = suffix[value_match.end() :]
        unit = _extract_unit(after_value)
        range_match = _REFERENCE_RANGE.search(after_value)
        ref_min = float(range_match.group("minimum")) if range_match else None
        ref_max = float(range_match.group("maximum")) if range_match else None
        if ref_min is not None and ref_max is not None and ref_min >= ref_max:
            ref_min = None
            ref_max = None
            range_match = None

        confidence = min(extraction.confidence, 0.96)
        if unit is None:
            confidence -= 0.08
        if range_match is None:
            confidence -= 0.05
        confidence = round(max(0.0, min(confidence, 1.0)), 2)

        try:
            candidates.append(
                CandidateObservation(
                    observed_date=resolved_date,
                    test_name=metric.canonical_name,
                    canonical_test_name=metric.canonical_name,
                    test_code=metric.test_code,
                    result_type="quantitative",
                    numeric_value=numeric_value,
                    unit=unit,
                    ref_range_min=ref_min,
                    ref_range_max=ref_max,
                    ref_range_text=range_match.group(0) if range_match else None,
                    result_status=_result_status(
                        after_value,
                        numeric_value,
                        ref_min,
                        ref_max,
                    ),
                    category=metric.category,
                    source_page=1 if extraction.page_count == 1 else None,
                    source_locator=f"提取文本第 {line_number} 行",
                    raw_text=line[:2000],
                    confidence=confidence,
                )
            )
        except ValidationError:
            continue

    return CandidateParseResult(
        candidates=candidates,
        low_confidence_count=sum(
            candidate.confidence is not None
            and candidate.confidence < LOW_CONFIDENCE_THRESHOLD
            for candidate in candidates
        ),
        unparsed_count=max(0, recognized_lines - len(candidates)),
        ignored_line_count=max(0, nonempty_lines - recognized_lines),
    )


class HealthSourceParseService:
    """Creates durable parse jobs and converts local extraction into review batches."""

    def get_task(self, db: Session, task_id: int) -> HealthSourceParseTask | None:
        return (
            db.query(HealthSourceParseTask)
            .options(joinedload(HealthSourceParseTask.source_document))
            .filter(HealthSourceParseTask.id == task_id)
            .first()
        )

    def list_tasks(self, db: Session, patient_id: int) -> list[HealthSourceParseTask]:
        return (
            db.query(HealthSourceParseTask)
            .filter(HealthSourceParseTask.patient_id == patient_id)
            .order_by(HealthSourceParseTask.created_at.desc())
            .all()
        )

    def recover_interrupted_tasks(self, db: Session) -> int:
        """Requeue work abandoned by the previous single worker process."""

        interrupted = (
            db.query(HealthSourceParseTask)
            .filter(HealthSourceParseTask.status == "running")
            .order_by(
                HealthSourceParseTask.started_at.asc(),
                HealthSourceParseTask.id.asc(),
            )
            .all()
        )
        for task in interrupted:
            task.status = "queued"
            task.error_code = None
            task.started_at = None
            task.completed_at = None
            task.cancelled_at = None
            task.summary = {"formal_write_count": 0}
            self._add_activity(
                db,
                task=task,
                action="recovered_after_restart",
                description="Requeued an interrupted local parsing task after restart",
                metadata={
                    "previous_status": "running",
                    "previous_attempt_count": task.attempt_count,
                },
            )
        if interrupted:
            db.commit()
        return len(interrupted)

    def create_task(
        self,
        db: Session,
        *,
        source: HealthSourceDocument,
        current_user: User,
        task_in: HealthSourceParseTaskStart,
    ) -> HealthSourceParseTask:
        if source.status == "archived":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Source document is not available for parsing",
            )
        key = (
            task_in.idempotency_key
            or hashlib.sha256(
                (
                    f"{source.patient_id}:{source.sha256}:"
                    f"{LOCAL_PARSER_NAME}:{LOCAL_PARSER_VERSION}"
                ).encode()
            ).hexdigest()
        )
        existing = (
            db.query(HealthSourceParseTask)
            .filter(
                HealthSourceParseTask.patient_id == source.patient_id,
                HealthSourceParseTask.idempotency_key == key,
            )
            .first()
        )
        if existing is not None:
            if existing.source_document_id != source.id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Idempotency key belongs to another source document",
                )
            return existing

        task = HealthSourceParseTask(
            patient_id=source.patient_id,
            source_document_id=source.id,
            created_by_user_id=current_user.id,
            idempotency_key=key,
            parser_name=LOCAL_PARSER_NAME,
            parser_version=LOCAL_PARSER_VERSION,
            status="queued",
            attempt_count=0,
            summary={},
        )
        db.add(task)
        db.flush()
        self._add_activity(
            db,
            task=task,
            action="created",
            description="Queued a local health source parsing task",
            metadata={"source_document_id": source.id},
        )
        db.commit()
        db.refresh(task)
        return task

    def cancel_task(
        self, db: Session, task: HealthSourceParseTask
    ) -> HealthSourceParseTask:
        if task.status == "cancelled":
            return task
        if task.status != "queued":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only queued parsing tasks can be cancelled",
            )
        task.status = "cancelled"
        task.cancelled_at = get_utc_now()
        task.completed_at = task.cancelled_at
        self._add_activity(
            db,
            task=task,
            action="cancelled",
            description="Cancelled a local health source parsing task",
            metadata={},
        )
        db.commit()
        db.refresh(task)
        return task

    def retry_task(
        self, db: Session, task: HealthSourceParseTask
    ) -> HealthSourceParseTask:
        if task.status == "running":
            stale_before = _as_utc_naive(get_utc_now()) - STALE_RUNNING_TASK_AFTER
            if task.started_at is None or _as_utc_naive(task.started_at) > stale_before:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Running parsing task is not stale",
                )
        elif task.status not in {"failed", "cancelled"}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only failed, cancelled, or stale running parsing tasks can be retried",
            )
        task.status = "queued"
        task.error_code = None
        task.summary = {}
        task.started_at = None
        task.completed_at = None
        task.cancelled_at = None
        self._add_activity(
            db,
            task=task,
            action="retried",
            description="Retried a local health source parsing task",
            metadata={"next_attempt": task.attempt_count + 1},
        )
        db.commit()
        db.refresh(task)
        return task

    def process_task(
        self,
        session_factory: Callable[[], Session],
        task_id: int,
    ) -> None:
        with session_factory() as db:
            started_at = get_utc_now()
            claimed = (
                db.query(HealthSourceParseTask)
                .filter(
                    HealthSourceParseTask.id == task_id,
                    HealthSourceParseTask.status == "queued",
                )
                .update(
                    {
                        HealthSourceParseTask.status: "running",
                        HealthSourceParseTask.started_at: started_at,
                        HealthSourceParseTask.attempt_count: HealthSourceParseTask.attempt_count
                        + 1,
                        HealthSourceParseTask.error_code: None,
                    },
                    synchronize_session=False,
                )
            )
            db.commit()
            if claimed != 1:
                return
            task = self.get_task(db, task_id)
            if task is None:
                return

            try:
                source = task.source_document
                if source is None:
                    raise SourceParseFailure("source_missing")
                if source.status == "archived":
                    raise SourceParseFailure("source_archived")
                extraction = self._extract_source(db, source)
                parsed = parse_core_lab_candidates(
                    extraction,
                    report_date=source.report_date,
                )
                if not parsed.candidates:
                    raise SourceParseFailure("no_supported_candidates")
                current_user = (
                    db.query(User).filter(User.id == task.created_by_user_id).first()
                )
                if current_user is None:
                    raise SourceParseFailure("task_owner_missing")
                patient = (
                    db.query(Patient).filter(Patient.id == task.patient_id).first()
                )
                if patient is None:
                    raise SourceParseFailure("task_subject_missing")
                subject_identity = assess_report_subject_identity(
                    extraction.text,
                    first_name=patient.first_name,
                    last_name=patient.last_name,
                    extraction_method=extraction.method,
                    extraction_confidence=extraction.confidence,
                )

                batch_key = hashlib.sha256(
                    (
                        f"parse-task:{task.id}:{source.sha256}:"
                        f"{task.parser_name}:{task.parser_version}"
                    ).encode()
                ).hexdigest()
                batch = health_import_service.create_batch(
                    db,
                    patient_id=task.patient_id,
                    current_user=current_user,
                    batch_in=HealthImportBatchCreate(
                        source_document_id=source.id,
                        parser_name=task.parser_name,
                        parser_version=task.parser_version,
                        idempotency_key=batch_key,
                        candidates=parsed.candidates,
                    ),
                    subject_identity=subject_identity,
                )
                task = self.get_task(db, task_id)
                assert task is not None
                task.import_batch_id = batch.id
                task.status = "succeeded"
                task.completed_at = get_utc_now()
                task.summary = {
                    "candidate_count": len(parsed.candidates),
                    "low_confidence_count": parsed.low_confidence_count,
                    "unparsed_count": parsed.unparsed_count,
                    "ignored_line_count": parsed.ignored_line_count,
                    "page_count": extraction.page_count,
                    "character_count": len(extraction.text),
                    "extraction_method": extraction.method,
                    "extraction_confidence": extraction.confidence,
                    "subject_identity_status": subject_identity.status,
                    "formal_write_count": 0,
                }
                self._add_activity(
                    db,
                    task=task,
                    action="completed",
                    description="Completed local parsing into a review batch",
                    metadata={
                        "import_batch_id": batch.id,
                        "candidate_count": len(parsed.candidates),
                        "low_confidence_count": parsed.low_confidence_count,
                    },
                )
                db.commit()
            except SourceParseFailure as error:
                db.rollback()
                self._mark_failed(db, task_id, error.code)
            except Exception:
                db.rollback()
                logger.exception(
                    "Local health source parsing failed",
                    extra={"task_id": task_id},
                )
                self._mark_failed(db, task_id, "parse_internal_error")

    def _extract_source(
        self,
        db: Session,
        source: HealthSourceDocument,
    ) -> TextExtraction:
        if source.primary_file_id is None:
            raise SourceParseFailure("source_file_missing")
        entity_file = (
            db.query(EntityFile).filter(EntityFile.id == source.primary_file_id).first()
        )
        if entity_file is None:
            raise SourceParseFailure("source_file_missing")
        file_path = Path(entity_file.file_path)
        if not file_path.is_file():
            raise SourceParseFailure("source_file_missing")
        content = file_path.read_bytes()
        if hashlib.sha256(content).hexdigest() != source.sha256:
            raise SourceParseFailure("source_hash_mismatch")

        if source.mime_type == "application/pdf":
            extraction = self._extract_pdf(
                content,
                filename=source.original_filename,
            )
        elif source.mime_type.startswith("image/"):
            extraction = self._extract_image(content)
        else:
            raise SourceParseFailure("unsupported_source_type")

        if len(extraction.text) > MAX_EXTRACTED_CHARACTERS:
            raise SourceParseFailure("extracted_text_limit_exceeded")
        if not extraction.text.strip():
            raise SourceParseFailure("text_extraction_failed")
        return extraction

    @staticmethod
    def _extract_pdf(content: bytes, *, filename: str) -> TextExtraction:
        try:
            with pdfplumber.open(io.BytesIO(content)) as document:
                if len(document.pages) > MAX_PDF_PAGES:
                    raise SourceParseFailure("source_page_limit_exceeded")
                page_texts = [page.extract_text() or "" for page in document.pages]
        except SourceParseFailure:
            raise
        except Exception as error:
            raise SourceParseFailure("text_extraction_failed") from error

        text = "\n".join(page_texts)
        digit_count = sum(character.isdigit() for character in text)
        if len(text) >= 50 and digit_count / max(len(text), 1) >= 0.01:
            return TextExtraction(
                text=text,
                method="native",
                confidence=0.95,
                page_count=max(1, len(page_texts)),
            )

        # OCR conversion depends on optional local Poppler/Tesseract packages.
        # Keep the dependency lazy so digital PDFs remain usable without them.
        try:
            from app.services.pdf_text_extraction_service import (
                PDFTextExtractionService,
            )
        except ModuleNotFoundError as error:
            raise SourceParseFailure("ocr_unavailable") from error

        result = PDFTextExtractionService().extract_text(
            content,
            filename=filename,
        )
        if result.get("method") == "failed" or not result.get("text"):
            if "Tesseract" in (result.get("error") or ""):
                raise SourceParseFailure("ocr_unavailable")
            raise SourceParseFailure("text_extraction_failed")
        return TextExtraction(
            text=str(result["text"]),
            method=str(result["method"]),
            confidence=float(result.get("confidence") or 0.0),
            page_count=max(1, int(result.get("page_count") or 1)),
        )

    @staticmethod
    def _extract_image(content: bytes) -> TextExtraction:
        register_optional_heif_decoder()
        try:
            with Image.open(io.BytesIO(content)) as image:
                width, height = image.size
                if width * height > MAX_IMAGE_PIXELS:
                    raise SourceParseFailure("image_pixel_limit_exceeded")
                frames = []
                for index, frame in enumerate(ImageSequence.Iterator(image), start=1):
                    if index > MAX_IMAGE_PAGES:
                        raise SourceParseFailure("source_page_limit_exceeded")
                    frames.append(frame.copy().convert("L"))
        except SourceParseFailure:
            raise
        except (UnidentifiedImageError, OSError) as error:
            raise SourceParseFailure("unsupported_image_codec") from error

        try:
            available_languages = set(pytesseract.get_languages(config=""))
        except pytesseract.TesseractNotFoundError as error:
            raise SourceParseFailure("ocr_unavailable") from error
        language = None
        if "chi_sim" in available_languages and "eng" in available_languages:
            language = "chi_sim+eng"
        elif "chi_sim" in available_languages:
            language = "chi_sim"
        elif "eng" in available_languages:
            language = "eng"
        if language is None:
            raise SourceParseFailure("ocr_language_unavailable")

        page_texts = [
            pytesseract.image_to_string(frame, lang=language, config="--psm 6")
            for frame in frames
        ]
        text = "\n".join(page_texts)
        return TextExtraction(
            text=text,
            method="ocr",
            confidence=0.75,
            page_count=len(frames),
        )

    def _mark_failed(self, db: Session, task_id: int, error_code: str) -> None:
        task = self.get_task(db, task_id)
        if task is None:
            return
        task.status = "failed"
        task.error_code = error_code
        task.completed_at = get_utc_now()
        task.summary = {"formal_write_count": 0}
        self._add_activity(
            db,
            task=task,
            action="failed",
            description="Local health source parsing task failed safely",
            metadata={"error_code": error_code},
        )
        db.commit()

    @staticmethod
    def _add_activity(
        db: Session,
        *,
        task: HealthSourceParseTask,
        action: str,
        description: str,
        metadata: dict,
    ) -> None:
        db.add(
            ActivityLog.create_activity(
                action=action,
                entity_type="health_source_parse_task",
                description=description,
                user_id=task.created_by_user_id,
                patient_id=task.patient_id,
                entity_id=task.id,
                metadata=metadata,
            )
        )


health_source_parse_service = HealthSourceParseService()
