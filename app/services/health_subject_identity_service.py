"""Conservative, local-only report subject identity assessment."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

SUBJECT_IDENTITY_ASSESSMENT_VERSION = "subject-identity-assessment@1.0.0"
MIN_MISMATCH_CONFIDENCE = 0.70

_LABELED_NAME = re.compile(
    r"(?im)^[ \t]*(?P<label>"
    r"患者姓名|受检者姓名|受检者|姓名|patient[ \t]+name|name"
    r")[ \t]*[:：|][ \t]*(?P<value>[^\r\n]{1,120})$"
)
_FOLLOWING_FIELD = re.compile(
    r"\s+(?=(?:"
    r"性别|年龄|出生日期|出生年月|身份证号|证件号码|"
    r"sex|gender|age|date[ \t]+of[ \t]+birth|dob|id"
    r")[ \t]*[:：|])",
    re.IGNORECASE,
)
_MASK_CHARACTERS = frozenset("*＊●○•?？_")
_ALLOWED_NAME_PUNCTUATION = frozenset(" '-,.'’·")

_LABEL_CODES = {
    "患者姓名": ("patient_name", 0.99),
    "受检者姓名": ("exam_subject", 0.98),
    "受检者": ("exam_subject", 0.97),
    "姓名": ("name", 0.94),
    "patient name": ("patient_name", 0.99),
    "name": ("name", 0.90),
}


@dataclass(frozen=True)
class SubjectIdentityAssessment:
    """A bounded assessment that never decides or transfers record ownership."""

    status: str
    observed_name: str | None
    confidence: float | None
    assessment_version: str
    evidence: dict


def _normalized_label(label: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", label).casefold().split())


def _normalized_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return "".join(character for character in normalized if character.isalnum())


def _clean_observed_name(value: str) -> str | None:
    candidate = _FOLLOWING_FIELD.split(value, maxsplit=1)[0]
    candidate = candidate.split("|", 1)[0].strip(" \t:：,，;；")
    candidate = " ".join(candidate.split())
    if not 2 <= len(candidate) <= 80:
        return None
    if any(character in _MASK_CHARACTERS for character in candidate):
        return None
    if any(character.isdigit() for character in candidate):
        return None
    if len(candidate.split()) > 6:
        return None
    if not any(character.isalpha() for character in candidate):
        return None
    for character in candidate:
        if character.isalpha() or unicodedata.category(character).startswith("M"):
            continue
        if character in _ALLOWED_NAME_PUNCTUATION:
            continue
        return None
    return candidate


def _unavailable(
    reason_code: str, *, candidate_count: int = 0
) -> SubjectIdentityAssessment:
    return SubjectIdentityAssessment(
        status="unavailable",
        observed_name=None,
        confidence=None,
        assessment_version=SUBJECT_IDENTITY_ASSESSMENT_VERSION,
        evidence={
            "reason_code": reason_code,
            "candidate_count": candidate_count,
            "match_method": "exact_normalized",
        },
    )


def assess_report_subject_identity(
    text: str,
    *,
    first_name: str,
    last_name: str,
    extraction_method: str,
    extraction_confidence: float,
) -> SubjectIdentityAssessment:
    """Assess one report using explicit labels and exact normalized name matching.

    The result can add a review warning, but it must never move a source document,
    reject an original, accept a candidate, or create a formal health record.
    """

    extracted: list[tuple[str, str, float]] = []
    for match in _LABELED_NAME.finditer(text):
        label_key = _normalized_label(match.group("label"))
        label_code, label_confidence = _LABEL_CODES[label_key]
        observed_name = _clean_observed_name(match.group("value"))
        if observed_name is None:
            continue
        extracted.append((observed_name, label_code, label_confidence))

    if not extracted:
        return _unavailable("no_usable_explicit_name")

    distinct_names = {
        _normalized_name(observed_name) for observed_name, _, _ in extracted
    }
    distinct_names.discard("")
    if len(distinct_names) != 1:
        return _unavailable(
            "conflicting_labeled_names",
            candidate_count=len(distinct_names),
        )

    observed_name, label_code, label_confidence = max(
        extracted, key=lambda candidate: candidate[2]
    )
    confidence = round(
        min(max(float(extraction_confidence), 0.0), label_confidence, 1.0),
        4,
    )
    if confidence < MIN_MISMATCH_CONFIDENCE:
        return _unavailable("identity_confidence_too_low", candidate_count=1)

    target_variants = {
        _normalized_name(f"{first_name}{last_name}"),
        _normalized_name(f"{last_name}{first_name}"),
    }
    observed_normalized = _normalized_name(observed_name)
    status = (
        "matched" if observed_normalized in target_variants else "suspected_mismatch"
    )
    return SubjectIdentityAssessment(
        status=status,
        observed_name=observed_name,
        confidence=confidence,
        assessment_version=SUBJECT_IDENTITY_ASSESSMENT_VERSION,
        evidence={
            "label": label_code,
            "extraction_method": extraction_method,
            "match_method": "exact_normalized",
            "candidate_count": 1,
        },
    )
