import asyncio
from datetime import timedelta

import pytest
from sqlalchemy.orm import Session, sessionmaker

from app.models.activity_log import ActivityLog
from app.models.base import get_utc_now
from app.models.health_imports import HealthSourceDocument, HealthSourceParseTask
from app.services.health_source_parse_worker import HealthSourceParseWorkerService


@pytest.fixture
def parse_source_document(
    db_session: Session,
    test_user,
    test_patient,
) -> HealthSourceDocument:
    source = HealthSourceDocument(
        patient_id=test_patient.id,
        created_by_user_id=test_user.id,
        display_name="Synthetic worker source",
        original_filename="synthetic-worker.pdf",
        document_type="laboratory",
        mime_type="application/pdf",
        size_bytes=32,
        sha256="a" * 64,
        storage_backend="local",
        status="uploaded",
    )
    db_session.add(source)
    db_session.commit()
    db_session.refresh(source)
    return source


def _make_task(
    *,
    patient_id: int,
    source_document_id: int,
    user_id: int,
    key: str,
    status: str,
    attempt_count: int,
) -> HealthSourceParseTask:
    return HealthSourceParseTask(
        patient_id=patient_id,
        source_document_id=source_document_id,
        created_by_user_id=user_id,
        idempotency_key=key,
        parser_name="local-core-lab",
        parser_version="1.0.0",
        status=status,
        attempt_count=attempt_count,
        summary={"formal_write_count": 0},
        started_at=(
            (get_utc_now() - timedelta(minutes=2)) if status == "running" else None
        ),
    )


def test_worker_requeues_interrupted_running_tasks_on_startup(
    db_session: Session,
    test_db_engine,
    test_user,
    test_patient,
    parse_source_document,
):
    running = _make_task(
        patient_id=test_patient.id,
        source_document_id=parse_source_document.id,
        user_id=test_user.id,
        key="worker-restart-running",
        status="running",
        attempt_count=1,
    )
    succeeded = _make_task(
        patient_id=test_patient.id,
        source_document_id=parse_source_document.id,
        user_id=test_user.id,
        key="worker-restart-succeeded",
        status="succeeded",
        attempt_count=1,
    )
    db_session.add_all([running, succeeded])
    db_session.commit()

    worker = HealthSourceParseWorkerService(
        session_factory=sessionmaker(bind=test_db_engine)
    )
    assert worker.recover_interrupted_tasks() == 1

    db_session.expire_all()
    assert db_session.get(HealthSourceParseTask, running.id).status == "queued"
    assert db_session.get(HealthSourceParseTask, running.id).started_at is None
    assert db_session.get(HealthSourceParseTask, succeeded.id).status == "succeeded"
    activity = (
        db_session.query(ActivityLog)
        .filter(
            ActivityLog.entity_type == "health_source_parse_task",
            ActivityLog.entity_id == running.id,
            ActivityLog.action == "recovered_after_restart",
        )
        .one()
    )
    assert activity.event_metadata["previous_status"] == "running"


def test_worker_processes_queued_tasks_in_stable_order(
    db_session: Session,
    test_db_engine,
    test_user,
    test_patient,
    parse_source_document,
    monkeypatch,
):
    tasks = [
        _make_task(
            patient_id=test_patient.id,
            source_document_id=parse_source_document.id,
            user_id=test_user.id,
            key=f"worker-queued-{index}",
            status="queued",
            attempt_count=0,
        )
        for index in range(3)
    ]
    db_session.add_all(tasks)
    db_session.commit()
    expected_ids = [task.id for task in tasks]
    processed: list[int] = []

    def fake_process_task(session_factory, task_id: int):
        processed.append(task_id)
        with session_factory() as worker_db:
            task = worker_db.get(HealthSourceParseTask, task_id)
            task.status = "failed"
            task.error_code = "synthetic_worker_test"
            task.attempt_count += 1
            task.completed_at = get_utc_now()
            worker_db.commit()

    monkeypatch.setattr(
        "app.services.health_source_parse_worker.health_source_parse_service.process_task",
        fake_process_task,
    )
    worker = HealthSourceParseWorkerService(
        session_factory=sessionmaker(bind=test_db_engine),
        max_tasks_per_cycle=2,
    )

    assert worker.run_once() == 2
    assert processed == expected_ids[:2]
    assert worker.run_once() == 1
    assert processed == expected_ids


@pytest.mark.asyncio
async def test_worker_start_automatically_recovers_and_drains_interrupted_task(
    db_session: Session,
    test_db_engine,
    test_user,
    test_patient,
    parse_source_document,
):
    interrupted = _make_task(
        patient_id=test_patient.id,
        source_document_id=parse_source_document.id,
        user_id=test_user.id,
        key="worker-start-recovery",
        status="running",
        attempt_count=1,
    )
    db_session.add(interrupted)
    db_session.commit()
    task_id = interrupted.id

    worker = HealthSourceParseWorkerService(
        session_factory=sessionmaker(bind=test_db_engine),
        poll_seconds=0.05,
        max_tasks_per_cycle=1,
    )
    await worker.start()
    try:
        for _ in range(40):
            await asyncio.sleep(0.025)
            db_session.expire_all()
            current = db_session.get(HealthSourceParseTask, task_id)
            if current.status == "failed":
                break
        else:
            pytest.fail("Recovered task was not drained by the worker")
    finally:
        await worker.shutdown()

    db_session.expire_all()
    recovered = db_session.get(HealthSourceParseTask, task_id)
    assert recovered.status == "failed"
    assert recovered.error_code == "source_file_missing"
    assert recovered.attempt_count == 2
    assert worker.status()["status"] == "fallback"
