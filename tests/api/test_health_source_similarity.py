import io
import os
from datetime import date

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageEnhance
from sqlalchemy.orm import Session

from app.crud.patient import patient as patient_crud
from app.models.files import EntityFile
from app.models.health_imports import (
    HealthSourceDocument,
    HealthSourceSimilarityRelation,
)
from app.schemas.patient import PatientCreate
from tests.utils.user import create_random_user, create_user_token_headers


def _report_image() -> Image.Image:
    image = Image.new("RGB", (720, 1200), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((30, 24, 690, 110), fill="#164e63")
    for index in range(13):
        top = 156 + index * 72
        draw.rectangle(
            (48, top, 245 + (index % 4) * 70, top + 20),
            fill=(40 + index * 8, 75 + index * 5, 100 + index * 4),
        )
        draw.rectangle(
            (365, top, 670, top + 20),
            fill=(130 + index * 4, 70 + index * 3, 45 + index * 2),
        )
        draw.line((48, top + 42, 670, top + 42), fill="#94a3b8", width=3)
    return image


def _encode(image: Image.Image, *, format_name: str = "PNG") -> bytes:
    output = io.BytesIO()
    image.save(output, format=format_name, quality=88)
    return output.getvalue()


def _upload_image(
    client: TestClient,
    *,
    patient_id: int,
    headers: dict,
    filename: str,
    content: bytes,
    mime_type: str,
):
    response = client.post(
        "/api/v1/health-imports/source-documents",
        data={
            "patient_id": str(patient_id),
            "display_name": filename,
            "document_type": "checkup",
            "report_date": "2026-06-18",
            "facility": "Synthetic clinic",
        },
        files={"file": (filename, content, mime_type)},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


def _remove_patient_source_files(db_session: Session, patient_id: int) -> None:
    sources = (
        db_session.query(HealthSourceDocument)
        .filter(HealthSourceDocument.patient_id == patient_id)
        .all()
    )
    file_ids = [source.primary_file_id for source in sources if source.primary_file_id]
    for entity_file in (
        db_session.query(EntityFile).filter(EntityFile.id.in_(file_ids)).all()
        if file_ids
        else []
    ):
        if entity_file.file_path and os.path.exists(entity_file.file_path):
            os.remove(entity_file.file_path)


def test_owner_can_review_near_duplicate_with_bounded_thumbnails(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
):
    patient_id = user_with_patient["patient"].id
    base = _report_image()
    near = ImageEnhance.Contrast(base.resize((700, 1167))).enhance(1.04)

    first = _upload_image(
        client,
        patient_id=patient_id,
        headers=authenticated_headers,
        filename="synthetic-page-a.png",
        content=_encode(base),
        mime_type="image/png",
    )
    second = _upload_image(
        client,
        patient_id=patient_id,
        headers=authenticated_headers,
        filename="synthetic-page-b.jpg",
        content=_encode(near, format_name="JPEG"),
        mime_type="image/jpeg",
    )

    try:
        listed = client.get(
            f"/api/v1/health-imports/patients/{patient_id}/source-similarity-relations",
            params={"review_status": "pending"},
            headers=authenticated_headers,
        )
        assert listed.status_code == 200, listed.text
        relations = listed.json()
        assert len(relations) == 1
        relation = relations[0]
        assert relation["relation_type"] == "near_duplicate"
        assert relation["review_status"] == "pending"
        assert relation["algorithm_version"] == "source-image-similarity@1.0.0"
        assert {
            relation["source_document_id"],
            relation["related_source_document_id"],
        } == {first["id"], second["id"]}
        assert relation["evidence"]["matched_region_ratio"] >= 0.7
        assert "file_path" not in relation

        for source_id in (first["id"], second["id"]):
            thumbnail = client.get(
                f"/api/v1/health-imports/source-documents/{source_id}/thumbnail",
                headers=authenticated_headers,
            )
            assert thumbnail.status_code == 200, thumbnail.text
            assert thumbnail.headers["content-type"] == "image/jpeg"
            assert thumbnail.headers["cache-control"] == "no-store"
            rendered = Image.open(io.BytesIO(thumbnail.content))
            assert max(rendered.size) <= 480
            assert rendered.getexif() == {}

        confirmed = client.post(
            f"/api/v1/health-imports/source-similarity-relations/{relation['id']}/review",
            json={"decision": "confirmed"},
            headers=authenticated_headers,
        )
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()["review_status"] == "confirmed"

        repeated = client.post(
            f"/api/v1/health-imports/source-similarity-relations/{relation['id']}/review",
            json={"decision": "confirmed"},
            headers=authenticated_headers,
        )
        assert repeated.status_code == 200

        conflict = client.post(
            f"/api/v1/health-imports/source-similarity-relations/{relation['id']}/review",
            json={"decision": "dismissed"},
            headers=authenticated_headers,
        )
        assert conflict.status_code == 409
        assert conflict.headers["X-Error-Code"] == "similarity_review_conflict"

        db_session.expire_all()
        assert (
            db_session.query(HealthSourceDocument)
            .filter(HealthSourceDocument.id.in_([first["id"], second["id"]]))
            .count()
            == 2
        )
        assert db_session.query(HealthSourceSimilarityRelation).count() == 1
    finally:
        _remove_patient_source_files(db_session, patient_id)


def test_partial_overlap_is_candidate_only_and_unrelated_image_is_ignored(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
):
    patient_id = user_with_patient["patient"].id
    base = _report_image()
    upper = base.crop((0, 0, 720, 820))
    lower = base.crop((0, 380, 720, 1200))
    unrelated = Image.new("RGB", (720, 820), "#fef3c7")
    unrelated_draw = ImageDraw.Draw(unrelated)
    for index in range(8):
        unrelated_draw.ellipse(
            (40 + index * 20, 50 + index * 30, 680 - index * 25, 770 - index * 22),
            outline="#7c3aed",
            width=8,
        )

    upper_source = _upload_image(
        client,
        patient_id=patient_id,
        headers=authenticated_headers,
        filename="synthetic-upper.png",
        content=_encode(upper),
        mime_type="image/png",
    )
    lower_source = _upload_image(
        client,
        patient_id=patient_id,
        headers=authenticated_headers,
        filename="synthetic-lower.png",
        content=_encode(lower),
        mime_type="image/png",
    )
    _upload_image(
        client,
        patient_id=patient_id,
        headers=authenticated_headers,
        filename="synthetic-unrelated.png",
        content=_encode(unrelated),
        mime_type="image/png",
    )

    try:
        listed = client.get(
            f"/api/v1/health-imports/patients/{patient_id}/source-similarity-relations",
            headers=authenticated_headers,
        )
        assert listed.status_code == 200, listed.text
        relations = listed.json()
        assert len(relations) == 1
        relation = relations[0]
        assert relation["relation_type"] == "partial_overlap"
        assert {
            relation["source_document_id"],
            relation["related_source_document_id"],
        } == {upper_source["id"], lower_source["id"]}
        assert relation["evidence"]["source_unique_ratio"] > 0
        assert relation["evidence"]["related_unique_ratio"] > 0
        assert (
            db_session.query(HealthSourceDocument)
            .filter(HealthSourceDocument.patient_id == patient_id)
            .count()
            == 3
        )
    finally:
        _remove_patient_source_files(db_session, patient_id)


def test_other_account_cannot_list_review_or_thumbnail_similarity_relations(
    client: TestClient,
    db_session: Session,
    user_with_patient,
    authenticated_headers,
):
    patient_id = user_with_patient["patient"].id
    base = _report_image()
    first = _upload_image(
        client,
        patient_id=patient_id,
        headers=authenticated_headers,
        filename="private-a.png",
        content=_encode(base),
        mime_type="image/png",
    )
    _upload_image(
        client,
        patient_id=patient_id,
        headers=authenticated_headers,
        filename="private-b.jpg",
        content=_encode(
            ImageEnhance.Brightness(base.resize((700, 1167))).enhance(1.03),
            format_name="JPEG",
        ),
        mime_type="image/jpeg",
    )

    other = create_random_user(db_session)
    other_patient = patient_crud.create_for_user(
        db_session,
        user_id=other["user"].id,
        patient_data=PatientCreate(
            first_name="Other",
            last_name="Synthetic",
            birth_date=date(1990, 1, 1),
            gender="F",
            address="Synthetic address",
        ),
    )
    other["user"].active_patient_id = other_patient.id
    db_session.commit()
    other_headers = create_user_token_headers(other["user"].username)

    try:
        own_relations = client.get(
            f"/api/v1/health-imports/patients/{patient_id}/source-similarity-relations",
            headers=authenticated_headers,
        ).json()
        relation_id = own_relations[0]["id"]

        assert (
            client.get(
                f"/api/v1/health-imports/patients/{patient_id}/source-similarity-relations",
                headers=other_headers,
            ).status_code
            == 403
        )
        assert (
            client.get(
                f"/api/v1/health-imports/source-documents/{first['id']}/thumbnail",
                headers=other_headers,
            ).status_code
            == 403
        )
        assert (
            client.post(
                f"/api/v1/health-imports/source-similarity-relations/{relation_id}/review",
                json={"decision": "confirmed"},
                headers=other_headers,
            ).status_code
            == 403
        )
    finally:
        _remove_patient_source_files(db_session, patient_id)
