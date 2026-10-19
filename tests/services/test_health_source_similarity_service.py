import io
import json

from PIL import Image, ImageDraw, ImageEnhance

from app.services.health_source_similarity_service import (
    IMAGE_SIMILARITY_ALGORITHM_VERSION,
    build_image_similarity_signature,
    compare_image_similarity_signatures,
    render_image_thumbnail,
)


def _synthetic_report_image(*, width: int = 720, height: int = 1200) -> Image.Image:
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((32, 28, width - 32, 112), fill="#155e75")
    draw.rectangle((48, 152, width - 48, 190), fill="#dbeafe")
    for index in range(12):
        top = 230 + index * 72
        draw.rectangle(
            (52, top, 260 + (index % 3) * 64, top + 18),
            fill=(30 + index * 7, 60 + index * 5, 90 + index * 3),
        )
        draw.rectangle(
            (330, top, width - 58, top + 18),
            fill=(120 + index * 4, 80 + index * 3, 50 + index * 2),
        )
        draw.line((52, top + 38, width - 52, top + 38), fill="#94a3b8", width=3)
    return image


def _unrelated_image() -> Image.Image:
    image = Image.new("RGB", (720, 1200), "#fef3c7")
    draw = ImageDraw.Draw(image)
    for index in range(10):
        inset = 30 + index * 28
        draw.ellipse(
            (inset, inset, 720 - inset, 1200 - inset),
            outline=(20 * index, 30, 180 - index * 8),
            width=9,
        )
    return image


def _encode(image: Image.Image, *, format_name: str = "PNG") -> bytes:
    output = io.BytesIO()
    image.save(output, format=format_name, quality=88)
    return output.getvalue()


def test_similarity_signature_is_versioned_and_non_reconstructive():
    signature = build_image_similarity_signature(
        _encode(_synthetic_report_image()),
        mime_type="image/png",
    )

    assert signature is not None
    assert signature["algorithm_version"] == IMAGE_SIMILARITY_ALGORITHM_VERSION
    assert signature["global"]["difference_hash"]
    assert signature["global"]["average_hash"]
    assert 12 <= len(signature["bands"]) <= 20
    assert "pixels" not in json.dumps(signature).lower()
    assert "thumbnail" not in json.dumps(signature).lower()
    assert len(json.dumps(signature)) < 12_000


def test_similarity_comparison_separates_near_partial_and_unrelated_images():
    base = _synthetic_report_image()
    near = ImageEnhance.Contrast(base.resize((700, 1167))).enhance(1.04)
    upper = base.crop((0, 0, 720, 820))
    lower = base.crop((0, 380, 720, 1200))

    base_signature = build_image_similarity_signature(
        _encode(base),
        mime_type="image/png",
    )
    near_signature = build_image_similarity_signature(
        _encode(near, format_name="JPEG"),
        mime_type="image/jpeg",
    )
    upper_signature = build_image_similarity_signature(
        _encode(upper),
        mime_type="image/png",
    )
    lower_signature = build_image_similarity_signature(
        _encode(lower),
        mime_type="image/png",
    )
    unrelated_signature = build_image_similarity_signature(
        _encode(_unrelated_image()),
        mime_type="image/png",
    )

    near_result = compare_image_similarity_signatures(
        base_signature,
        near_signature,
    )
    overlap_result = compare_image_similarity_signatures(
        upper_signature,
        lower_signature,
    )
    unrelated_result = compare_image_similarity_signatures(
        base_signature,
        unrelated_signature,
    )

    assert near_result is not None
    assert near_result.relation_type == "near_duplicate"
    assert near_result.confidence >= 0.8
    assert near_result.evidence["matched_region_ratio"] >= 0.7

    assert overlap_result is not None
    assert overlap_result.relation_type == "partial_overlap"
    assert overlap_result.confidence >= 0.65
    assert 0.2 <= overlap_result.evidence["matched_region_ratio"] < 0.9
    assert overlap_result.evidence["source_unique_ratio"] > 0
    assert overlap_result.evidence["related_unique_ratio"] > 0

    assert unrelated_result is None


def test_invalid_image_fails_closed_without_a_similarity_claim():
    assert (
        build_image_similarity_signature(
            b"not an image",
            mime_type="image/png",
        )
        is None
    )


def test_thumbnail_is_bounded_jpeg_without_source_metadata():
    source = _synthetic_report_image(width=1600, height=2400)
    source.info["exif"] = b"synthetic-private-metadata"

    thumbnail = render_image_thumbnail(_encode(source), max_edge=480)

    rendered = Image.open(io.BytesIO(thumbnail))
    assert rendered.format == "JPEG"
    assert max(rendered.size) <= 480
    assert rendered.getexif() == {}
    assert b"synthetic-private-metadata" not in thumbnail
