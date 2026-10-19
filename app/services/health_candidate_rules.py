from datetime import date
from typing import Protocol


class CandidateLike(Protocol):
    observed_date: date | None
    result_type: str
    unit: str | None
    ref_range_min: float | None
    ref_range_max: float | None
    ref_range_text: str | None
    category: str | None
    canonical_test_name: str | None
    test_code: str | None
    confidence: float | None


def candidate_validation_issues(candidate: CandidateLike) -> list[str]:
    """Return non-blocking data-quality issues shared by every entry adapter."""

    issues: list[str] = []
    if candidate.observed_date is None:
        issues.append("missing_date")
    if candidate.result_type == "quantitative" and not candidate.unit:
        issues.append("missing_unit")
    if (
        candidate.ref_range_min is None
        and candidate.ref_range_max is None
        and not candidate.ref_range_text
    ):
        issues.append("missing_reference")
    if not candidate.category:
        issues.append("missing_category")
    if not candidate.canonical_test_name and not candidate.test_code:
        issues.append("uncanonicalized_name")
    if candidate.confidence is not None and candidate.confidence < 0.85:
        issues.append("low_confidence")
    return issues
