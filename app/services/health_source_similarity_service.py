"""Candidate-only image similarity for retained household health sources.

The module persists compact hashes and comparison evidence, never thumbnails or
raw pixels.  A match is a review hint only: callers must preserve both source
documents regardless of the result.
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.constants import MAX_HEALTH_SOURCE_IMAGE_FILE_SIZE
from app.core.utils.datetime_utils import get_utc_now
from app.models.files import EntityFile
from app.models.health_imports import (
    HealthSourceDocument,
    HealthSourceSimilarityRelation,
)
from app.models.user import User
from app.services.health_image_codec import register_optional_heif_decoder

IMAGE_SIMILARITY_ALGORITHM_VERSION = "source-image-similarity@1.0.0"
SUPPORTED_IMAGE_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}
MAX_SIGNATURE_PIXELS = 40_000_000
SIGNATURE_WIDTH = 96
SIGNATURE_MAX_HEIGHT = 640
BAND_COUNT = 18
MAX_COMPARISON_SOURCES = 200
MAX_RELATIONS_PER_SOURCE = 20


@dataclass(frozen=True)
class ImageSimilarityComparison:
    relation_type: Literal["near_duplicate", "partial_overlap"]
    confidence: float
    evidence: dict[str, Any]


def _hash_hex(bits: np.ndarray) -> str:
    flattened = np.asarray(bits, dtype=np.uint8).flatten()
    packed = np.packbits(flattened)
    return packed.tobytes().hex()


def _difference_hash(image: Image.Image) -> str:
    resized = image.resize((9, 8), Image.Resampling.LANCZOS)
    pixels = np.asarray(resized, dtype=np.int16)
    return _hash_hex(pixels[:, 1:] > pixels[:, :-1])


def _average_hash(image: Image.Image) -> str:
    resized = image.resize((8, 8), Image.Resampling.LANCZOS)
    pixels = np.asarray(resized, dtype=np.float32)
    return _hash_hex(pixels > float(pixels.mean()))


def _edge_score(image: Image.Image) -> float:
    pixels = np.asarray(image, dtype=np.float32)
    if pixels.size == 0:
        return 0.0
    horizontal = (
        float(np.abs(np.diff(pixels, axis=1)).mean()) if pixels.shape[1] > 1 else 0
    )
    vertical = (
        float(np.abs(np.diff(pixels, axis=0)).mean()) if pixels.shape[0] > 1 else 0
    )
    return round((horizontal + vertical) / (2 * 255), 6)


def _open_normalized_image(content: bytes, mime_type: str) -> Image.Image | None:
    if mime_type not in SUPPORTED_IMAGE_MIME_TYPES or not content:
        return None
    if mime_type in {"image/heic", "image/heif"}:
        register_optional_heif_decoder()
    try:
        with Image.open(io.BytesIO(content)) as opened:
            width, height = opened.size
            if width <= 0 or height <= 0 or width * height > MAX_SIGNATURE_PIXELS:
                return None
            normalized = ImageOps.exif_transpose(opened).convert("L")
    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError):
        return None

    target_height = max(
        1, round(normalized.height * SIGNATURE_WIDTH / normalized.width)
    )
    target_height = min(target_height, SIGNATURE_MAX_HEIGHT)
    normalized = normalized.resize(
        (SIGNATURE_WIDTH, target_height),
        Image.Resampling.LANCZOS,
    )
    return ImageOps.autocontrast(normalized, cutoff=0.5)


def build_image_similarity_signature(
    content: bytes,
    *,
    mime_type: str,
) -> dict[str, Any] | None:
    """Return non-reconstructive global and overlapping-band hashes."""

    normalized = _open_normalized_image(content, mime_type)
    if normalized is None:
        return None

    band_height = min(
        normalized.height,
        max(24, round(normalized.height * 0.22)),
    )
    max_top = max(0, normalized.height - band_height)
    bands: list[dict[str, Any]] = []
    for index in range(BAND_COUNT):
        top = 0 if BAND_COUNT == 1 else round(max_top * index / max(1, BAND_COUNT - 1))
        crop = normalized.crop((0, top, normalized.width, top + band_height))
        bands.append(
            {
                "position": round(index / max(1, BAND_COUNT - 1), 6),
                "difference_hash": _difference_hash(crop),
                "edge_score": _edge_score(crop),
            }
        )

    return {
        "algorithm_version": IMAGE_SIMILARITY_ALGORITHM_VERSION,
        "source": {
            "width": normalized.width,
            "height": normalized.height,
            "aspect_ratio": round(normalized.width / normalized.height, 6),
        },
        "global": {
            "difference_hash": _difference_hash(normalized),
            "average_hash": _average_hash(normalized),
        },
        "bands": bands,
    }


def _hamming_distance(first: str, second: str) -> int:
    if len(first) != len(second) or not first:
        return 64
    try:
        return (int(first, 16) ^ int(second, 16)).bit_count()
    except ValueError:
        return 64


def _band_similarity(first: dict[str, Any], second: dict[str, Any]) -> float:
    if (
        max(float(first.get("edge_score", 0)), float(second.get("edge_score", 0)))
        < 0.004
    ):
        return 0.0
    distance = _hamming_distance(
        str(first.get("difference_hash", "")),
        str(second.get("difference_hash", "")),
    )
    return max(0.0, 1 - distance / 64)


def _alignment(
    first_bands: list[dict[str, Any]],
    second_bands: list[dict[str, Any]],
    *,
    offset: int,
) -> tuple[int, int, float, int]:
    matched = 0
    comparable = 0
    similarity_total = 0.0
    longest_streak = 0
    current_streak = 0
    for first_index, first_band in enumerate(first_bands):
        second_index = first_index + offset
        if second_index < 0 or second_index >= len(second_bands):
            continue
        comparable += 1
        similarity = _band_similarity(first_band, second_bands[second_index])
        if similarity >= 0.79:
            matched += 1
            similarity_total += similarity
            current_streak += 1
            longest_streak = max(longest_streak, current_streak)
        else:
            current_streak = 0
    average = similarity_total / matched if matched else 0.0
    return matched, comparable, average, longest_streak


def compare_image_similarity_signatures(
    first: dict[str, Any] | None,
    second: dict[str, Any] | None,
) -> ImageSimilarityComparison | None:
    """Classify a conservative review candidate from two compact signatures."""

    if not first or not second:
        return None
    if (
        first.get("algorithm_version") != IMAGE_SIMILARITY_ALGORITHM_VERSION
        or second.get("algorithm_version") != IMAGE_SIMILARITY_ALGORITHM_VERSION
    ):
        return None
    first_bands = list(first.get("bands") or [])
    second_bands = list(second.get("bands") or [])
    if len(first_bands) < 8 or len(second_bands) < 8:
        return None

    first_global = first.get("global") or {}
    second_global = second.get("global") or {}
    global_distance = (
        _hamming_distance(
            str(first_global.get("difference_hash", "")),
            str(second_global.get("difference_hash", "")),
        )
        + _hamming_distance(
            str(first_global.get("average_hash", "")),
            str(second_global.get("average_hash", "")),
        )
    ) / 128
    try:
        first_aspect = float((first.get("source") or {})["aspect_ratio"])
        second_aspect = float((second.get("source") or {})["aspect_ratio"])
        aspect_delta = abs(math.log(first_aspect / second_aspect))
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        return None

    zero_match, _, zero_average, zero_streak = _alignment(
        first_bands,
        second_bands,
        offset=0,
    )
    zero_coverage = zero_match / max(len(first_bands), len(second_bands))
    if (
        aspect_delta <= 0.1
        and global_distance <= 0.18
        and zero_coverage >= 0.67
        and zero_streak >= 6
    ):
        confidence = min(
            0.99,
            0.72
            + (1 - global_distance) * 0.12
            + zero_coverage * 0.1
            + zero_average * 0.06,
        )
        return ImageSimilarityComparison(
            relation_type="near_duplicate",
            confidence=round(confidence, 4),
            evidence={
                "matched_region_ratio": round(zero_coverage, 4),
                "source_unique_ratio": round(max(0.0, 1 - zero_coverage), 4),
                "related_unique_ratio": round(max(0.0, 1 - zero_coverage), 4),
                "orientation": "full_page",
                "explanation_code": "similar_full_page_hashes",
            },
        )

    best: tuple[int, int, float, int, int] | None = None
    max_offset = min(len(first_bands), len(second_bands)) - 3
    for offset in range(-max_offset, max_offset + 1):
        if abs(offset) < 2:
            continue
        matched, comparable, average, streak = _alignment(
            first_bands,
            second_bands,
            offset=offset,
        )
        candidate = (matched, streak, average, comparable, offset)
        if best is None or candidate[:3] > best[:3]:
            best = candidate
    if best is None:
        return None

    matched, streak, average, _comparable, offset = best
    source_coverage = matched / len(first_bands)
    related_coverage = matched / len(second_bands)
    matched_ratio = min(source_coverage, related_coverage)
    if matched < 4 or streak < 3 or matched_ratio < 0.22 or average < 0.81:
        return None
    if matched_ratio >= 0.9:
        return None

    confidence = min(
        0.95,
        0.48 + matched_ratio * 0.42 + average * 0.16 + min(streak, 8) * 0.012,
    )
    return ImageSimilarityComparison(
        relation_type="partial_overlap",
        confidence=round(confidence, 4),
        evidence={
            "matched_region_ratio": round(matched_ratio, 4),
            "source_unique_ratio": round(max(0.0, 1 - source_coverage), 4),
            "related_unique_ratio": round(max(0.0, 1 - related_coverage), 4),
            "orientation": "vertical",
            "explanation_code": "shared_vertical_bands",
            "band_offset": offset,
        },
    )


def render_image_thumbnail(content: bytes, *, max_edge: int = 480) -> bytes:
    """Return a metadata-free bounded JPEG for owner-only review."""

    if max_edge < 64 or max_edge > 1024:
        raise ValueError("Thumbnail edge is outside the supported range")
    register_optional_heif_decoder()
    try:
        with Image.open(io.BytesIO(content)) as opened:
            width, height = opened.size
            if width <= 0 or height <= 0 or width * height > MAX_SIGNATURE_PIXELS:
                raise ValueError("Image dimensions are outside the supported range")
            thumbnail = ImageOps.exif_transpose(opened).convert("RGB")
            thumbnail.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    except (OSError, UnidentifiedImageError, Image.DecompressionBombError) as error:
        raise ValueError("Source image cannot be decoded") from error

    output = io.BytesIO()
    thumbnail.save(
        output,
        format="JPEG",
        quality=82,
        optimize=True,
        progressive=True,
    )
    return output.getvalue()


class HealthSourceSimilarityService:
    """Persist and review conservative image-similarity candidates."""

    @staticmethod
    def _read_retained_image(
        db: Session,
        source: HealthSourceDocument,
    ) -> bytes | None:
        if (
            source.primary_file_id is None
            or source.mime_type not in SUPPORTED_IMAGE_MIME_TYPES
        ):
            return None
        entity_file = (
            db.query(EntityFile)
            .filter(
                EntityFile.id == source.primary_file_id,
                EntityFile.entity_type == "source-document",
                EntityFile.entity_id == source.id,
                EntityFile.storage_backend == "local",
            )
            .first()
        )
        if entity_file is None:
            return None
        file_path = Path(entity_file.file_path)
        try:
            if (
                not file_path.is_file()
                or file_path.stat().st_size <= 0
                or file_path.stat().st_size > MAX_HEALTH_SOURCE_IMAGE_FILE_SIZE
            ):
                return None
            return file_path.read_bytes()
        except OSError:
            return None

    def _ensure_signature(
        self,
        db: Session,
        source: HealthSourceDocument,
    ) -> dict[str, Any] | None:
        if (
            source.visual_signature_algorithm == IMAGE_SIMILARITY_ALGORITHM_VERSION
            and isinstance(source.visual_signature, dict)
        ):
            return source.visual_signature
        content = self._read_retained_image(db, source)
        if content is None:
            return None
        signature = build_image_similarity_signature(
            content,
            mime_type=source.mime_type,
        )
        if signature is not None:
            source.visual_signature_algorithm = IMAGE_SIMILARITY_ALGORITHM_VERSION
            source.visual_signature = signature
            db.add(source)
        return signature

    @staticmethod
    def _normalized_evidence(
        *,
        new_source_id: int,
        left_source_id: int,
        evidence: dict[str, Any],
    ) -> dict[str, Any]:
        normalized = dict(evidence)
        if new_source_id != left_source_id:
            normalized["source_unique_ratio"], normalized["related_unique_ratio"] = (
                normalized["related_unique_ratio"],
                normalized["source_unique_ratio"],
            )
            if "band_offset" in normalized:
                normalized["band_offset"] = -int(normalized["band_offset"])
        return normalized

    def register_candidates(
        self,
        db: Session,
        *,
        source: HealthSourceDocument,
        content: bytes,
    ) -> list[HealthSourceSimilarityRelation]:
        """Create bounded candidate rows without committing the upload transaction."""

        if source.mime_type not in SUPPORTED_IMAGE_MIME_TYPES:
            return []
        signature = build_image_similarity_signature(
            content,
            mime_type=source.mime_type,
        )
        if signature is None:
            return []
        source.visual_signature_algorithm = IMAGE_SIMILARITY_ALGORITHM_VERSION
        source.visual_signature = signature
        db.add(source)

        existing_sources = (
            db.query(HealthSourceDocument)
            .filter(
                HealthSourceDocument.patient_id == source.patient_id,
                HealthSourceDocument.id != source.id,
                HealthSourceDocument.status != "archived",
                HealthSourceDocument.mime_type.in_(SUPPORTED_IMAGE_MIME_TYPES),
            )
            .order_by(HealthSourceDocument.created_at.desc())
            .limit(MAX_COMPARISON_SOURCES)
            .all()
        )
        comparisons: list[
            tuple[
                float,
                HealthSourceDocument,
                ImageSimilarityComparison,
            ]
        ] = []
        for candidate in existing_sources:
            candidate_signature = self._ensure_signature(db, candidate)
            comparison = compare_image_similarity_signatures(
                signature,
                candidate_signature,
            )
            if comparison is not None:
                comparisons.append(
                    (
                        comparison.confidence,
                        candidate,
                        comparison,
                    )
                )

        created: list[HealthSourceSimilarityRelation] = []
        for _confidence, candidate, comparison in sorted(
            comparisons,
            key=lambda item: (-item[0], item[1].id),
        )[:MAX_RELATIONS_PER_SOURCE]:
            left_id, right_id = sorted((source.id, candidate.id))
            existing = (
                db.query(HealthSourceSimilarityRelation)
                .filter(
                    HealthSourceSimilarityRelation.source_document_id == left_id,
                    HealthSourceSimilarityRelation.related_source_document_id
                    == right_id,
                    HealthSourceSimilarityRelation.algorithm_version
                    == IMAGE_SIMILARITY_ALGORITHM_VERSION,
                )
                .first()
            )
            if existing is not None:
                created.append(existing)
                continue
            relation = HealthSourceSimilarityRelation(
                patient_id=source.patient_id,
                source_document_id=left_id,
                related_source_document_id=right_id,
                relation_type=comparison.relation_type,
                confidence=comparison.confidence,
                algorithm_version=IMAGE_SIMILARITY_ALGORITHM_VERSION,
                evidence=self._normalized_evidence(
                    new_source_id=source.id,
                    left_source_id=left_id,
                    evidence=comparison.evidence,
                ),
                review_status="pending",
            )
            db.add(relation)
            db.flush()
            created.append(relation)
        return created

    @staticmethod
    def get_relation(
        db: Session,
        relation_id: int,
    ) -> HealthSourceSimilarityRelation | None:
        return (
            db.query(HealthSourceSimilarityRelation)
            .filter(HealthSourceSimilarityRelation.id == relation_id)
            .first()
        )

    @staticmethod
    def list_relations(
        db: Session,
        *,
        patient_id: int,
        review_status: str | None = None,
        limit: int = 50,
    ) -> list[HealthSourceSimilarityRelation]:
        query = db.query(HealthSourceSimilarityRelation).filter(
            HealthSourceSimilarityRelation.patient_id == patient_id
        )
        if review_status is not None:
            query = query.filter(
                HealthSourceSimilarityRelation.review_status == review_status
            )
        return (
            query.order_by(
                HealthSourceSimilarityRelation.created_at.desc(),
                HealthSourceSimilarityRelation.id.desc(),
            )
            .limit(limit)
            .all()
        )

    @staticmethod
    def list_relations_for_sources(
        db: Session,
        source_document_ids: list[int],
    ) -> list[HealthSourceSimilarityRelation]:
        if not source_document_ids:
            return []
        return (
            db.query(HealthSourceSimilarityRelation)
            .filter(
                or_(
                    HealthSourceSimilarityRelation.source_document_id.in_(
                        source_document_ids
                    ),
                    HealthSourceSimilarityRelation.related_source_document_id.in_(
                        source_document_ids
                    ),
                )
            )
            .order_by(HealthSourceSimilarityRelation.id)
            .all()
        )

    @staticmethod
    def serialize_relations(
        db: Session,
        relations: list[HealthSourceSimilarityRelation],
    ) -> list[dict[str, Any]]:
        source_ids = {
            source_id
            for relation in relations
            for source_id in (
                relation.source_document_id,
                relation.related_source_document_id,
            )
        }
        sources = (
            db.query(HealthSourceDocument)
            .filter(HealthSourceDocument.id.in_(source_ids))
            .all()
            if source_ids
            else []
        )
        labels = {
            source.id: source.display_name or source.original_filename
            for source in sources
        }
        return [
            {
                "id": relation.id,
                "patient_id": relation.patient_id,
                "source_document_id": relation.source_document_id,
                "source_display_name": labels.get(
                    relation.source_document_id,
                    "报告图片",
                ),
                "related_source_document_id": relation.related_source_document_id,
                "related_display_name": labels.get(
                    relation.related_source_document_id,
                    "报告图片",
                ),
                "relation_type": relation.relation_type,
                "confidence": relation.confidence,
                "algorithm_version": relation.algorithm_version,
                "evidence": relation.evidence,
                "review_status": relation.review_status,
                "reviewed_at": relation.reviewed_at,
                "created_at": relation.created_at,
                "updated_at": relation.updated_at,
            }
            for relation in relations
        ]

    @staticmethod
    def review(
        relation: HealthSourceSimilarityRelation,
        *,
        decision: Literal["confirmed", "dismissed"],
        current_user: User,
    ) -> tuple[HealthSourceSimilarityRelation, bool]:
        if relation.review_status == decision:
            return relation, False
        if relation.review_status != "pending":
            raise ValueError("similarity_review_conflict")
        relation.review_status = decision
        relation.reviewed_by_user_id = current_user.id
        relation.reviewed_at = get_utc_now()
        return relation, True


health_source_similarity_service = HealthSourceSimilarityService()
