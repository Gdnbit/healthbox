"""Database-backed single-process worker for complete health archives."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Callable, Optional

from sqlalchemy.orm import Session

from app.core.logging.config import get_logger
from app.core.logging.constants import LogFields
from app.models.health_archive_export import HealthArchiveExport
from app.services.health_archive_export_service import (
    health_archive_export_service,
)

logger = get_logger(__name__, "app")

DEFAULT_POLL_SECONDS = 5.0
DEFAULT_MAX_TASKS_PER_CYCLE = 1
SHUTDOWN_GRACE_SECONDS = 30.0


class HealthArchiveExportWorkerService:
    """Drain durable archive jobs without blocking the FastAPI event loop."""

    _instance: Optional["HealthArchiveExportWorkerService"] = None

    def __init__(
        self,
        *,
        session_factory: Callable[[], Session],
        poll_seconds: float = DEFAULT_POLL_SECONDS,
        max_tasks_per_cycle: int = DEFAULT_MAX_TASKS_PER_CYCLE,
    ) -> None:
        self._session_factory = session_factory
        self.poll_seconds = max(0.1, poll_seconds)
        self.max_tasks_per_cycle = max(1, max_tasks_per_cycle)
        self._loop: asyncio.AbstractEventLoop | None = None
        self._wake_event: asyncio.Event | None = None
        self._stop_event: asyncio.Event | None = None
        self._runner_task: asyncio.Task[None] | None = None
        self._last_cycle_at: str | None = None
        self._last_cycle_processed = 0
        self._last_recovered_count = 0

    @classmethod
    def get_instance(cls) -> "HealthArchiveExportWorkerService":
        if cls._instance is None:
            from app.core.database.database import SessionLocal

            cls._instance = cls(session_factory=SessionLocal)
        return cls._instance

    @property
    def running(self) -> bool:
        return self._runner_task is not None and not self._runner_task.done()

    async def start(self) -> None:
        if self.running:
            return
        self._loop = asyncio.get_running_loop()
        self._wake_event = asyncio.Event()
        self._stop_event = asyncio.Event()
        self._last_recovered_count = await asyncio.to_thread(
            self.recover_interrupted_tasks
        )
        self._runner_task = asyncio.create_task(
            self._run_loop(),
            name="health-archive-export-worker",
        )
        self.notify()
        logger.info(
            "Complete health archive worker started",
            extra={
                LogFields.CATEGORY: "app",
                LogFields.EVENT: "health_archive_export_worker_started",
                "recovered_count": self._last_recovered_count,
                "poll_seconds": self.poll_seconds,
            },
        )

    async def shutdown(self) -> None:
        runner = self._runner_task
        if runner is None:
            return
        if self._stop_event is not None:
            self._stop_event.set()
        if self._wake_event is not None:
            self._wake_event.set()
        try:
            await asyncio.wait_for(
                asyncio.shield(runner),
                timeout=SHUTDOWN_GRACE_SECONDS,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "Complete health archive worker exceeded shutdown window",
                extra={
                    LogFields.CATEGORY: "app",
                    LogFields.EVENT: ("health_archive_export_worker_shutdown_timeout"),
                },
            )
            runner.cancel()
            await asyncio.gather(runner, return_exceptions=True)
        finally:
            self._runner_task = None
            self._wake_event = None
            self._stop_event = None
            self._loop = None
        logger.info(
            "Complete health archive worker stopped",
            extra={
                LogFields.CATEGORY: "app",
                LogFields.EVENT: "health_archive_export_worker_stopped",
            },
        )

    def notify(self) -> bool:
        if not self.running or self._loop is None or self._wake_event is None:
            return False
        self._loop.call_soon_threadsafe(self._wake_event.set)
        return True

    def recover_interrupted_tasks(self) -> int:
        with self._session_factory() as db:
            recovered = health_archive_export_service.recover_interrupted_tasks(db)
            health_archive_export_service.expire_ready_exports(db)
            return recovered

    def run_once(self) -> int:
        with self._session_factory() as db:
            health_archive_export_service.expire_ready_exports(db)
            task_ids = [
                task_id
                for (task_id,) in (
                    db.query(HealthArchiveExport.id)
                    .filter(HealthArchiveExport.status == "queued")
                    .order_by(
                        HealthArchiveExport.created_at.asc(),
                        HealthArchiveExport.id.asc(),
                    )
                    .limit(self.max_tasks_per_cycle)
                    .all()
                )
            ]
        for task_id in task_ids:
            health_archive_export_service.process_task(
                self._session_factory,
                task_id,
            )
        self._last_cycle_at = datetime.now(timezone.utc).isoformat()
        self._last_cycle_processed = len(task_ids)
        return len(task_ids)

    def status(self) -> dict:
        return {
            "status": "running" if self.running else "fallback",
            "poll_seconds": self.poll_seconds,
            "max_tasks_per_cycle": self.max_tasks_per_cycle,
            "last_cycle_at": self._last_cycle_at,
            "last_cycle_processed": self._last_cycle_processed,
            "last_recovered_count": self._last_recovered_count,
        }

    async def _run_loop(self) -> None:
        assert self._wake_event is not None
        assert self._stop_event is not None
        while not self._stop_event.is_set():
            try:
                await asyncio.wait_for(
                    self._wake_event.wait(),
                    timeout=self.poll_seconds,
                )
            except asyncio.TimeoutError:
                pass
            if self._stop_event.is_set():
                break
            self._wake_event.clear()
            try:
                await asyncio.to_thread(self.run_once)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception(
                    "Complete health archive worker cycle failed",
                    extra={
                        LogFields.CATEGORY: "app",
                        LogFields.EVENT: ("health_archive_export_worker_cycle_failed"),
                    },
                )


health_archive_export_worker = HealthArchiveExportWorkerService.get_instance()
