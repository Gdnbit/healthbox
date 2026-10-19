# Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.v1.api import api_router
from app.core.config import settings
from app.core.database import engine
from app.core.http.error_handling import setup_error_handling
from app.core.http.middleware import TrailingSlashMiddleware
from app.core.http.static_files import setup_static_files
from app.core.logging.activity_middleware import ActivityTrackingMiddleware
from app.core.logging.config import LoggingConfig, get_logger
from app.core.logging.middleware import RequestLoggingMiddleware
from app.core.logging.request_id_middleware import RequestIDMiddleware
from app.core.logging.uvicorn_logging import configure_uvicorn_logging
from app.core.startup import startup_event

# Initialize logging configuration
logging_config = LoggingConfig()

# Configure Uvicorn logging to match our format
configure_uvicorn_logging()

# Initialize logger
logger = get_logger(__name__, "app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await startup_event()
    try:
        yield
    finally:
        try:
            from app.services.backup_scheduler_service import BackupSchedulerService

            scheduler = BackupSchedulerService.get_instance()
            await scheduler.shutdown()
        except Exception as e:
            logger.warning(f"Error shutting down backup scheduler: {e}")

        try:
            from app.services.medication_reminder_scheduler import (
                MedicationReminderSchedulerService,
            )

            med_scheduler = MedicationReminderSchedulerService.get_instance()
            await med_scheduler.shutdown()
        except Exception as e:
            logger.warning(f"Error shutting down medication reminder scheduler: {e}")

        try:
            from app.services.health_source_parse_worker import (
                HealthSourceParseWorkerService,
            )

            parse_worker = HealthSourceParseWorkerService.get_instance()
            await parse_worker.shutdown()
        except Exception as e:
            logger.warning(f"Error shutting down local source parse worker: {e}")

        try:
            from app.services.health_archive_export_worker import (
                HealthArchiveExportWorkerService,
            )

            archive_worker = HealthArchiveExportWorkerService.get_instance()
            await archive_worker.shutdown()
        except Exception as e:
            logger.warning(f"Error shutting down health archive export worker: {e}")


# Create FastAPI app
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    openapi_url="/api/v1/openapi.json" if settings.ENABLE_API_DOCS else None,
    lifespan=lifespan,
)

# Add middleware stack (execution order is reverse of registration)
# RequestIDMiddleware first - adds unique ID to all requests for tracing
app.add_middleware(RequestIDMiddleware)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(ActivityTrackingMiddleware)
app.add_middleware(TrailingSlashMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "Accept",
        "X-Request-ID",
        "Idempotency-Key",
    ],
    expose_headers=[
        "X-Request-ID",
        "Content-Disposition",
        "Idempotency-Replayed",
        "Retry-After",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
        "X-Error-Code",
    ],
)

# Setup comprehensive error handling system
setup_error_handling(app)

# Include API routers
app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
def health():
    """Unauthenticated readiness check used by the container health probe."""
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception:
        logger.error(
            "Health check failed because the database is unavailable",
            extra={"category": "app", "event": "health_check_database_failed"},
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service is not ready",
        )

    logger.debug(
        "Health check requested", extra={"category": "app", "event": "health_check"}
    )
    return {
        "status": "ok",
        "database": "connected",
        "app": settings.APP_NAME,
        "version": settings.VERSION,
    }


# Static files include a catch-all SPA route, so they must be registered after
# operational endpoints such as /health.
static_dir, html_dir = setup_static_files(app)
