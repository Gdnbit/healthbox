# Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
"""
Auto-Backup Scheduler Service

Manages periodic automatic full backups using APScheduler.
Configuration is persisted in the SystemSetting table as a JSON blob.
"""

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from app.core.logging.config import get_logger
from app.core.logging.constants import LogFields
from app.core.utils.datetime_utils import HHMM_24H_RE

logger = get_logger(__name__, "app")

SETTING_KEY = "auto_backup_schedule"
JOB_ID = "auto_backup_job"

VALID_PRESETS = {"disabled", "every_6_hours", "every_12_hours", "daily", "weekly"}
VALID_DAYS_OF_WEEK = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}

DEFAULT_CONFIG: Dict[str, Any] = {
    "preset": "disabled",
    "time_of_day": "02:00",
    "day_of_week": "sun",
    "enabled": False,
    "last_run_at": None,
    "last_run_status": None,
    "last_run_error": None,
    "last_backup_id": None,
    "last_integrity_status": None,
    "last_cleanup_deleted": None,
    "last_replica_status": None,
    "last_replicated_at": None,
    "last_replica_target_label": None,
}

TIME_FORMAT_RE = HHMM_24H_RE


class BackupSchedulerService:
    """Manages APScheduler for automatic backup scheduling."""

    _instance: Optional["BackupSchedulerService"] = None

    def __init__(self) -> None:
        timezone_name = os.getenv("TZ", "UTC")
        try:
            scheduler_timezone = ZoneInfo(timezone_name)
        except ZoneInfoNotFoundError:
            logger.warning("Invalid TZ for backup scheduler; using UTC")
            timezone_name = "UTC"
            scheduler_timezone = ZoneInfo("UTC")
        self.timezone_name = timezone_name
        self._scheduler: AsyncIOScheduler = AsyncIOScheduler(
            timezone=scheduler_timezone
        )

    @classmethod
    def get_instance(cls) -> "BackupSchedulerService":
        """Get or create the singleton instance."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def reset_instance(cls) -> None:
        """Reset singleton. Only use in tests."""
        if cls._instance is not None:
            if cls._instance._scheduler.running:
                cls._instance._scheduler.shutdown(wait=False)
            cls._instance = None

    async def start(self) -> None:
        """Start the scheduler and restore schedule from DB."""
        config = self._load_config()
        if not self._scheduler.running:
            self._scheduler.start()
        if config.get("enabled") and config.get("preset") != "disabled":
            self._apply_schedule(config)
        logger.info(
            "Backup scheduler started",
            extra={
                LogFields.CATEGORY: "app",
                LogFields.EVENT: "backup_scheduler_started",
                "preset": config.get("preset", "disabled"),
            },
        )

    async def shutdown(self) -> None:
        """Gracefully shut down the scheduler."""
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)
            logger.info(
                "Backup scheduler shut down",
                extra={
                    LogFields.CATEGORY: "app",
                    LogFields.EVENT: "backup_scheduler_stopped",
                },
            )

    def get_schedule(self) -> Dict[str, Any]:
        """Get current schedule config from DB with next_run_at."""
        from app.core.config import settings

        config = self._load_config()
        config["next_run_at"] = self._get_next_run_time()
        config["scheduler_running"] = self._scheduler.running
        config["timezone"] = self.timezone_name
        config["replica_enabled"] = bool(
            settings.BACKUP_REPLICA_ENABLED and settings.BACKUP_REPLICA_DIR
        )
        config["replica_target_label"] = (
            settings.BACKUP_REPLICA_LABEL if config["replica_enabled"] else None
        )
        return config

    def update_schedule(
        self,
        preset: str,
        time_of_day: Optional[str] = None,
        day_of_week: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Validate, persist, and apply a new schedule."""
        if preset not in VALID_PRESETS:
            raise ValueError(
                f"Invalid preset: {preset}. "
                f"Must be one of: {', '.join(sorted(VALID_PRESETS))}"
            )

        if time_of_day is not None and not TIME_FORMAT_RE.match(time_of_day):
            raise ValueError("time_of_day must be in HH:MM format (24-hour)")

        if day_of_week is not None and day_of_week not in VALID_DAYS_OF_WEEK:
            raise ValueError(
                f"Invalid day_of_week: {day_of_week}. "
                f"Must be one of: {', '.join(sorted(VALID_DAYS_OF_WEEK))}"
            )

        config = self._load_config()
        config["preset"] = preset
        config["enabled"] = preset != "disabled"
        if time_of_day is not None:
            config["time_of_day"] = time_of_day
        if day_of_week is not None:
            config["day_of_week"] = day_of_week

        self._save_config(config)
        self._apply_schedule(config)

        config["next_run_at"] = self._get_next_run_time()
        return config

    def _apply_schedule(self, config: Dict[str, Any]) -> None:
        """Apply schedule config to the APScheduler instance."""
        existing = self._scheduler.get_job(JOB_ID)
        if existing:
            self._scheduler.remove_job(JOB_ID)

        preset = config.get("preset", "disabled")
        if preset == "disabled" or not config.get("enabled"):
            return

        trigger = self._build_trigger(config)
        self._scheduler.add_job(
            self._run_backup,
            trigger=trigger,
            id=JOB_ID,
            name="Auto Full Backup",
            replace_existing=True,
            misfire_grace_time=3600,
            coalesce=True,
            max_instances=1,
        )

        logger.info(
            "Backup schedule applied",
            extra={
                LogFields.CATEGORY: "app",
                LogFields.EVENT: "backup_schedule_applied",
                "preset": preset,
                "time_of_day": config.get("time_of_day"),
            },
        )

    def _build_trigger(self, config: Dict[str, Any]):
        """Build APScheduler trigger from config."""
        preset = config["preset"]
        time_of_day = config.get("time_of_day", "02:00")
        hour, minute = map(int, time_of_day.split(":"))

        if preset == "every_6_hours":
            return IntervalTrigger(hours=6)
        if preset == "every_12_hours":
            return IntervalTrigger(hours=12)
        if preset == "daily":
            return CronTrigger(hour=hour, minute=minute)
        if preset == "weekly":
            day = config.get("day_of_week", "sun")
            return CronTrigger(day_of_week=day, hour=hour, minute=minute)
        raise ValueError(f"Cannot build trigger for preset: {preset}")

    async def _run_backup(self) -> None:
        """Create, verify, optionally copy and then apply retention policy."""
        from app.core.database.database import SessionLocal
        from app.core.config import settings
        from app.services.backup_service import BackupService

        db = SessionLocal()
        try:
            logger.info(
                "Scheduled auto-backup starting",
                extra={
                    LogFields.CATEGORY: "app",
                    LogFields.EVENT: "auto_backup_started",
                },
            )

            backup_service = BackupService(db)
            result = await backup_service.create_full_backup(
                description="Scheduled auto-backup"
            )
            backup_id = result["id"]
            verification = await backup_service.verify_backup(backup_id)
            if not verification.get("verified"):
                self._update_last_run(
                    db,
                    "failed",
                    "integrity_verification_failed",
                    backup_id=backup_id,
                    integrity_status=verification.get("status_updated") or "failed",
                )
                return

            replica = backup_service.replicate_backup(backup_id)
            cleanup = await backup_service.cleanup_old_backups()
            replica_status = replica.get("status", "not_configured")
            run_status = "degraded" if replica_status == "failed" else "success"

            self._update_last_run(
                db,
                run_status,
                (replica.get("error_code") if run_status == "degraded" else None),
                backup_id=backup_id,
                integrity_status="verified",
                cleanup_deleted=cleanup.get("total_deleted", 0),
                replica_status=replica_status,
                replicated_at=replica.get("replicated_at"),
                replica_target_label=(
                    settings.BACKUP_REPLICA_LABEL
                    if settings.BACKUP_REPLICA_ENABLED
                    else None
                ),
            )

            logger.info(
                "Scheduled auto-backup completed",
                extra={
                    LogFields.CATEGORY: "app",
                    LogFields.EVENT: "auto_backup_completed",
                    "backup_filename": result.get("filename"),
                    "size_bytes": result.get("size_bytes"),
                    "integrity_status": "verified",
                    "replica_status": replica_status,
                    "cleanup_deleted": cleanup.get("total_deleted", 0),
                },
            )
        except Exception as e:
            self._update_last_run(db, "failed", str(e))
            logger.error(
                "Scheduled auto-backup failed",
                extra={
                    LogFields.CATEGORY: "app",
                    LogFields.EVENT: "auto_backup_failed",
                    LogFields.ERROR: str(e),
                },
            )
        finally:
            db.close()

    def _get_next_run_time(self) -> Optional[str]:
        """Get the next scheduled run time as ISO string."""
        job = self._scheduler.get_job(JOB_ID)
        if job and job.next_run_time:
            return job.next_run_time.isoformat()
        return None

    def _load_config(self) -> Dict[str, Any]:
        """Load schedule config from SystemSetting table."""
        from app.core.database.database import SessionLocal
        from app.crud.system_setting import system_setting

        db = SessionLocal()
        try:
            raw = system_setting.get_setting(db, SETTING_KEY)
            if raw:
                return {**DEFAULT_CONFIG, **json.loads(raw)}
            return dict(DEFAULT_CONFIG)
        finally:
            db.close()

    def _save_config(self, config: Dict[str, Any]) -> None:
        """Save schedule config to SystemSetting table."""
        from app.core.database.database import SessionLocal
        from app.crud.system_setting import system_setting

        db = SessionLocal()
        try:
            system_setting.set_setting(db, SETTING_KEY, json.dumps(config))
        finally:
            db.close()

    def _update_last_run(
        self,
        db,
        status: str,
        error: Optional[str],
        *,
        backup_id: Optional[int] = None,
        integrity_status: Optional[str] = None,
        cleanup_deleted: Optional[int] = None,
        replica_status: Optional[str] = None,
        replicated_at: Optional[str] = None,
        replica_target_label: Optional[str] = None,
    ) -> None:
        """Update last_run fields in the persisted config using the provided session."""
        from app.crud.system_setting import system_setting

        raw = system_setting.get_setting(db, SETTING_KEY)
        config = {**DEFAULT_CONFIG, **json.loads(raw)} if raw else dict(DEFAULT_CONFIG)
        config["last_run_at"] = datetime.now(timezone.utc).isoformat()
        config["last_run_status"] = status
        config["last_run_error"] = error
        config["last_backup_id"] = backup_id
        config["last_integrity_status"] = integrity_status
        config["last_cleanup_deleted"] = cleanup_deleted
        config["last_replica_status"] = replica_status
        config["last_replicated_at"] = replicated_at
        config["last_replica_target_label"] = replica_target_label
        system_setting.set_setting(db, SETTING_KEY, json.dumps(config))
